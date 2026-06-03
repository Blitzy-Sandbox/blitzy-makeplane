/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Secondary barrel for the `@plane/editor` package exposing collaboration
 * primitives that are consumed independently of the React editor components.
 *
 * This module is the canonical import target for callers that operate on the
 * Y.js / Hocuspocus document layer without instantiating a TipTap editor —
 * most notably `apps/live`, which parses the document schema on the server
 * side, persists Y.js binary updates, and emits collaborative event payloads.
 *
 * Surfaces re-exported:
 *  - Core TipTap extension set without React-bound props (for server-side
 *    ProseMirror schema parsing in `apps/live`).
 *  - Registry of collaborative document event names exchanged between the
 *    client editor and the live server (archive / restore / lock / unlock,
 *    etc.).
 *  - Helper that derives the corresponding server-emitted event name from a
 *    client-issued server action.
 *  - Y.js binary update encode / decode / merge utilities used to persist and
 *    rehydrate document state across the wire.
 *  - TypeScript types for the collaborative-event payloads.
 *
 * @see The `index.ts` barrel for the React/editor-component public surface.
 * @see tech spec §5.2.5.4 for the real-time collaboration sequence.
 * @see apps/live/src/extensions/database.ts for the persistence consumer.
 */
export * from "@/extensions/core-without-props";
export * from "@/constants/document-collaborative-events";
export * from "@/helpers/get-document-server-event";
export * from "@/helpers/yjs-utils";
export * from "@/types/document-collaborative-events";
