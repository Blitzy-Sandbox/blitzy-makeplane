/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Structured-error broadcast helper for the `apps/live` real-time collaboration layer.
 * Exports {@link broadcastError}, which converts backend failures (document load and
 * persist errors raised inside the Database extension) into normalized realtime
 * `"error"` events delivered to every client connected to the affected page document.
 *
 * Use sites:
 *   - `apps/live/src/extensions/database.ts` (imported at line 65) — invoked from
 *     `fetchDocument` (line 145) with `"fetch"` errorType when the initial Yjs load
 *     fails, and from `storeDocument` (line 245) with `"store"` errorType plus an
 *     optional `errorCode` and `shouldDisconnect` flag when persistence fails.
 *
 * Delivery transport: delegates to {@link broadcastMessageToPage} from
 * `./broadcast-message.ts`, which publishes through the Hocuspocus `Redis` extension's
 * `broadcastToDocument` mechanism so every server in the cluster fans the event out to
 * its local subscribers of the target document.
 *
 * Architectural role: Redis pub/sub here is for client-awareness broadcasts only —
 * task queueing uses RabbitMQ via `apps/api`. This module emits a transient awareness
 * event visible to connected clients, NOT a background job. The `context` parameter is
 * populated upstream by the authenticated WebSocket connection, where session cookies
 * (NOT JWT) are the auth primitive (see `apps/live/src/lib/auth.ts.onAuthenticate`).
 *
 * Document lifecycle role (`connect → edit → persist → disconnect`): this helper is
 * the error-reporting side-channel.
 *   - `connect` failures → `extensions/database.ts.fetchDocument` catches the
 *     exception and calls `broadcastError(..., "fetch", ...)` so the client receives
 *     a user-visible error before the connection is torn down by the rethrow.
 *   - `persist` failures → `extensions/database.ts.storeDocument` catches the
 *     exception and calls `broadcastError(..., "store", ..., errorCode,
 *     shouldDisconnect)` so the client can render an appropriate UI state and, when
 *     `shouldDisconnect` is `true`, prepare for the impending force-close.
 * A reader can trace the full path `database.ts` → `broadcastError` (this file) →
 * `broadcastMessageToPage` → `Redis.broadcastToDocument` → clients without reading
 * any implementation body.
 *
 * @see HocusPocus 2.15.2 + Y.js 13.6.20 — tech spec section 3.2.6.
 * @see {@link createRealtimeEvent} (from `@plane/editor`) for the event-construction
 *   helper and the {@link BroadcastedEvent} payload shape.
 */

import type { Hocuspocus } from "@hocuspocus/server";
import { createRealtimeEvent } from "@plane/editor";
import { logger } from "@plane/logger";
import type { HocusPocusServerContext } from "@/types";
import { broadcastMessageToPage } from "./broadcast-message";

/**
 * Build a standardized realtime `"error"` event and broadcast it to every client
 * connected to the specified Hocuspocus document. Used by the Database extension's
 * `fetchDocument` and `storeDocument` error paths to surface user-visible failures
 * before rethrowing (or, for the persist path, before force-closing the document).
 *
 * State read: pulls `context.workspaceSlug` and `context.userId` for event metadata
 * with empty-string (`""`) fallbacks. The fallbacks are intentional defensive
 * defaulting — this helper runs INSIDE an already-failing code path, so a missing
 * context field must never trigger a secondary exception during error reporting.
 *
 * State write / emit: constructs a `BroadcastedEvent` via {@link createRealtimeEvent}
 * with `action: "error"`, `page_id: pageId`, `parent_id: undefined` (errors are
 * always page-scoped — never delivered to descendants), `descendants_ids: []`, and a
 * `data` payload `{ error_message, error_type, error_code, should_disconnect,
 * user_id }`. Top-level `workspace_slug` and `user_id` come from the resolved context
 * values. Delivery is delegated to {@link broadcastMessageToPage}; no persistence is
 * performed here — `database.ts.storeDocument` owns the persistence path separately.
 *
 * Error handling: the entire operation is wrapped in `try/catch` that logs failures
 * via `@plane/logger.error("Error broadcasting error message to frontend:", ...)`
 * WITHOUT rethrowing. This is deliberate and critical — error reporting must not
 * introduce a secondary crash inside an already-failing code path (callers in
 * `database.ts` are themselves handling exceptions when they invoke this helper).
 *
 * Idempotency: each invocation produces one broadcast event; repeated calls produce
 * repeated client-visible errors. Callers in `database.ts` invoke this helper
 * exactly once per failed operation, so duplicate broadcasts are not expected under
 * normal operation.
 *
 * @param hocuspocusServerInstance - The running Hocuspocus server; forwarded to
 *   `broadcastMessageToPage`, which uses `configuration.extensions` to locate the
 *   Redis extension instance.
 * @param pageId - Target document name (the Hocuspocus document name; equivalent to
 *   the Plane page id).
 * @param errorMessage - Human-readable error message intended for client display.
 * @param errorType - Origin phase: `"fetch"` for document-load failures originating
 *   in `database.ts.fetchDocument`, `"store"` for persistence failures originating
 *   in `database.ts.storeDocument`.
 * @param context - The authenticated WebSocket connection context populated upstream
 *   by `apps/live/src/lib/auth.ts.onAuthenticate`; read for `workspaceSlug` and
 *   `userId` event metadata.
 * @param errorCode - Optional machine-readable code (`"content_too_large"`,
 *   `"page_locked"`, `"page_archived"`) consumed by the frontend to render an
 *   appropriate UI state. Set by `database.ts.storeDocument` (e.g.,
 *   `"content_too_large"` when the API returns HTTP 413, which aligns with
 *   `ForceCloseReason.DOCUMENT_TOO_LARGE` in `apps/live/src/types/admin-commands.ts`).
 * @param shouldDisconnect - Optional flag instructing the client to prepare for an
 *   impending disconnect; set by `database.ts.storeDocument` when an oversize
 *   document triggers a force-close.
 * @returns `Promise<void>` — fire-and-forget semantics. Success and failure are both
 *   logged internally; callers do not need to await for reliability.
 */
export const broadcastError = async (
  hocuspocusServerInstance: Hocuspocus,
  pageId: string,
  errorMessage: string,
  errorType: "fetch" | "store",
  context: HocusPocusServerContext,
  errorCode?: "content_too_large" | "page_locked" | "page_archived",
  shouldDisconnect?: boolean
) => {
  try {
    const errorEvent = createRealtimeEvent({
      action: "error",
      page_id: pageId,
      parent_id: undefined,
      descendants_ids: [],
      data: {
        error_message: errorMessage,
        error_type: errorType,
        error_code: errorCode,
        should_disconnect: shouldDisconnect,
        user_id: context.userId || "",
      },
      workspace_slug: context.workspaceSlug || "",
      user_id: context.userId || "",
    });

    await broadcastMessageToPage(hocuspocusServerInstance, pageId, errorEvent);
  } catch (broadcastError) {
    logger.error("Error broadcasting error message to frontend:", broadcastError);
  }
};
