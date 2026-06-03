/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Distributed force-close orchestration for the apps/live real-time collaboration server.
 *
 * Exports two complementary primitives that together coordinate cluster-wide termination of
 * a Yjs document session across every apps/live instance:
 *
 * 1. `ForceCloseHandler` (inbound role) -- a Hocuspocus `Extension` that, during
 *    `onConfigure`, locates the registered `Redis` extension and subscribes a handler to
 *    `AdminCommand.FORCE_CLOSE` admin messages on the `hocuspocus:admin` Redis pub/sub
 *    channel. When any peer server broadcasts a force-close for a docId this server is
 *    currently hosting, the handler sends a `force_close` stateless message to every local
 *    client (so the apps/web client can render a user-facing reason) and then closes each
 *    local WebSocket connection with the supplied `CloseCode`.
 *
 * 2. `forceCloseDocumentAcrossServers` (outbound role) -- an async helper invoked locally
 *    (e.g., from `apps/live/src/extensions/database.ts.storeDocument` when apps/api returns
 *    HTTP 413 Content Too Large) that performs the local shutdown sequence AND publishes
 *    `AdminCommand.FORCE_CLOSE` to the Redis admin channel so peer servers terminate their
 *    own copies in the same way. Finally unloads the Yjs Y.Doc from this server's memory.
 *
 * Registration order is significant -- `ForceCloseHandler` MUST be registered AFTER `Redis`
 * in `apps/live/src/extensions/index.ts.getExtensions()` because its `onConfigure` hook
 * locates the Redis extension via `instance.configuration.extensions.find(...)`. If the
 * Redis extension is missing or registered later, the lookup returns `undefined`, a warning
 * is logged, and inbound force-close broadcasts are silently dropped (the outbound helper
 * still runs locally but cannot notify peers).
 *
 * Architectural notes (per AAP architectural context):
 * - Redis pub/sub is used here for **admin commands only** -- the `hocuspocus:admin`
 *   channel is dedicated to cluster-wide control-plane events (force-close, health-check).
 *   Task queueing in the wider Plane platform goes through RabbitMQ via apps/api Celery,
 *   NOT through this channel.
 * - Force-close is a **coordination primitive**, not a workflow. The sequence is
 *   intentionally synchronous with explicit 50ms (post-message-send) and 800ms
 *   (post-broadcast) waits so observers can verify connections were closed before the
 *   document is unloaded from memory.
 * - Custom WebSocket close codes (4000-4003) are defined in `@/types/admin-commands.CloseCode`;
 *   the apps/web client reads `CloseEvent.code` to map these to user-facing messages.
 *
 * Document lifecycle role -- this module owns the **involuntary `disconnect`** phase of
 * the `connect -> edit -> persist -> disconnect` lifecycle:
 * - `connect` is handled in `apps/live/src/lib/auth.ts` (not this file).
 * - `edit` is handled by Hocuspocus core / the Yjs base extension (not this file).
 * - `persist` is handled by `apps/live/src/extensions/database.ts.storeDocument` (not this
 *   file). When that hook encounters an unrecoverable error (HTTP 413 from apps/api), it
 *   calls `forceCloseDocumentAcrossServers` (this file) to begin the cluster-wide
 *   termination sequence; every peer server then runs the inbound path through
 *   `ForceCloseHandler.onConfigure`'s registered handler.
 *
 * Stack: HocusPocus 2.15.2 + ioredis 5.7.0 (tech spec sec. 3.2.6).
 */

import type { Connection, Extension, Hocuspocus, onConfigurePayload } from "@hocuspocus/server";
import { logger } from "@plane/logger";
import { Redis } from "@/extensions/redis";
import { AdminCommand, CloseCode, getForceCloseMessage, isForceCloseCommand } from "@/types/admin-commands";
import type { ForceCloseReason, ClientForceCloseMessage, ForceCloseCommandData } from "@/types/admin-commands";

/**
 * Extension to handle force close commands from other servers via Redis admin channel
 *
 * Inbound side of the force-close coordination protocol: subscribes (via the `Redis`
 * extension's `onAdminCommand` registry) to `AdminCommand.FORCE_CLOSE` messages on the
 * cluster-wide `hocuspocus:admin` Redis pub/sub channel and, for any received command whose
 * `docId` matches a document this server is currently hosting, terminates every local
 * client session for that document.
 *
 * Hooks contributed:
 * - `onConfigure({ instance })` -- lifecycle hook invoked once during Hocuspocus server
 *   bootstrap (before any client connections are accepted). Locates the `Redis` extension
 *   via `instance.configuration.extensions.find((ext) => ext instanceof Redis)` and
 *   registers a `<ForceCloseCommandData>` handler via `redisExt.onAdminCommand(...)`.
 *
 * Class fields:
 * - `name = "ForceCloseHandler"` -- Hocuspocus extension identifier used in diagnostic logs.
 * - `priority = 999` -- high priority so this extension's hooks run after lower-priority
 *   extensions; Hocuspocus uses priority to order hook invocation across registered
 *   extensions.
 *
 * Trigger for the registered admin-command handler: an `AdminCommand.FORCE_CLOSE` message
 * arrives on the `hocuspocus:admin` Redis channel from any server in the cluster (including
 * this server itself -- Redis pub/sub fan-out is non-self-exclusive).
 *
 * State read by the handler:
 * - `isForceCloseCommand(data)` -- payload type guard from `@/types/admin-commands`;
 *   malformed messages are rejected with an error log and ignored.
 * - Destructured `docId`, `reason` (`ForceCloseReason`), `code` (`CloseCode`) from the
 *   command payload.
 * - `instance.documents.get(docId)` -- returns `undefined` if this server is not currently
 *   hosting that document, in which case the handler silently returns (each server only
 *   acts on documents it owns).
 * - `document.getConnectionsCount()` -- count of local clients for the affected document.
 * - `document.connections` -- iterable of `{ connection }` entries for this server's
 *   clients.
 *
 * State write / side effects of the handler:
 * - Step 1: constructs a `ClientForceCloseMessage` (`type: "force_close"`, `reason`, `code`,
 *   human-readable `message` via `getForceCloseMessage(reason)`, ISO `timestamp`) and sends
 *   it to each local client via `connection.sendStateless(JSON.stringify(...))`. Per-
 *   connection failures are logged but do not abort the iteration so a single broken
 *   socket cannot block notification of the others.
 * - Waits 50ms so the stateless messages have time to land on the wire before the WebSocket
 *   is closed (a too-eager `close()` would drop the message before the client sees it).
 * - Step 2: calls `connection.close({ code, reason })` on each local client. Per-connection
 *   failures are logged but do not abort the iteration.
 *
 * Registration order requirement: MUST be registered AFTER the `Redis` extension in
 * `getExtensions()` (see `apps/live/src/extensions/index.ts` -- the comment there reads
 * `// Must be after Redis to receive broadcasts`). If `Redis` is missing, the `onConfigure`
 * hook logs `[FORCE_CLOSE_HANDLER] Redis extension not found` and returns silently --
 * inbound force-close broadcasts are dropped but server startup continues.
 *
 * Idempotency: yes -- receiving the same `FORCE_CLOSE` command twice for the same `docId`
 * is safe. The first invocation closes the connections and unloads the document; the second
 * invocation finds nothing in `instance.documents` and returns at the early-return guard.
 */
export class ForceCloseHandler implements Extension {
  name = "ForceCloseHandler";
  priority = 999;

  /**
   * Hocuspocus lifecycle hook invoked once during server bootstrap, before any client
   * connections are accepted.
   *
   * State read: scans `instance.configuration.extensions` for an instance of the `Redis`
   * extension via `instanceof Redis`. The lookup is necessary because Hocuspocus does not
   * provide a built-in extension registry by type -- extensions discover each other through
   * the configuration list.
   *
   * State write: if the Redis extension is found, calls
   * `redisExt.onAdminCommand(AdminCommand.FORCE_CLOSE, async (data) => { ... })` to attach
   * the inbound force-close handler. The handler is invoked by `Redis.handleAdminMessage`
   * whenever a JSON message with `command: "force_close"` is published to the
   * `hocuspocus:admin` Redis pub/sub channel.
   *
   * Failure mode: if the Redis extension is not present in the configuration, logs
   * `[FORCE_CLOSE_HANDLER] Redis extension not found` and returns -- inbound force-close
   * coordination is disabled but server startup is NOT blocked (the outbound helper
   * `forceCloseDocumentAcrossServers` still runs locally, just without notifying peers).
   *
   * @param payload - Hocuspocus configuration payload; only `instance` is consumed.
   */
  async onConfigure({ instance }: onConfigurePayload) {
    const redisExt = instance.configuration.extensions.find((ext) => ext instanceof Redis);

    if (!redisExt) {
      logger.warn("[FORCE_CLOSE_HANDLER] Redis extension not found");
      return;
    }

    // Register handler for force_close admin command
    redisExt.onAdminCommand<ForceCloseCommandData>(AdminCommand.FORCE_CLOSE, async (data) => {
      // Type guard for safety
      if (!isForceCloseCommand(data)) {
        logger.error("[FORCE_CLOSE_HANDLER] Received invalid force close command");
        return;
      }

      const { docId, reason, code } = data;

      const document = instance.documents.get(docId);
      if (!document) {
        // Not our document, ignore
        return;
      }

      const connectionCount = document.getConnectionsCount();
      logger.info(`[FORCE_CLOSE_HANDLER] Sending force close message to ${connectionCount} clients...`);

      // Step 1: Send force close message to ALL clients first
      const forceCloseMessage: ClientForceCloseMessage = {
        type: "force_close",
        reason,
        code,
        message: getForceCloseMessage(reason),
        timestamp: new Date().toISOString(),
      };

      let messageSent = 0;
      document.connections.forEach(({ connection }: { connection: Connection }) => {
        try {
          connection.sendStateless(JSON.stringify(forceCloseMessage));
          messageSent++;
        } catch (error) {
          logger.error("[FORCE_CLOSE_HANDLER] Failed to send message:", error);
        }
      });

      logger.info(`[FORCE_CLOSE_HANDLER] Sent force close message to ${messageSent}/${connectionCount} clients`);

      // Wait a moment for messages to be delivered
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Step 2: Close connections
      logger.info(`[FORCE_CLOSE_HANDLER] Closing ${connectionCount} connections...`);

      let closed = 0;
      document.connections.forEach(({ connection }: { connection: Connection }) => {
        try {
          connection.close({ code, reason });
          closed++;
        } catch (error) {
          logger.error("[FORCE_CLOSE_HANDLER] Failed to close connection:", error);
        }
      });

      logger.info(`[FORCE_CLOSE_HANDLER] Closed ${closed}/${connectionCount} connections for ${docId}`);
    });

    logger.info("[FORCE_CLOSE_HANDLER] Registered with Redis extension");
  }
}

/**
 * Force close all connections to a document across all servers and unload it from memory.
 * Used for critical errors or admin operations.
 *
 * Outbound side of the force-close coordination protocol. Invoke from server-side code
 * when local logic determines a document session must be terminated everywhere -- e.g.,
 * `apps/live/src/extensions/database.ts.storeDocument` calls this when apps/api returns
 * HTTP 413 Content Too Large, signalling the Yjs document has grown past the persistable
 * size limit. NOT a Hocuspocus hook -- it must be invoked explicitly.
 *
 * Trigger: explicit invocation from server-side code (NOT a Hocuspocus hook).
 *
 * State read: `instance.documents.get(pageId)` -- if the document is not currently held in
 * memory the function returns immediately at STEP 1 (no-op safety; another flow may have
 * already unloaded it).
 *
 * Sequence (matches the inline `STEP N:` headers in the implementation):
 *
 * STEP 1 -- VERIFY DOCUMENT EXISTS: looks up `instance.documents.get(pageId)`; if not
 * present, logs an informational message and returns (document already unloaded; nothing
 * to coordinate).
 *
 * Construct `ClientForceCloseMessage`: builds the `{ type: "force_close", reason, code,
 * message: getForceCloseMessage(reason), timestamp }` payload that local clients will
 * receive via `sendStateless`. The human-readable `message` comes from
 * `@/types/admin-commands.getForceCloseMessage` so apps/web does not need its own copy of
 * the reason-to-message mapping.
 *
 * Send `force_close` stateless message to all local clients via
 * `connection.sendStateless(JSON.stringify(forceCloseMessage))`. Per-connection failures
 * are logged but iteration continues. Waits 50ms after sending so the stateless frames
 * land on the wire before STEP 3 starts closing the underlying sockets.
 *
 * STEP 3 -- CLOSE LOCAL CONNECTIONS: calls `connection.close({ code, reason })` on each
 * local client of the document. Per-connection failures are logged but iteration
 * continues -- one broken socket must not prevent the rest from being closed.
 *
 * STEP 4 -- BROADCAST TO OTHER SERVERS: locates the Redis extension via
 * `instance.configuration.extensions.find((ext) => ext instanceof Redis)`. If found,
 * constructs a `ForceCloseCommandData` with `command: AdminCommand.FORCE_CLOSE`, `docId`,
 * `reason`, `code`, `originServer` (`instance.configuration.name || "unknown"`), and a
 * fresh ISO `timestamp`, then publishes it via `redisExt.publishAdminCommand(commandData)`.
 * Peer servers receive it on the `hocuspocus:admin` channel and run their inbound path
 * through `ForceCloseHandler.onConfigure`'s registered handler. If Redis is not present,
 * logs a warning and skips the broadcast -- the local termination still completes.
 *
 * STEP 5 -- WAIT FOR OTHER SERVERS: sleeps 800ms (`await new Promise((r) => setTimeout(r,
 * 800))`) to give peer servers time to close their own connections to the same docId
 * before this server unloads the in-memory Y.Doc. Without this grace period, a peer's
 * still-open WebSocket could trigger Hocuspocus to re-load the document immediately after
 * the local unload.
 *
 * STEP 6 -- UNLOAD DOCUMENT: calls `await instance.unloadDocument(document)` to free the
 * in-memory Yjs Y.Doc state. Unload failures are caught, logged, and swallowed -- the
 * function does NOT throw on unload failure (a follow-up flow may retry; throwing here
 * would propagate into the caller's storeDocument hook with no useful recovery path).
 *
 * STEP 7 -- VERIFY UNLOAD: re-reads `instance.documents.get(pageId)`; if the document is
 * still present, logs an error including the lingering connection count. Does not retry or
 * throw -- the error is logged for operator visibility but the helper still returns
 * successfully so the caller (e.g., `database.ts.storeDocument`) can continue its own
 * error path.
 *
 * Side effects across the cluster:
 * - Every local client receives a `force_close` stateless message and has its WebSocket
 *   closed with the supplied `CloseCode`.
 * - Peer servers subscribed to the `hocuspocus:admin` Redis channel receive the
 *   `AdminCommand.FORCE_CLOSE` and run the inbound path in `ForceCloseHandler`.
 * - The local document is unloaded from `instance.documents` and its Yjs Y.Doc memory is
 *   freed.
 *
 * Idempotency: yes. Calling this for an already-unloaded document returns immediately at
 * STEP 1. Calling it concurrently for the same `pageId` may publish duplicate Redis
 * messages, but the inbound handler in `ForceCloseHandler` is itself idempotent (no-op
 * when the target document is no longer held by `instance.documents.get`), so duplicate
 * cluster broadcasts are safe.
 *
 * Common callers:
 * - `apps/live/src/extensions/database.ts.storeDocument` -- on HTTP 413 from apps/api
 *   (document too large to persist).
 * - May be invoked by future admin endpoints in `apps/live/src/controllers/`.
 *
 * @param instance - The Hocuspocus server instance
 * @param pageId - The document ID to force close
 * @param reason - The reason for force closing
 * @param code - Optional WebSocket close code (defaults to FORCE_CLOSE)
 * @returns Promise that resolves when document is closed and unloaded
 * @throws Error if document not found in memory
 */
export const forceCloseDocumentAcrossServers = async (
  instance: Hocuspocus,
  pageId: string,
  reason: ForceCloseReason,
  code: CloseCode = CloseCode.FORCE_CLOSE
): Promise<void> => {
  // STEP 1: VERIFY DOCUMENT EXISTS
  const document = instance.documents.get(pageId);

  if (!document) {
    logger.info(`[FORCE_CLOSE] Document ${pageId} already unloaded - no action needed`);
    return; // Document already cleaned up, nothing to do
  }

  const connectionsBefore = document.getConnectionsCount();
  logger.info(`[FORCE_CLOSE] Sending force close message to ${connectionsBefore} local clients...`);

  const forceCloseMessage: ClientForceCloseMessage = {
    type: "force_close",
    reason,
    code,
    message: getForceCloseMessage(reason),
    timestamp: new Date().toISOString(),
  };

  let messageSentCount = 0;
  document.connections.forEach(({ connection }: { connection: Connection }) => {
    try {
      connection.sendStateless(JSON.stringify(forceCloseMessage));
      messageSentCount++;
    } catch (error) {
      logger.error("[FORCE_CLOSE] Failed to send message to client:", error);
    }
  });

  logger.info(`[FORCE_CLOSE] Sent force close message to ${messageSentCount}/${connectionsBefore} clients`);

  // Wait a moment for messages to be delivered
  await new Promise((resolve) => setTimeout(resolve, 50));

  // STEP 3: CLOSE LOCAL CONNECTIONS
  logger.info(`[FORCE_CLOSE] Closing ${connectionsBefore} local connections...`);

  let closedCount = 0;
  document.connections.forEach(({ connection }: { connection: Connection }) => {
    try {
      connection.close({ code, reason });
      closedCount++;
    } catch (error) {
      logger.error("[FORCE_CLOSE] Failed to close local connection:", error);
    }
  });

  logger.info(`[FORCE_CLOSE] Closed ${closedCount}/${connectionsBefore} local connections`);

  // STEP 4: BROADCAST TO OTHER SERVERS
  const redisExt = instance.configuration.extensions.find((ext) => ext instanceof Redis);

  if (redisExt) {
    const commandData: ForceCloseCommandData = {
      command: AdminCommand.FORCE_CLOSE,
      docId: pageId,
      reason,
      code,
      originServer: instance.configuration.name || "unknown",
      timestamp: new Date().toISOString(),
    };

    const receivers = await redisExt.publishAdminCommand(commandData);
    logger.info(`[FORCE_CLOSE] Notified ${receivers} other server(s)`);
  } else {
    logger.warn("[FORCE_CLOSE] Redis extension not found, cannot notify other servers");
  }

  // STEP 5: WAIT FOR OTHER SERVERS
  const waitTime = 800;
  logger.info(`[FORCE_CLOSE] Waiting ${waitTime}ms for other servers to close connections...`);
  await new Promise((resolve) => setTimeout(resolve, waitTime));

  // STEP 6: UNLOAD DOCUMENT after closing all the connections
  logger.info(`[FORCE_CLOSE] Unloading document from memory...`);

  try {
    await instance.unloadDocument(document);
    logger.info(`[FORCE_CLOSE] Document unloaded successfully ✅`);
  } catch (unloadError: unknown) {
    logger.error("[FORCE_CLOSE] UNLOAD FAILED:", unloadError);
    logger.error(`   Error: ${unloadError instanceof Error ? unloadError.message : "unknown"}`);
  }

  // STEP 7: VERIFY UNLOAD
  const documentAfterUnload = instance.documents.get(pageId);

  if (documentAfterUnload) {
    logger.error(
      `❌ [FORCE_CLOSE] Document still in memory!, Document ID: ${pageId}, Connections: ${documentAfterUnload.getConnectionsCount()}`
    );
  } else {
    logger.info(`✅ [FORCE_CLOSE] COMPLETE, Document: ${pageId}, Status: Successfully closed and unloaded`);
  }
};
