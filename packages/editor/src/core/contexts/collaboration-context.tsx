/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React context API for Yjs-backed collaborative editing — exposes the `CollaborationProvider`
 * component and the typed `useCollaboration` consumer hook, both built on top of `useYjsSetup`
 * from `@/hooks/use-yjs-setup`. The canonical consumer is the collaborative document editor
 * at `core/components/editors/document/collaborative-editor.tsx`, which mounts the provider
 * at its tree root and reads the context from descendant components.
 */

import React, { createContext, useContext } from "react";
// hooks
import { useYjsSetup } from "@/hooks/use-yjs-setup";

/**
 * Non-null, fully-initialized shape of the collaboration setup — derived as
 * `NonNullable<ReturnType<typeof useYjsSetup>>` so the context contract stays in lockstep
 * with the underlying hook's return type without manual re-declaration.
 */
export type TCollabValue = NonNullable<ReturnType<typeof useYjsSetup>>;

/**
 * React context carrying the collaboration setup; the `null` default is a deliberate sentinel
 * that lets `useCollaboration` fail fast when consumed outside a `<CollaborationProvider>`,
 * surfacing a programming error at the misuse site rather than masking it as a runtime fallback.
 */
const CollabContext = createContext<TCollabValue | null>(null);

/**
 * Props for `CollaborationProvider` — derived as `Parameters<typeof useYjsSetup>[0]` extended
 * with React `children` and an optional `fallback` node, keeping the provider's public API
 * tightly coupled to the underlying setup hook's parameter contract.
 */
type CollabProviderProps = Parameters<typeof useYjsSetup>[0] & {
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Provider component that initializes Yjs-backed collaboration via `useYjsSetup(args)` and
 * exposes the resulting non-null `TCollabValue` through `CollabContext`. Props are typed by
 * `CollabProviderProps`, which extends the `useYjsSetup` first-parameter contract (`docId`,
 * `serverUrl`, `authToken`, optional `onStateChange`, optional `options`) with `children`
 * and an optional `fallback`.
 *
 * Fallback semantics: while `useYjsSetup` returns `null` during the initial provider-setup
 * window (before the `HocuspocusProvider` and `Y.Doc` pair are constructed), this component
 * renders `fallback` instead of `children`. The fallback gates ONLY on collaboration-setup
 * availability — it does NOT gate on document readiness; consumers that need doc-readiness
 * gating must read `state.isDocReady` from the context value themselves.
 *
 * Side effects: starts a `HocuspocusProvider` lifecycle through `useYjsSetup` — see
 * `core/hooks/use-yjs-setup.ts` for the underlying Y.Doc, IndexedDB persistence, and
 * websocket connectivity wiring.
 */
export function CollaborationProvider({ fallback = null, children, ...args }: CollabProviderProps) {
  const setup = useYjsSetup(args);

  // Only wait for provider setup, not content ready
  // Consumers can check state.isDocReady to gate content rendering
  if (!setup) {
    return <>{fallback}</>;
  }

  return <CollabContext.Provider value={setup}>{children}</CollabContext.Provider>;
}

/**
 * Typed consumer hook returning the current `TCollabValue` from `CollabContext`. Throws when
 * called outside a `<CollaborationProvider>` because using this hook without the provider is
 * a programming error, not a runtime fallback — throwing surfaces the misuse immediately
 * rather than silently returning `null` and causing a downstream null-deref crash far from
 * the actual misuse site.
 */
export function useCollaboration(): TCollabValue {
  const ctx = useContext(CollabContext);
  if (!ctx) {
    throw new Error("useCollaboration must be used inside <CollaborationProvider>");
  }
  return ctx; // guaranteed non-null
}
