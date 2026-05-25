/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical registry for collaborative document events: the single source of truth
 * mapping each server-emitted action key (`lock`, `archive`, `move`, ...) to its
 * client-facing event name plus a phantom `payloadType` sample whose static type is
 * extracted by `EventToPayloadMap` in `core/types/document-collaborative-events.ts`.
 *
 * This module is shared across the `@plane/editor` browser bundle and the
 * `apps/live` Node service so that both ends of the WebSocket negotiate identical
 * event names without a separate schema artifact.
 *
 * Consumers:
 * - `apps/live/src/lib/stateless.ts` — performs the server→client name lookup
 *   inside `onStateless` before re-broadcasting via `document.broadcastStateless`.
 * - `core/helpers/get-document-server-event.ts` — performs the inverse client→server
 *   name lookup when the browser needs to address a backend route by its action key.
 * - `core/types/document-collaborative-events.ts` — derives `TDocumentEventKey`,
 *   `TDocumentEventsClient`, `TDocumentEventsServer`, and `EventToPayloadMap` from
 *   the literal-string and phantom-type slots in this registry.
 */

import type { EPageAccess } from "@plane/constants";
import type { TPage } from "@plane/types";
import type { CreatePayload, BaseActionPayload } from "@/types";

// Define all payload types for each event.
/**
 * Payload-shape aliases for every collaborative document event in this registry.
 *
 * All non-base aliases extend `BaseActionPayload` (which contributes the optional
 * `user_id` field) via the `CreatePayload<T>` helper; both are imported from
 * `@/types` (which re-exports them from `core/types/document-collaborative-events.ts`).
 * The remaining shape primitives — `EPageAccess` (from `@plane/constants`) and
 * `TPage` (from `@plane/types`) — keep this file aligned with the canonical domain
 * vocabulary; consult those modules for per-field documentation rather than
 * re-stating field meanings here.
 */
/** Emitted on archive; `archived_at` is the ISO timestamp on archive, `null` when the field has not yet been set. */
export type ArchivedPayload = CreatePayload<{ archived_at: string | null }>;
/** Pure transition signal for un-archive — carries no domain fields beyond the optional `user_id` from `BaseActionPayload`. */
export type UnarchivedPayload = BaseActionPayload;
/** Carries the resulting `is_locked` flag — typically `true` immediately after a successful lock action. */
export type LockedPayload = CreatePayload<{ is_locked: boolean }>;
/** Pure transition signal for unlock — carries no domain fields beyond the optional `user_id` from `BaseActionPayload`. */
export type UnlockedPayload = BaseActionPayload;
/** Carries the new `access` enum value after visibility flips to public; see `EPageAccess` for the valid set. */
export type MadePublicPayload = CreatePayload<{ access: EPageAccess }>;
/** Carries the new `access` enum value after visibility flips to private; see `EPageAccess` for the valid set. */
export type MadePrivatePayload = CreatePayload<{ access: EPageAccess }>;
/** Carries `deleted_at` — the soft-delete timestamp set on delete, or `null` when the page is restored. */
export type DeletedPayload = CreatePayload<{ deleted_at: Date | null }>;
/** Carries `new_page_id` so consumers can navigate to (or hydrate) the duplicated page without a follow-up fetch. */
export type DuplicatedPayload = CreatePayload<{ new_page_id: string }>;
/** Carries a partial `TPage` patch for arbitrary property mutations (title, color, icon, etc.) — only changed keys are populated. */
export type PropertyUpdatedPayload = CreatePayload<Partial<TPage>>;
/** Carries `new_project_id` and `new_page_id` so cross-project moves can be reconciled on every client. */
export type MovedPayload = CreatePayload<{
  new_project_id: string;
  new_page_id: string;
}>;
/** Carries the optional list of descendant pages that were restored alongside the parent in a cascading restore. */
export type RestoredPayload = CreatePayload<{ deleted_page_ids?: string[] }>;
/**
 * Surface for transport- and validation-level failures emitted by the live server.
 *
 * `should_disconnect` flags fatal cases that require the client to drop the
 * WebSocket connection; `error_code` (when present) narrows the failure to a
 * known recoverable case (`content_too_large` | `page_locked` | `page_archived`).
 */
export type ErrorPayload = CreatePayload<{
  error_message: string;
  error_type: "fetch" | "store";
  error_code?: "content_too_large" | "page_locked" | "page_archived";
  should_disconnect?: boolean;
}>;

// Enhanced DocumentCollaborativeEvents with payload types.
// Both the client name and server name are defined, and we add a "payloadType" property
// so that we can later derive a mapping from client event to payload type.
/**
 * Registry mapping each server event key to a `{ client, server, payloadType }`
 * triple, where `payloadType` is an `{} as XPayload` phantom slot — the runtime
 * value is an empty object but its TypeScript type carries the payload shape into
 * `EventToPayloadMap` in `core/types/document-collaborative-events.ts`.
 *
 * The trailing `as const` is load-bearing: it preserves literal-string narrowing so
 * that `TDocumentEventsClient` and `TDocumentEventsServer` resolve to exact string
 * literal unions rather than collapsing to `string`. Removing it would silently
 * break exhaustive switch coverage and key-based lookups in every consumer.
 *
 * Consumers:
 * - `core/types/document-collaborative-events.ts` — derives `TDocumentEventKey`,
 *   `TDocumentEventsClient`, `TDocumentEventsServer`, and `EventToPayloadMap`.
 * - `core/helpers/get-document-server-event.ts` — iterates the keys to perform
 *   client→server event-name lookups.
 * - `apps/live/src/lib/stateless.ts` — performs the inverse server→client name
 *   lookup via `DocumentCollaborativeEvents[payload]?.client`.
 */
export const DocumentCollaborativeEvents = {
  lock: {
    client: "locked",
    server: "lock",
    payloadType: {} as LockedPayload,
  },
  unlock: {
    client: "unlocked",
    server: "unlock",
    payloadType: {} as UnlockedPayload,
  },
  archive: {
    client: "archived",
    server: "archive",
    payloadType: {} as ArchivedPayload,
  },
  unarchive: {
    client: "unarchived",
    server: "unarchive",
    payloadType: {} as UnarchivedPayload,
  },
  "make-public": {
    client: "made-public",
    server: "make-public",
    payloadType: {} as MadePublicPayload,
  },
  "make-private": {
    client: "made-private",
    server: "make-private",
    payloadType: {} as MadePrivatePayload,
  },
  delete: {
    client: "deleted",
    server: "delete",
    payloadType: {} as DeletedPayload,
  },
  move: {
    client: "moved",
    server: "move",
    payloadType: {} as MovedPayload,
  },
  duplicate: {
    client: "duplicated",
    server: "duplicate",
    payloadType: {} as DuplicatedPayload,
  },
  property_update: {
    client: "property_updated",
    server: "property_update",
    payloadType: {} as PropertyUpdatedPayload,
  },
  restore: {
    client: "restored",
    server: "restore",
    payloadType: {} as RestoredPayload,
  },
  error: {
    client: "error",
    server: "error",
    payloadType: {} as ErrorPayload,
  },
} as const;
