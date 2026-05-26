/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Collaborative (real-time) document-editor variant.
 *
 * Composes the Hocuspocus collaboration provider boundary around the document
 * editor, suppresses rendering until both body and title editors are ready,
 * and delegates page rendering to `PageRenderer`. Collaboration state, the
 * Hocuspocus provider, and the `Y.Doc` lifecycle are owned by
 * `CollaborationProvider` / `useCollaboration` (from
 * `@/contexts/collaboration-context`); per-editor bootstrap is owned by
 * `useCollaborativeEditor` (from `@/hooks/use-collaborative-editor`).
 *
 * The non-collaborative counterpart lives in `./editor.tsx`. The public
 * ref-forwarding export from this module is
 * `CollaborativeDocumentEditorWithRef`, surfaced upward through `./index.ts`
 * and `packages/editor/src/index.ts`.
 */

import React, { useMemo } from "react";
// plane imports
import { cn } from "@plane/utils";
// components
import { PageRenderer } from "@/components/editors";
// constants
import { DEFAULT_DISPLAY_CONFIG } from "@/constants/config";
// contexts
import { CollaborationProvider, useCollaboration } from "@/contexts/collaboration-context";
// helpers
import { getEditorClassNames } from "@/helpers/common";
// hooks
import { useCollaborativeEditor } from "@/hooks/use-collaborative-editor";
// types
import type { EditorRefApi, ICollaborativeDocumentEditorProps } from "@/types";

// Inner component that has access to collaboration context
/**
 * Inner component running inside the `CollaborationProvider` boundary.
 *
 * Reads `{ provider, state, actions }` via `useCollaboration()`, bootstraps
 * the body and title editors via `useCollaborativeEditor`, derives composite
 * loading signals from `state` plus `isFetchingFallbackBinary`, and
 * delegates rendering to `PageRenderer` wrapped in a fade-in `<div>` that
 * hides content until `state.isDocReady` is true.
 *
 * Props are typed by `ICollaborativeDocumentEditorProps` (declared in
 * `@/types`); the prop list is intentionally not duplicated here. Key
 * collaboration-specific inputs include: `id` (document id — also used as
 * the React key for remount on document change), `realtimeConfig`
 * (Hocuspocus server URL — actually consumed in the outer component),
 * `user` (auth/user identity), `serverHandler?.onStateChange` (collaboration
 * state-change callback — also consumed in the outer component),
 * `isFetchingFallbackBinary` (loader-gating signal driven by the consumer
 * when fetching the server-stored HTML→binary fallback), and the standard
 * editor props inherited from `IEditorProps` minus `initialValue` /
 * `onEnterKeyPress` / `value` (those are owned by the collaboration layer,
 * not by the caller).
 *
 * Loading-signal derivation:
 * - `shouldShowSyncLoader = state.isCacheReady && !state.hasCachedContent
 *   && !state.isServerSynced` — loader shown only when the IndexedDB cache
 *   is known empty AND the Hocuspocus server has not yet synced; ensures
 *   users with cached content see no flash.
 * - `shouldWaitForFallbackBinary = isFetchingFallbackBinary &&
 *   !state.hasCachedContent && state.isServerDisconnected` — keeps the
 *   loader visible while the consumer is fetching the HTML→binary fallback
 *   (the `apps/api` path that exists for documents created before binary
 *   persistence shipped).
 * - `isLoading = shouldShowSyncLoader || shouldWaitForFallbackBinary` —
 *   composite loader signal forwarded to `PageRenderer`.
 * - `showContentSkeleton = !state.isDocReady` — gates content opacity to
 *   prevent an empty editor flash even after `isLoading === false`.
 *
 * Collaboration extensions wired (via `useCollaborativeEditor`):
 * - `HocuspocusProvider` from `@hocuspocus/provider` — constructed inside
 *   `CollaborationProvider` and consumed here via `useCollaboration()`;
 *   owns the WebSocket connection to `apps/live` and the `Y.Doc` lifecycle.
 * - `@tiptap/extension-collaboration` — binds a `Y.XmlFragment` to the
 *   ProseMirror document via the `y-prosemirror` binding.
 * - `@tiptap/extension-collaboration-cursor` — renders remote cursors and
 *   selections via `y-protocols/awareness`.
 * - `y-prosemirror` and `y-protocols/awareness` are the substrates that
 *   Yjs uses to synchronize document content and per-user presence state
 *   respectively.
 *
 * Y.js document schema:
 * - Root: a `Y.Doc` containing a top-level XML fragment bound to ProseMirror
 *   via `y-prosemirror`.
 * - Structure: `y-prosemirror` represents the document tree as a
 *   `Y.XmlFragment` — TipTap nodes become `Y.XmlElement`s, marks become
 *   attributes, and text becomes `Y.XmlText`. No custom shared `Y.Map` /
 *   `Y.Array` structures are expected at the document root.
 * - Lifecycle:
 *   - init: empty `Y.Doc` or hydrated from a server-stored binary update
 *     via `Y.applyUpdate(doc, serverBinary)` when a snapshot exists.
 *   - merge: CRDT auto-merge — remote updates arrive via the Hocuspocus
 *     provider and are applied through `Y.applyUpdate`; conflict resolution
 *     is Yjs's structural lamport-clock-based last-writer-wins with NO
 *     explicit resolver callback.
 *   - persist: server-side debounce — `apps/live/src/extensions/database.ts`
 *     writes to `apps/api` on a 10-second debounce after the last edit,
 *     with an HTML→binary backfill path used when `description_binary` is
 *     empty on the server side (i.e., for documents created before binary
 *     persistence shipped).
 *
 * See `packages/editor/src/core/helpers/yjs-utils.ts` for Y.js
 * encode/decode/merge helpers, `apps/live/src/extensions/database.ts` for
 * the server-side 10-second persistence debounce and the HTML→binary
 * backfill implementation, and tech spec §5.2.5.4 for the real-time
 * collaboration sequence diagram (connect → edit → persist → disconnect).
 *
 * TipTap surface:
 * - Exposes the same document-editor extension stack as the
 *   non-collaborative variant (`SideMenuExtension`, `HeadingListExtension`,
 *   plus `DocumentEditorAdditionalExtensions`) PLUS the collaboration
 *   extensions wired through `useCollaborativeEditor`:
 *   `@tiptap/extension-collaboration` (Y.Doc binding) and
 *   `@tiptap/extension-collaboration-cursor` (remote cursor / awareness).
 * - Overrides the standalone `useEditor` bootstrap (used by `./editor.tsx`)
 *   by routing through `useCollaborativeEditor`, which awaits the Hocuspocus
 *   document sync before exposing a usable editor; the editor is rendered
 *   only when both `editor` AND `titleEditor` are defined.
 * - Hides the editor surface (renders the loading skeleton via
 *   `PageRenderer`'s `isLoading` branch) while cache/sync/readiness signals
 *   indicate the document is not yet ready, and suppresses content fade-in
 *   until `state.isDocReady === true` via the `pointer-events-none
 *   opacity-0` class composition on the outer `<div>`.
 *
 * Side effects are confined to deriving composite signals from `state` plus
 * `isFetchingFallbackBinary` (no side effects of its own); editor bootstrap
 * (extension registration, `Y.Doc` binding, awareness wiring) is delegated
 * to `useCollaborativeEditor`, final rendering is delegated to
 * `PageRenderer`, and the Hocuspocus WebSocket connection lifecycle
 * (open/close/reconnect) is owned by `CollaborationProvider` — not by this
 * component.
 */
function CollaborativeDocumentEditorInner(props: ICollaborativeDocumentEditorProps) {
  const {
    aiHandler,
    bubbleMenuEnabled = true,
    containerClassName,
    documentLoaderClassName,
    extensions = [],
    disabledExtensions,
    displayConfig = DEFAULT_DISPLAY_CONFIG,
    editable,
    editorClassName = "",
    editorProps,
    extendedEditorProps,
    fileHandler,
    flaggedExtensions,
    forwardedRef,
    getEditorMetaData,
    handleEditorReady,
    id,
    dragDropEnabled = true,
    isTouchDevice,
    mentionHandler,
    onAssetChange,
    onChange,
    onEditorFocus,
    onTransaction,
    placeholder,
    tabIndex,
    user,
    extendedDocumentEditorProps,
    titleRef,
    updatePageProperties,
    isFetchingFallbackBinary,
  } = props;

  // Get non-null provider from context
  const { provider, state, actions } = useCollaboration();

  // Editor initialization with guaranteed non-null provider
  const { editor, titleEditor } = useCollaborativeEditor({
    provider,
    disabledExtensions,
    editable,
    editorClassName,
    editorProps,
    extendedEditorProps,
    extensions,
    fileHandler,
    flaggedExtensions,
    getEditorMetaData,
    forwardedRef,
    handleEditorReady,
    id,
    dragDropEnabled,
    isTouchDevice,
    mentionHandler,
    onAssetChange,
    onChange,
    onEditorFocus,
    onTransaction,
    placeholder,
    tabIndex,
    titleRef,
    updatePageProperties,
    user,
    actions,
  });

  const editorContainerClassNames = getEditorClassNames({
    noBorder: true,
    borderOnFocus: false,
    containerClassName,
  });

  // Show loader ONLY when cache is known empty and server hasn't synced yet
  const shouldShowSyncLoader = state.isCacheReady && !state.hasCachedContent && !state.isServerSynced;
  const shouldWaitForFallbackBinary = isFetchingFallbackBinary && !state.hasCachedContent && state.isServerDisconnected;
  const isLoading = shouldShowSyncLoader || shouldWaitForFallbackBinary;

  // Gate content rendering on isDocReady to prevent empty editor flash
  const showContentSkeleton = !state.isDocReady;

  if (!editor || !titleEditor) return null;

  return (
    <>
      <div
        className={cn(
          "transition-opacity duration-200",
          showContentSkeleton && !isLoading && "pointer-events-none opacity-0"
        )}
      >
        <PageRenderer
          aiHandler={aiHandler}
          bubbleMenuEnabled={bubbleMenuEnabled}
          displayConfig={displayConfig}
          documentLoaderClassName={documentLoaderClassName}
          disabledExtensions={disabledExtensions}
          extendedDocumentEditorProps={extendedDocumentEditorProps}
          editor={editor}
          flaggedExtensions={flaggedExtensions}
          titleEditor={titleEditor}
          editorContainerClassName={cn(editorContainerClassNames, "document-editor")}
          extendedEditorProps={extendedEditorProps}
          id={id}
          isLoading={isLoading}
          isTouchDevice={!!isTouchDevice}
          tabIndex={tabIndex}
          provider={provider}
          state={state}
        />
      </div>
    </>
  );
}

// Outer component that provides collaboration context
/**
 * Outer component that establishes the `CollaborationProvider` boundary.
 *
 * Passes `docId={id}`, `serverUrl={realtimeConfig.url}`,
 * `authToken={token}`, and `onStateChange={serverHandler?.onStateChange}`
 * to the provider so that everything inside
 * `CollaborativeDocumentEditorInner` has access to a non-null Hocuspocus
 * provider and collaboration state via `useCollaboration()`. Of the props
 * on `ICollaborativeDocumentEditorProps`, only `id`, `realtimeConfig`,
 * `serverHandler`, and `user` are consumed at this level; the remainder is
 * forwarded down via `{...props}`.
 *
 * `token` is derived from `JSON.stringify(user)` via `useMemo` — stability
 * matters because `CollaborationProvider` treats `authToken` changes as a
 * reconnection signal, so unstable JSON encodings would tear down and
 * reopen the WebSocket on every render.
 *
 * The WebSocket connection to `apps/live` (at `realtimeConfig.url`) is
 * opened by `CollaborationProvider`'s effect when this component mounts
 * and closed when it unmounts — which is why the ref wrapper uses
 * `key={props.id}` (see below) to force a full remount when the document
 * id changes and to tear down the prior WebSocket cleanly.
 */
function CollaborativeDocumentEditor(props: ICollaborativeDocumentEditorProps) {
  const { id, realtimeConfig, serverHandler, user } = props;

  const token = useMemo(() => JSON.stringify(user), [user]);

  return (
    <CollaborationProvider
      docId={id}
      serverUrl={realtimeConfig.url}
      authToken={token}
      onStateChange={serverHandler?.onStateChange}
    >
      <CollaborativeDocumentEditorInner {...props} />
    </CollaborationProvider>
  );
}

/**
 * Public ref-forwarding wrapper for the collaborative document editor.
 *
 * Renders `CollaborativeDocumentEditor` with `key={props.id}` so that
 * switching documents fully unmounts the prior subtree (including its
 * Hocuspocus connection) and remounts with fresh collaboration state.
 * Forwards `ref: React.ForwardedRef<EditorRefApi>` down as the
 * `forwardedRef` prop — `EditorRefApi` is the same ref contract used by
 * `DocumentEditorWithRef` (the non-collaborative variant), declared in
 * `packages/editor/src/core/types/editor.ts` and composed from
 * `CoreEditorRefApi` and `TExtendedEditorRefApi`.
 *
 * Exported as `CollaborativeDocumentEditorWithRef` via
 * `export { CollaborativeDocumentEditorWithRef }` on the last line of this
 * file. Surfaced upward via `./index.ts` → `packages/editor/src/index.ts`.
 */
const CollaborativeDocumentEditorWithRef = React.forwardRef(function CollaborativeDocumentEditorWithRef(
  props: ICollaborativeDocumentEditorProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  return (
    <CollaborativeDocumentEditor key={props.id} {...props} forwardedRef={ref as React.MutableRefObject<EditorRefApi>} />
  );
});

CollaborativeDocumentEditorWithRef.displayName = "CollaborativeDocumentEditorWithRef";

export { CollaborativeDocumentEditorWithRef };
