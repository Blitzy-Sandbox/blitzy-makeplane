/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Transport-facing delivery helper for page-scoped events in the `apps/live` real-time
 * collaboration layer. Exports {@link broadcastMessageToPage}, which sends a
 * `BroadcastedEvent` to a specific collaborative document via the Hocuspocus `Redis`
 * extension's `broadcastToDocument` mechanism — fanning the message out to every server
 * in the cluster and from there to every connected client on that document.
 *
 * Architectural role: depends on the `Redis` extension instance from `@/extensions/redis`.
 * Redis here is for pub/sub awareness only — task queueing uses RabbitMQ via `apps/api`.
 * This helper publishes a stateless awareness event (e.g. property updates, error
 * notifications), NOT a background job.
 *
 * Use sites:
 *   - `apps/live/src/utils/broadcast-error.ts` (line 40) — relays structured error events
 *     from the Database extension's `fetchDocument` / `storeDocument` error paths.
 *   - `apps/live/src/extensions/title-sync.ts` (line 269) — relays `property_updated`
 *     events to the parent page when a nested page's title changes.
 *
 * Underlying mechanism: `Redis.broadcastToDocument` (see `apps/live/src/extensions/redis.ts`)
 * uses Hocuspocus's wire encoding with an empty server-identifier prefix so all servers
 * (including the publisher) process the message and dispatch it to their local clients.
 *
 * Failure semantics: returns a boolean rather than throwing — every failure mode (missing
 * server, missing Redis extension, exception during publish) logs via `@plane/logger` and
 * returns `false`. The no-throw contract lets callers (especially `broadcastError`) use
 * this helper inside their own error-handling code without risking a secondary exception.
 *
 * Document lifecycle transport role (`connect → edit → persist → disconnect`):
 *   - `connect` errors: `extensions/database.ts.fetchDocument` → `broadcastError` →
 *     this helper → `Redis.broadcastToDocument` → clients on all servers.
 *   - `edit` events: `extensions/title-sync.ts` title-change relay → this helper →
 *     cluster-wide `property_updated` fan-out to subscribers of the parent page.
 *   - `persist` errors: `extensions/database.ts.storeDocument` → `broadcastError` →
 *     this helper → cluster-wide error fan-out.
 *   - `disconnect` is not involved here; force-close uses the separate `hocuspocus:admin`
 *     channel through `extensions/force-close-handler.ts`.
 *
 * @see HocusPocus 2.15.2 + ioredis 5.7.0 — tech spec section 3.2.6.
 * @see {@link BroadcastedEvent} (from `@plane/editor`) for the event payload shape.
 */

import type { Hocuspocus } from "@hocuspocus/server";
import type { BroadcastedEvent } from "@plane/editor";
import { logger } from "@plane/logger";
import { Redis } from "@/extensions/redis";
import { AppError } from "@/lib/errors";

/**
 * Deliver a structured {@link BroadcastedEvent} to all collaborators on a specific
 * Hocuspocus document by publishing through the Redis-backed extension; cluster-aware —
 * peer servers also receive and dispatch the message because the underlying
 * `Redis.broadcastToDocument` uses an empty server-identifier prefix.
 *
 * Behavior (in evaluation order):
 *   1. Server-availability check — if `hocuspocusServerInstance` is falsy or
 *      `hocuspocusServerInstance.documents` is undefined, construct an `AppError` with
 *      `{ operation: "broadcastMessageToPage", documentName }` context, log it, and
 *      return `false`. Guards against pre-startup and post-shutdown invocation.
 *   2. Redis extension lookup — search `configuration.extensions` for the singleton
 *      `Redis` extension via `instanceof Redis`. The same lookup pattern is used in
 *      `extensions/force-close-handler.ts` and is the canonical extension-discovery
 *      convention in `apps/live`.
 *   3. Missing-extension guard — if no `Redis` extension is found, log and return
 *      `false`. Defensive only: under correct configuration the `Redis` extension is
 *      always registered (third entry of `extensions/index.ts.getExtensions`).
 *   4. Broadcast invocation — call `redisExtension.broadcastToDocument(documentName,
 *      eventData)` inside a `try/catch`. The underlying method uses Hocuspocus's wire
 *      encoding with an empty server-identifier prefix so every server (including this
 *      one) dispatches the message to its local clients.
 *   5. Return `true` on successful publish, `false` on any caught exception (logged with
 *      the document name for diagnostic context).
 *
 * Error handling: structured precondition failures use {@link AppError} from
 * `@/lib/errors`; runtime exceptions are caught and logged via `@plane/logger.error`.
 * **Never throws** — boolean return is the only error signal, so callers can use this
 * helper inside their own error-handling paths without risking a secondary exception.
 *
 * Idempotency: each invocation publishes one message; repeated calls with the same
 * payload produce repeated client-visible events. Callers are responsible for
 * single-invocation-per-logical-event semantics.
 *
 * @param hocuspocusServerInstance - The running Hocuspocus server instance; required to
 *   access `configuration.extensions` for locating the Redis extension and to verify
 *   `documents` is initialized.
 * @param documentName - The target Hocuspocus document name (equivalent to the page id);
 *   used by the Redis extension to construct the per-document publish channel.
 * @param eventData - The event payload to broadcast; typically constructed via
 *   `createRealtimeEvent` from `@plane/editor`.
 * @returns `true` if the message was successfully published to Redis; `false` on any
 *   precondition failure or runtime exception. Note: `true` does NOT guarantee delivery
 *   to any specific client — only that the publish to Redis succeeded.
 */
export const broadcastMessageToPage = async (
  hocuspocusServerInstance: Hocuspocus,
  documentName: string,
  eventData: BroadcastedEvent
): Promise<boolean> => {
  if (!hocuspocusServerInstance || !hocuspocusServerInstance.documents) {
    const appError = new AppError("HocusPocus server not available or initialized", {
      context: { operation: "broadcastMessageToPage", documentName },
    });
    logger.error("Error while broadcasting message:", appError);
    return false;
  }

  const redisExtension = hocuspocusServerInstance.configuration.extensions.find((ext) => ext instanceof Redis);

  if (!redisExtension) {
    logger.error("BROADCAST_MESSAGE_TO_PAGE: Redis extension not found");
    return false;
  }

  try {
    await redisExtension.broadcastToDocument(documentName, eventData);
    return true;
  } catch (error) {
    logger.error(`BROADCAST_MESSAGE_TO_PAGE: Error broadcasting to ${documentName}:`, error);
    return false;
  }
};
