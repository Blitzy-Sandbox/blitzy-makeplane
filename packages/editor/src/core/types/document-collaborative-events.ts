/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Realtime collaboration event type contracts + the `createRealtimeEvent`
 * runtime helper.
 *
 * Dual-purpose module: type definitions (event keys, client/server name
 * unions, payload maps, broadcast unions) are colocated with the runtime
 * helper that constructs concrete event instances. Colocation keeps the
 * helper's return type in lock-step with the unions — adding a new event
 * to the `DocumentCollaborativeEvents` registry automatically extends both
 * the type unions and the shape `createRealtimeEvent` produces.
 *
 * Consumers (types): `EditorRefApi.emitRealTimeUpdate` and
 * `EditorRefApi.listenToRealTimeUpdate` in `core/types/editor.ts`, the
 * collaborative document editor wrappers, and
 * `apps/web/core/hooks/use-collaborative-page-actions.tsx` which drives
 * the client-side state machine for collaborative actions.
 *
 * Consumers (runtime): `apps/live/src/utils/broadcast-error.ts` and
 * `apps/live/src/extensions/title-sync.ts` import `createRealtimeEvent`
 * from `@plane/editor` to build broadcast events on the realtime server.
 *
 * Source of truth: the `DocumentCollaborativeEvents` registry in
 * `core/constants/document-collaborative-events.ts` — every type union in
 * this file is derived from that registry via `typeof` + key remapping.
 */

import type { DocumentCollaborativeEvents } from "@/constants/document-collaborative-events";

// Base type for all action payloads
/**
 * Minimal payload envelope carried by every collaborative action — per-action
 * payload types extend this via `CreatePayload<T>` so that all payloads share
 * a common identity field.
 *
 * `user_id` is optional because some server-side actions originate without an
 * authenticated user context (e.g., scheduled archival or system-driven
 * cleanups); the field is omitted rather than fabricated in those flows.
 */
export type BaseActionPayload = {
  user_id?: string;
};

// Generic type for creating specific payloads
/**
 * Utility generic that builds a per-action payload by intersecting
 * `BaseActionPayload` with the per-action extras `T`.
 *
 * The default `T = Record<string, never>` lets callers write `CreatePayload`
 * (no type argument) for actions that carry only the base `user_id` and no
 * additional fields (e.g., `UnarchivedPayload`).
 */
export type CreatePayload<T = Record<string, never>> = BaseActionPayload & T;

/**
 * Minimal event-emitter contract returned by
 * `EditorRefApi.listenToRealTimeUpdate()` — lets consumers subscribe to and
 * unsubscribe from incoming realtime events whose payloads are
 * `TDocumentEventsClient` action names.
 *
 * Both `on` and `off` are exposed because the editor does not track listeners
 * on behalf of consumers; React components must explicitly unsubscribe on
 * unmount to avoid leaking listeners across remounts.
 */
export type TDocumentEventEmitter = {
  on: (event: string, callback: (message: { payload: TDocumentEventsClient }) => void) => void;
  off: (event: string, callback: (message: { payload: TDocumentEventsClient }) => void) => void;
};

/**
 * Union of keys in the `DocumentCollaborativeEvents` registry — the canonical
 * action identifiers (e.g., `"lock"`, `"archive"`, `"delete"`) used
 * internally by the editor's realtime bridge.
 *
 * Derived from `typeof` rather than hand-maintained so the union stays
 * automatically in sync with the registry constant; adding a new event to
 * the registry extends this union with no additional change here.
 */
export type TDocumentEventKey = keyof typeof DocumentCollaborativeEvents;
/**
 * Two parallel name spaces for collaborative actions: every registry entry
 * has a `client` name (broadcast to clients, past tense — `"archived"`) and
 * a `server` name (received from the server, active voice — `"archive"`).
 *
 * Separating the two prevents accidental cross-use — for example, a client
 * subscribing to `"archive"` when the server actually emits `"archived"`.
 * Consumers pick the namespace appropriate to their side of the wire.
 */
export type TDocumentEventsClient = (typeof DocumentCollaborativeEvents)[TDocumentEventKey]["client"];
/** Server-side action names. See `TDocumentEventsClient` for the group-level explanation. */
export type TDocumentEventsServer = (typeof DocumentCollaborativeEvents)[TDocumentEventKey]["server"];

// In this version, our union of all events (the client names) is:
/**
 * Alias for `TDocumentEventsClient` — a more semantic name for "the universe
 * of event types" when the client/server distinction is not relevant to the
 * caller.
 *
 * Kept as a separate alias (rather than re-using `TDocumentEventsClient`
 * directly) to signal intent: code wanting "all events" reads
 * `TAllEventTypes`; code specifically meaning "client-side names" reads
 * `TDocumentEventsClient`.
 */
export type TAllEventTypes = TDocumentEventsClient;

// Create a mapping from each client event to its payload type using key remapping.
/**
 * Mapped type that pairs each client event name (e.g., `"archived"`) with the
 * payload type declared for that event in the registry's `payloadType` slot.
 *
 * The registry is keyed internally by server names; this type re-keys it by
 * client names so `EventToPayloadMap["archived"]` resolves to
 * `ArchivedPayload`. This is the central contract that lets
 * `createRealtimeEvent<T>` infer the correct `data` payload type from the
 * action name alone — without it, callers would need to supply the payload
 * type as a second generic argument.
 */
export type EventToPayloadMap = {
  [K in keyof typeof DocumentCollaborativeEvents as (typeof DocumentCollaborativeEvents)[K]["client"]]: (typeof DocumentCollaborativeEvents)[K]["payloadType"];
};

// Common fields for every realtime event
/**
 * Scoping + identity envelope attached to every realtime event regardless of
 * the action being broadcast.
 *
 * Field semantics:
 * - `affectedPages.currentPage` / `parentPage` / `descendantPages` — the page
 *   hierarchy graph touched by this event; `apps/live` uses this trio to
 *   decide which connected clients receive the broadcast (every client
 *   subscribed to any page in this graph).
 * - `workspace_slug` (required) — workspace boundary; every event is
 *   workspace-scoped.
 * - `project_id?` (optional) — present when the event originates inside a
 *   project; absent for workspace-level events.
 * - `teamspace_id?` (optional) — present when the event originates inside a
 *   teamspace; absent otherwise.
 * - `user_id` (required) — who triggered the action; clients use this to
 *   suppress self-echo so they do not re-apply their own changes.
 * - `timestamp` — ISO 8601 string, server-assigned at broadcast construction
 *   time; clients use it to order events that arrive out of sequence over
 *   the wire.
 */
export type CommonRealtimeFields = {
  affectedPages: {
    currentPage: string;
    parentPage: string | null;
    descendantPages: string[];
  };
  workspace_slug: string;
  project_id?: string;
  teamspace_id?: string;
  user_id: string;
  timestamp: string;
};

// Helper function to create a realtime event in a type‑safe way.
/**
 * Type-safe constructor that normalizes a server-side action payload into a
 * broadcast-ready realtime event — returns `CommonRealtimeFields &
 * BroadcastedEvent<T>` so downstream subscribers always decode through the
 * same shape.
 *
 * The wrapper exists because server emitters in `apps/live` (extensions,
 * controllers, error broadcasters) raise actions with inconsistent input
 * shapes; this helper enforces a consistent envelope (scoping fields + ISO
 * timestamp + affected pages structure) before the event hits the wire.
 *
 * Default values are applied when the caller omits optional scoping fields,
 * guaranteeing every broadcast is well-formed and never contains
 * `undefined`:
 * - `opts.page_id` falls back to `""` (`affectedPages.currentPage`)
 * - `opts.parent_id` falls back to `null` (`affectedPages.parentPage`)
 * - `opts.descendants_ids` falls back to `[]` (`affectedPages.descendantPages`)
 * - `opts.project_id` falls back to `""`
 * - `opts.teamspace_id` falls back to `""`
 *
 * `timestamp` is server-assigned at construction time via
 * `new Date().toISOString()`, giving every event authoritative ordering
 * metadata regardless of caller behavior.
 *
 * The type parameter `T extends keyof EventToPayloadMap` binds `opts.data`
 * to the registry-declared payload for the action, so callers get
 * compile-time payload validation against `EventToPayloadMap[T]`.
 *
 * Consumers: `apps/live/src/utils/broadcast-error.ts` (error broadcasts) and
 * `apps/live/src/extensions/title-sync.ts` (title-change broadcasts) import
 * this helper from `@plane/editor` to build cross-package broadcast events.
 */
export function createRealtimeEvent<T extends keyof EventToPayloadMap>(
  opts: ApiServerPayload<T>
): CommonRealtimeFields & BroadcastedEvent<T> {
  return {
    affectedPages: {
      currentPage: opts.page_id || "",
      parentPage: opts.parent_id || null,
      descendantPages: opts.descendants_ids || [],
    },
    workspace_slug: opts.workspace_slug,
    project_id: opts.project_id || "",
    teamspace_id: opts.teamspace_id || "",
    user_id: opts.user_id,
    timestamp: new Date().toISOString(),
    action: opts.action,
    data: opts.data,
  };
}

/**
 * Server-side input payload shape accepted by `createRealtimeEvent`.
 *
 * The generic `T extends keyof EventToPayloadMap` binds `action` to a
 * registered client event name and binds `data` to the corresponding payload
 * type from the registry, giving callers compile-time payload validation.
 *
 * Optional fields (`page_id?`, `parent_id?`, `project_id?`, `teamspace_id?`)
 * may be omitted by the caller; `createRealtimeEvent` then applies its
 * documented defaults (`""`, `null`, `""`, `""`) so omission never results
 * in `undefined` reaching the wire. `descendants_ids` is non-optional — the
 * pages reachable from `page_id` whose viewers should also receive the
 * broadcast must be supplied explicitly.
 */
export type ApiServerPayload<T extends keyof EventToPayloadMap> = {
  action: T;
  descendants_ids: string[];
  page_id?: string;
  parent_id?: string;
  data: EventToPayloadMap[T];
  project_id?: string;
  teamspace_id?: string;
  workspace_slug: string;
  user_id: string;
};

// Create a discriminated union for broadcast payloads.
// For every key in EventToPayloadMap, we make a union member with the common fields.
/**
 * Discriminated union of every action-specific `ApiServerPayload<K>` — the
 * type of all possible inputs to `createRealtimeEvent` collapsed into a
 * single union.
 *
 * Top-level dispatchers (e.g., a generic broadcast publisher) accept
 * `BroadcastPayloadUnion` and narrow via the `action` field discriminator:
 * each member of the union has a distinct literal `action` value, so a
 * `switch` on `action` exhaustively narrows `data` to the matching payload
 * type.
 */
export type BroadcastPayloadUnion = {
  [K in keyof EventToPayloadMap]: ApiServerPayload<K>;
}[keyof EventToPayloadMap];

/**
 * Discriminated union of every action-specific `BroadcastedEvent<K>` — the
 * type of all possible outputs from `createRealtimeEvent` collapsed into a
 * single union.
 *
 * Parallel to `BroadcastPayloadUnion` but for the output side: consumers
 * building generic broadcast subscribers (e.g., a single React effect that
 * handles every event type) accept `BroadcastedEventUnion` and narrow via
 * the `action` discriminator.
 */
export type BroadcastedEventUnion = {
  [K in keyof EventToPayloadMap]: BroadcastedEvent<K>;
}[keyof EventToPayloadMap];

/**
 * Wire-format envelope of a single broadcast event — combines
 * `CommonRealtimeFields` (scoping + identity) with the action discriminator
 * and the matching payload from `EventToPayloadMap`.
 *
 * The generic default `T = keyof EventToPayloadMap` lets callers write
 * `BroadcastedEvent` (no type argument) for the broad case (any event); a
 * specific event type can be supplied to narrow `data` to a single payload
 * shape.
 */
export type BroadcastedEvent<T extends keyof EventToPayloadMap = keyof EventToPayloadMap> = CommonRealtimeFields & {
  action: T;
  data: EventToPayloadMap[T];
};
