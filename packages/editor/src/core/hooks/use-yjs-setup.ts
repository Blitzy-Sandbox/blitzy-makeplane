/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Bootstraps the collaborative Y.js session: `HocuspocusProvider` +
 * `IndexeddbPersistence` + connectivity reactions.
 *
 * This hook is the foundational Y.js / Hocuspocus boundary in the editor
 * package. It owns the Y.Doc init → merge → persist lifecycle and is the
 * upstream half of the collaborative editing pipeline; `use-editor.ts`
 * and `use-collaborative-editor.ts` consume the provider it produces via
 * the `CollaborationProvider` React context.
 *
 * Y.Doc lifecycle:
 *  - Init: a `HocuspocusProvider` is constructed with
 *    `{ name: docId, token, url }`. The provider creates and owns a
 *    `Y.Doc` internally (exposed via `provider.document`); this hook
 *    does NOT construct the Y.Doc directly. The Y.Doc starts empty —
 *    the first message from the server contains the binary update
 *    that hydrates it.
 *  - Merge: incoming remote updates are applied via
 *    `Y.applyUpdate(doc, update)` internally by the Hocuspocus client.
 *    Yjs CRDT semantics guarantee deterministic merge — concurrent
 *    edits resolve via vector clocks (Lamport-style) without an
 *    explicit resolver, so conflict resolution is structural to the
 *    CRDT itself.
 *  - Persist: server-side persistence is implemented in
 *    `apps/live/src/extensions/database.ts` with a 10-second debounce
 *    and an HTML→binary backfill executed when `description_binary`
 *    is empty.
 *  - Local cache: `IndexeddbPersistence` provides an offline cache
 *    keyed by the document name; `hasCachedContent` flips true when
 *    the cached Y.XmlFragment "default" is non-empty.
 *  - Connectivity: `visibilitychange`, `focus`, and `online`
 *    listeners reconnect the provider after sleep / tab switch /
 *    network restore. The handler is throttled to one attempt per
 *    second to prevent `visibilitychange` and `focus` from
 *    double-firing on tab return.
 *  - Forced close: a `signalForcedClose` action on the returned
 *    object lets callers mark the next close as server-forced; the
 *    `apps/live` force-close handler extension can also trigger this
 *    from the server via stateless messages.
 *
 * See tech spec §5.2.5.4 for the real-time collaboration sequence.
 * See apps/live/src/extensions/database.ts for the server-side
 * persistence implementation.
 * See apps/live/src/extensions/force-close-handler.ts for the
 * force-close trigger source.
 */
import { HocuspocusProvider } from "@hocuspocus/provider";
// react
import { useCallback, useEffect, useRef, useState } from "react";
// indexeddb
import { IndexeddbPersistence } from "y-indexeddb";
// yjs
import type * as Y from "yjs";
// types
import type { CollaborationState, CollabStage, CollaborationError } from "@/types/collaboration";

/**
 * Returns true when the WebSocket close code falls in the custom
 * 4000–4003 range that the Hocuspocus server uses to signal a forced
 * close (e.g., admin override, server shutdown, version mismatch).
 * Standard close codes (< 4000) are treated as transient and trigger
 * the retry path instead.
 */
// Helper to check if a close code indicates a forced close
const isForcedCloseCode = (code: number | undefined): boolean => {
  if (!code) return false;
  // All custom close codes (4000-4003) are treated as forced closes
  return code >= 4000 && code <= 4003;
};

/**
 * Arguments accepted by `useYjsSetup` — the collaborative session
 * bootstrap inputs.
 *
 * Fields:
 *  - `docId`: stable identifier used as BOTH the Hocuspocus document
 *    name and the IndexedDB key. Swapping `docId` triggers a full
 *    session re-bind (provider teardown + reconstruction).
 *  - `serverUrl`: WebSocket URL of the `apps/live` server.
 *  - `authToken`: bearer token validated by the live server's
 *    `onAuthenticate` hook (see `apps/live/src/lib/auth.ts`).
 *  - `onStateChange`: optional callback invoked whenever the derived
 *    `CollaborationState` changes. Kept in a ref so changes to the
 *    handler reference do not re-trigger the connection effect.
 *  - `options.maxConnectionAttempts`: declared as accepted by the
 *    type but see the inline `INTENT UNCLEAR` flag — the current
 *    implementation always uses `DEFAULT_MAX_RETRIES` (3).
 */
type UseYjsSetupArgs = {
  docId: string;
  serverUrl: string;
  authToken: string;
  onStateChange?: (state: CollaborationState) => void;
  // INTENT UNCLEAR: option is accepted by the type but the current implementation always uses DEFAULT_MAX_RETRIES (3)
  options?: {
    maxConnectionAttempts?: number;
  };
};

/**
 * Maximum transient-reconnection attempts before transitioning to a
 * `disconnected` stage with a `max-retries` error.
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Manages the collaborative session lifecycle (provider + IndexedDB
 * persistence + connectivity recovery) for a single Y.Doc.
 *
 * Returns:
 *  - `null` until the `HocuspocusProvider` has been constructed in
 *    the first effect tick (so consumers must guard against null).
 *  - Once ready: `{ provider, ydoc, state, actions }` where `state`
 *    exposes `stage` (a `CollabStage`), `hasCachedContent`,
 *    `isCacheReady`, `isServerSynced`, `isServerDisconnected`, and
 *    `isDocReady` — derived from local cache + server stage — and
 *    `actions.signalForcedClose(value: boolean)` lets callers mark
 *    an upcoming close as server-forced.
 *
 * State machine (`CollabStage.kind` transitions):
 *  - Happy path: `initial → connecting → awaiting-sync → synced`.
 *  - `disconnected` on auth failure, max-retries exhaustion, or
 *    forced close. Terminal — requires user action (tab focus,
 *    network restore) to re-enter `connecting`.
 *  - `reconnecting` on transient close while retry budget remains;
 *    `attempt` counts the in-flight retry number.
 *
 * Effects (declared in the order they run):
 *  1. Provider effect — deps `[docId, serverUrl, authToken]`.
 *     Constructs the `HocuspocusProvider`, wires the
 *     `onAuthenticationFailed` / `onConnect` / `onStatus` /
 *     `onSynced` / `close` handlers, installs the
 *     `visibilitychange` / `focus` / `online` reconnection
 *     listeners, and tears the provider down on cleanup.
 *  2. IndexedDB effect — deps `[docId, yjsSession]`. Attaches
 *     `IndexeddbPersistence` and flips `isCacheReady` /
 *     `hasCachedContent` when the local cache emits `synced`.
 *  3. Fragment observer — deps `[yjsSession, isCacheReady]`. Calls
 *     `observeDeep` on the Y.XmlFragment "default" so
 *     `hasCachedContent` stays in sync as keystrokes mutate the
 *     cached content. A local `lastHasContent` latch skips
 *     redundant React state writes.
 *  4. State-change notifier — deps `[stage]`. Invokes the optional
 *     `onStateChange` callback via a ref so a new handler reference
 *     does not re-run the connection effect.
 *
 * Forced-close handling: when the `close` handler observes a custom
 * 4000-series code, an explicit `forcedCloseSignalRef` value, or
 * `shouldConnect === false`, the stage transitions to `disconnected`
 * with a `forced-close` error and the websocket provider is paused.
 * Transient closes increment `retryCountRef` and transition through
 * `reconnecting` until the `DEFAULT_MAX_RETRIES` budget is exhausted.
 *
 * Throttling: the `lastReconnectTimeRef` 1-second window prevents
 * the reconnection path from double-firing when both
 * `visibilitychange` and `focus` fire on tab return.
 *
 * Disposal safety: `isDisposedRef` short-circuits every callback
 * after teardown so late events do not mutate React state in an
 * unmounted component.
 */
export const useYjsSetup = ({ docId, serverUrl, authToken, onStateChange }: UseYjsSetupArgs) => {
  // Current collaboration stage
  const [stage, setStage] = useState<CollabStage>({ kind: "initial" });

  // Cache readiness state
  const [hasCachedContent, setHasCachedContent] = useState(false);
  const [isCacheReady, setIsCacheReady] = useState(false);

  // Provider and Y.Doc in state (nullable until effect runs)
  const [yjsSession, setYjsSession] = useState<{ provider: HocuspocusProvider; ydoc: Y.Doc } | null>(null);

  // Use refs for values that need to be mutated from callbacks
  const retryCountRef = useRef(0);
  const forcedCloseSignalRef = useRef(false);
  const isDisposedRef = useRef(false);
  const stageRef = useRef<CollabStage>({ kind: "initial" });
  const lastReconnectTimeRef = useRef(0);

  // Create/destroy provider in effect (not during render)
  useEffect(() => {
    // Reset refs when creating new provider (e.g., document switch)
    retryCountRef.current = 0;
    isDisposedRef.current = false;
    forcedCloseSignalRef.current = false;
    stageRef.current = { kind: "initial" };

    const provider = new HocuspocusProvider({
      name: docId,
      token: authToken,
      url: serverUrl,
      onAuthenticationFailed: () => {
        if (isDisposedRef.current) return;
        const error: CollaborationError = { type: "auth-failed", message: "Authentication failed" };
        const newStage = { kind: "disconnected" as const, error };
        stageRef.current = newStage;
        setStage(newStage);
      },
      onConnect: () => {
        if (isDisposedRef.current) {
          provider?.disconnect();
          return;
        }
        retryCountRef.current = 0;
        // After successful connection, transition to awaiting-sync (onSynced will move to synced)
        const newStage = { kind: "awaiting-sync" as const };
        stageRef.current = newStage;
        setStage(newStage);
      },
      onStatus: ({ status: providerStatus }) => {
        if (isDisposedRef.current) return;
        if (providerStatus === "connecting") {
          // Derive whether this is initial connect or reconnection from retry count
          const isReconnecting = retryCountRef.current > 0;
          setStage(isReconnecting ? { kind: "reconnecting", attempt: retryCountRef.current } : { kind: "connecting" });
        } else if (providerStatus === "disconnected") {
          // Do not transition here; let handleClose decide the final stage
        } else if (providerStatus === "connected") {
          // Connection succeeded, move to awaiting-sync
          const newStage = { kind: "awaiting-sync" as const };
          stageRef.current = newStage;
          setStage(newStage);
        }
      },
      onSynced: () => {
        if (isDisposedRef.current) return;
        retryCountRef.current = 0;
        // Document sync complete
        const newStage = { kind: "synced" as const };
        stageRef.current = newStage;
        setStage(newStage);
      },
    });

    const pauseProvider = () => {
      const wsProvider = provider.configuration.websocketProvider;
      if (wsProvider) {
        try {
          wsProvider.shouldConnect = false;
          wsProvider.disconnect();
        } catch (error) {
          console.error(`Error pausing websocketProvider:`, error);
        }
      }
    };

    const permanentlyStopProvider = () => {
      isDisposedRef.current = true;

      const wsProvider = provider.configuration.websocketProvider;
      if (wsProvider) {
        try {
          wsProvider.shouldConnect = false;
          wsProvider.disconnect();
          wsProvider.destroy();
        } catch (error) {
          console.error(`Error tearing down websocketProvider:`, error);
        }
      }
      try {
        provider.destroy();
      } catch (error) {
        console.error(`Error destroying provider:`, error);
      }
    };

    const handleClose = (closeEvent: { event?: { code?: number; reason?: string } }) => {
      if (isDisposedRef.current) return;

      const closeCode = closeEvent.event?.code;
      const wsProvider = provider.configuration.websocketProvider;
      const shouldConnect = wsProvider.shouldConnect;
      const isForcedClose = isForcedCloseCode(closeCode) || forcedCloseSignalRef.current || shouldConnect === false;

      if (isForcedClose) {
        // Determine if this is a manual disconnect or a permanent error
        const isManualDisconnect = shouldConnect === false;

        const error: CollaborationError = {
          type: "forced-close",
          code: closeCode || 0,
          message: isManualDisconnect ? "Manually disconnected" : "Server forced connection close",
        };
        const newStage = { kind: "disconnected" as const, error };
        stageRef.current = newStage;
        setStage(newStage);

        retryCountRef.current = 0;
        forcedCloseSignalRef.current = false;

        // Only pause if it's a real forced close (not manual disconnect)
        // Manual disconnect leaves it as is (shouldConnect=false already set if manual)
        if (!isManualDisconnect) {
          pauseProvider();
        }
      } else {
        // Transient connection loss: attempt reconnection
        retryCountRef.current++;

        if (retryCountRef.current >= DEFAULT_MAX_RETRIES) {
          // Exceeded max retry attempts
          const error: CollaborationError = {
            type: "max-retries",
            message: `Failed to connect after ${DEFAULT_MAX_RETRIES} attempts`,
          };
          const newStage = { kind: "disconnected" as const, error };
          stageRef.current = newStage;
          setStage(newStage);

          pauseProvider();
        } else {
          // Still have retries left, move to reconnecting
          const newStage = { kind: "reconnecting" as const, attempt: retryCountRef.current };
          stageRef.current = newStage;
          setStage(newStage);
        }
      }
    };

    provider.on("close", handleClose);

    setYjsSession({ provider, ydoc: provider.document });

    // Handle page visibility changes (sleep/wake, tab switching)
    const handleVisibilityChange = (event?: Event) => {
      if (isDisposedRef.current) return;

      const isVisible = document.visibilityState === "visible";
      const isFocus = event?.type === "focus";

      if (isVisible || isFocus) {
        // Throttle reconnection attempts to avoid double-firing (visibility + focus)
        const now = Date.now();
        if (now - lastReconnectTimeRef.current < 1000) {
          return;
        }

        const wsProvider = provider.configuration.websocketProvider;
        if (!wsProvider) return;

        const ws = wsProvider.webSocket;
        const isStale = ws?.readyState === WebSocket.CLOSED || ws?.readyState === WebSocket.CLOSING;

        // If disconnected or stale, re-enable reconnection and force reconnect
        if (isStale || stageRef.current.kind === "disconnected") {
          lastReconnectTimeRef.current = now;

          // Re-enable connection on tab focus (even if manually disconnected before sleep)
          wsProvider.shouldConnect = true;

          // Reset retry count for fresh reconnection attempt
          retryCountRef.current = 0;

          // Move to connecting state
          const newStage = { kind: "connecting" as const };
          stageRef.current = newStage;
          setStage(newStage);

          wsProvider.disconnect();
          wsProvider.connect();
        }
      }
    };

    // Handle online/offline events
    const handleOnline = () => {
      if (isDisposedRef.current) return;

      const wsProvider = provider.configuration.websocketProvider;
      if (wsProvider) {
        wsProvider.shouldConnect = true;
        wsProvider.disconnect();
        wsProvider.connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      try {
        provider.off("close", handleClose);
      } catch (error) {
        console.error(`Error unregistering close handler:`, error);
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);

      permanentlyStopProvider();
    };
  }, [docId, serverUrl, authToken]);

  // IndexedDB persistence lifecycle
  useEffect(() => {
    if (!yjsSession) return;

    const idbPersistence = new IndexeddbPersistence(docId, yjsSession.provider.document);

    const onIdbSynced = () => {
      const yFragment = idbPersistence.doc.getXmlFragment("default");
      const docLength = yFragment?.length ?? 0;
      setIsCacheReady(true);
      setHasCachedContent(docLength > 0);
    };

    idbPersistence.on("synced", onIdbSynced);

    return () => {
      idbPersistence.off("synced", onIdbSynced);
      try {
        idbPersistence.destroy();
      } catch (error) {
        console.error(`Error destroying local provider:`, error);
      }
    };
  }, [docId, yjsSession]);

  // Observe Y.Doc content changes to update hasCachedContent (catches fallback scenario)
  useEffect(() => {
    if (!yjsSession || !isCacheReady) return;

    const fragment = yjsSession.ydoc.getXmlFragment("default");
    let lastHasContent = false;

    const updateCachedContentFlag = () => {
      const len = fragment?.length ?? 0;
      const hasContent = len > 0;

      // Only update state if the boolean value actually changed
      if (hasContent !== lastHasContent) {
        lastHasContent = hasContent;
        setHasCachedContent(hasContent);
      }
    };
    // Initial check (handles fallback content loaded before this effect runs)
    updateCachedContentFlag();

    // Use observeDeep to catch nested changes (keystrokes modify Y.XmlText inside Y.XmlElement)
    fragment.observeDeep(updateCachedContentFlag);

    return () => {
      try {
        fragment.unobserveDeep(updateCachedContentFlag);
      } catch (error) {
        console.error("Error unobserving fragment:", error);
      }
    };
  }, [yjsSession, isCacheReady]);

  // Notify state changes callback (use ref to avoid dependency on handler)
  const stateChangeCallbackRef = useRef(onStateChange);
  stateChangeCallbackRef.current = onStateChange;

  useEffect(() => {
    if (!stateChangeCallbackRef.current) return;

    const isServerSynced = stage.kind === "synced";
    const isServerDisconnected = stage.kind === "disconnected";

    const state: CollaborationState = {
      stage,
      isServerSynced,
      isServerDisconnected,
    };

    stateChangeCallbackRef.current(state);
  }, [stage]);

  // Derived values for convenience
  const isServerSynced = stage.kind === "synced";
  const isServerDisconnected = stage.kind === "disconnected";
  const isDocReady = isServerSynced || isServerDisconnected || (isCacheReady && hasCachedContent);

  const signalForcedClose = useCallback((value: boolean) => {
    forcedCloseSignalRef.current = value;
  }, []);

  // Don't return anything until provider is ready - guarantees non-null provider
  if (!yjsSession) {
    return null;
  }

  return {
    provider: yjsSession.provider,
    ydoc: yjsSession.ydoc,
    state: {
      stage,
      hasCachedContent,
      isCacheReady,
      isServerSynced,
      isServerDisconnected,
      isDocReady,
    },
    actions: {
      signalForcedClose,
    },
  };
};
