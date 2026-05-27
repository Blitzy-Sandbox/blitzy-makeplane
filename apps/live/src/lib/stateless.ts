/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stateless relay protocol for the apps/live Hocuspocus collaboration server.
 *
 * Wiring: `onStateless` is registered on the Hocuspocus server constructor in
 * `apps/live/src/hocuspocus.ts` (see `new Hocuspocus({ onStateless })` inside
 * `HocusPocusServerManager.initialize`). It is invoked every time any connected
 * client posts a message through Hocuspocus's client-side `sendStateless` API.
 *
 * Why stateless instead of Yjs CRDT: Yjs document updates carry text content
 * and are merged + persisted by `apps/live/src/extensions/database.ts`. The
 * collaborative property events handled here carry small metadata payloads
 * (page locked, archived, made public, moved, duplicated, deleted, etc.) and
 * benefit from a no-merge, no-persistence fan-out channel — the relay simply
 * translates the server-side event key into the matching client-facing event
 * name and broadcasts it to every connection on the document.
 *
 * Use cases:
 *   - Page lifecycle events that originate server-side and must be reflected
 *     in all open editor instances (lock/unlock, archive/unarchive,
 *     make-public/make-private, move, duplicate, delete, restore).
 *   - `property_update` and `error` events that need cross-client visibility
 *     without re-fetching document state.
 *
 * Related broadcast helpers (NOT invoked here; included for orientation):
 *   - `apps/live/src/utils/broadcast-message.ts` — document-scoped broadcasts
 *     used by extensions; fans out through the Redis pub/sub extension so
 *     other apps/live pods on the same Redis cluster receive the event.
 *   - `apps/live/src/utils/broadcast-error.ts` — error-channel wrapper that
 *     composes `broadcastMessageToPage` to emit a typed error event.
 *
 * Shared event vocabulary: `DocumentCollaborativeEvents` is imported from
 * `@plane/editor/lib`, so the frontend editor and `apps/live` derive their
 * server- and client-side event names from the same source — `TDocumentEventsServer`
 * gives end-to-end type safety between the editor's `sendStateless` call sites
 * and this server-side relay.
 *
 * Document lifecycle traceability (connect → edit → persist → disconnect):
 *   - connect: `onAuthenticate` from `@/lib/auth` validates the handshake.
 *   - edit: Yjs CRDT updates flow through Hocuspocus core + `extensions/database.ts`.
 *   - stateless broadcasts: this `onStateless` hook fans out out-of-band
 *     collaborative messages (locks, archives, property updates, etc.).
 *   - disconnect: voluntary close requires no cleanup here; involuntary
 *     force-close coordination is handled by
 *     `apps/live/src/extensions/force-close-handler.ts`, which uses
 *     `connection.sendStateless` per-connection rather than the
 *     document-wide `broadcastStateless` fan-out used by this module.
 *
 * See tech spec §5.2.5 (Real-Time Collaboration).
 */

import type { onStatelessPayload } from "@hocuspocus/server";
import { DocumentCollaborativeEvents } from "@plane/editor/lib";
import type { TDocumentEventsServer } from "@plane/editor/lib";

/**
 * Hocuspocus `onStateless` hook — translates the server-side event key sent by
 * the originating client into the matching client-facing event name and fans
 * the result out to every connection subscribed to the document.
 *
 * Trigger: invoked when any connected client posts a stateless message through
 * Hocuspocus's `sendStateless` API (frontend editor flows that emit page
 * lifecycle events, and any other client-driven stateless broadcast).
 *
 * State read:
 *   - `payload` — narrowed to `TDocumentEventsServer`; expected values are the
 *     server-side keys defined on `DocumentCollaborativeEvents` (`"lock"`,
 *     `"unlock"`, `"archive"`, `"unarchive"`, `"make-public"`, `"make-private"`,
 *     `"delete"`, `"move"`, `"duplicate"`, `"property_update"`, `"restore"`,
 *     `"error"`).
 *   - `DocumentCollaborativeEvents[payload]?.client` — resolves to the matching
 *     client-facing event name (e.g. `"lock"` → `"locked"`, `"archive"` →
 *     `"archived"`, `"make-public"` → `"made-public"`).
 *
 * State write / broadcast: when a client mapping is found,
 * `document.broadcastStateless(response)` fan-outs the resolved client event
 * to ALL connections subscribed to the document (the originating sender
 * included). This is a Hocuspocus-internal in-memory fan-out limited to the
 * current pod; cross-pod fan-out is handled separately by the Redis extension
 * via `apps/live/src/utils/broadcast-message.ts`.
 *
 * No-op behavior: when `payload` does not match any key in
 * `DocumentCollaborativeEvents`, the hook returns without broadcasting.
 * Unknown event keys are intentionally ignored so that additions to the
 * server-side vocabulary cannot crash older live-server pods during a rolling
 * deploy.
 *
 * Persistence side effects: NONE. This hook does not write to the database,
 * call apps/api, or mutate the Y.Doc — it is a pure in-process fan-out relay.
 *
 * @param data - Hocuspocus `onStatelessPayload` containing `document`,
 *   `documentName`, `payload`, `connection`, and `context`. Only `payload`
 *   (the server-side event key) and `document` (the broadcast target) are
 *   read by this hook; the destructuring exposes both directly.
 * @returns Promise that resolves once the synchronous fan-out (or no-op) is
 *   complete. The function is declared `async` to satisfy the Hocuspocus
 *   `onStateless` signature; no awaited work occurs inside the body.
 * @see `@plane/editor/lib` `DocumentCollaborativeEvents` for the canonical
 *   server-key → client-key event registry.
 * @see Tech spec §5.2.5 (Real-Time Collaboration).
 */
export const onStateless = async ({ payload, document }: onStatelessPayload) => {
  const response = DocumentCollaborativeEvents[payload as TDocumentEventsServer]?.client;
  if (response) {
    document.broadcastStateless(response);
  }
};
