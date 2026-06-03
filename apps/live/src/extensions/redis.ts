/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Application-specific Hocuspocus Redis extension. Combines the cross-server document sync
 * behavior inherited from `@hocuspocus/extension-redis` with a Plane-specific admin-command
 * bus on a dedicated `hocuspocus:admin` Redis pub/sub channel.
 *
 * Two roles:
 * 1. Hocuspocus base behavior (inherited) -- propagates Yjs binary updates between servers
 *    on per-document Redis channels keyed by `pubKey(documentName)`. When clients on
 *    different servers edit the same document, the base extension carries awareness/state
 *    updates across servers so all peers converge via Yjs CRDT merge.
 * 2. Plane-specific admin bus -- subscribes to a dedicated `hocuspocus:admin` Redis channel
 *    for cross-server control-plane commands (see `AdminCommand` in
 *    `@/types/admin-commands`). The enum defines `FORCE_CLOSE`, `HEALTH_CHECK`, and
 *    `RESTART_DOCUMENT`; currently only `FORCE_CLOSE` has a registered handler (wired by
 *    the `ForceCloseHandler` extension).
 *
 * Registration order: per `apps/live/src/extensions/index.ts.getExtensions`, this extension
 * is instantiated as the third entry (after `Logger`, `Database`) and BEFORE
 * `TitleSyncExtension` and `ForceCloseHandler`. `ForceCloseHandler` MUST follow this
 * extension because its `onConfigure` hook locates the singleton `Redis` instance via
 * `instanceof Redis` and registers a `FORCE_CLOSE` handler via `onAdminCommand`.
 *
 * Redis client source: the underlying ioredis client is resolved from
 * `redisManager.getClient()` (the singleton defined in `@/redis`). The base
 * `@hocuspocus/extension-redis` calls `.duplicate()` internally to open separate connections
 * for subscribe (`this.sub`) and publish (`this.pub`).
 *
 * Architectural notes:
 * - Redis pub/sub is for awareness AND admin commands only. Task queueing uses RabbitMQ via
 *   apps/api; the `hocuspocus:admin` channel is a control-plane channel, NOT a work queue.
 * - `broadcastToDocument` uses Hocuspocus's wire encoding to publish stateless messages
 *   with an empty server-identifier prefix so every server (including the publisher)
 *   processes the message rather than skipping it as a loopback.
 *
 * @see HocusPocus 2.15.2 + ioredis 5.7.0 -- tech spec section 3.2.6.
 */

import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";
import { OutgoingMessage } from "@hocuspocus/server";
import type { onConfigurePayload } from "@hocuspocus/server";
import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
import { redisManager } from "@/redis";
import { AdminCommand } from "@/types/admin-commands";
import type { AdminCommandData, AdminCommandHandler } from "@/types/admin-commands";

/**
 * Resolve the singleton ioredis client from `redisManager` for use by the Hocuspocus Redis
 * extension's base constructor.
 *
 * Throws `AppError("Redis client not initialized")` if the manager has no active client --
 * Hocuspocus cannot operate without Redis when this extension is registered, so the failure
 * must propagate out of the constructor and abort server startup rather than silently
 * disabling cross-server sync.
 *
 * Called by the `Redis` class constructor on instantiation.
 *
 * @returns The active ioredis client managed by `redisManager`.
 * @throws {AppError} If `redisManager.getClient()` returns `null` (Redis not initialized).
 */
const getRedisClient = () => {
  const redisClient = redisManager.getClient();
  if (!redisClient) {
    throw new AppError("Redis client not initialized");
  }
  return redisClient;
};

/**
 * Hocuspocus extension that combines the base `@hocuspocus/extension-redis` cross-server
 * document sync with a Plane-specific admin-command bus.
 *
 * Internal state:
 * - `adminHandlers: Map<AdminCommand, AdminCommandHandler>` -- registered handlers, keyed
 *   by `AdminCommand` enum value. Populated by `onAdminCommand`.
 * - `ADMIN_CHANNEL = "hocuspocus:admin"` -- readonly Redis channel name for the
 *   cross-server control plane.
 *
 * Hocuspocus hooks contributed:
 * - `onConfigure(payload)` -- invoked once during server bootstrap. Opens a DEDICATED
 *   subscriber connection (`adminSub`, a `.duplicate()` of the managed client), subscribes
 *   it to the admin channel, and attaches `handleAdminMessage` to its `"message"` event --
 *   deliberately kept off the base `this.sub` (see "Why a dedicated admin connection" below).
 * - `onDestroy()` -- invoked once during server teardown. Unsubscribes and removes the
 *   listener from `adminSub` (avoiding dangling-reference memory leaks), closes that
 *   connection, then calls `super.onDestroy()` to tear down the base extension's pub/sub.
 *
 * Public API:
 * - `onAdminCommand<T>(command, handler)` -- register a handler for a specific
 *   `AdminCommand` enum value. Called by `ForceCloseHandler.onConfigure` to register the
 *   inbound `FORCE_CLOSE` handler.
 * - `publishAdminCommand<T>(data)` -- publish a typed admin command to the global
 *   `hocuspocus:admin` channel; returns the number of subscribers that received the
 *   message.
 * - `broadcastToDocument(documentName, payload)` -- publish a stateless message to a
 *   specific document across all servers using Hocuspocus's wire encoding.
 *
 * Why subclass instead of compose: the base `@hocuspocus/extension-redis` exposes its
 * `this.sub` and `this.pub` ioredis clients as accessible fields. Subclassing lets the admin
 * bus reuse the base `this.pub` for publishing while controlling its own inbound path.
 *
 * Why a dedicated admin connection (`adminSub`): the base extension attaches a
 * `messageBuffer` listener to `this.sub` that Yjs-decodes EVERY message delivered on that
 * connection, ignoring the channel name. ioredis delivers messages for ALL channels a
 * connection is subscribed to, so subscribing the admin channel on `this.sub` fed admin JSON
 * into the base Yjs decoder, which threw lib0 errors ("Unexpected end of array" /
 * "Invalid typed array length") as unhandled rejections (QA #2 / #5). The admin channel
 * therefore lives on its own `.duplicate()` connection, fully isolated from document sync.
 *
 * Idempotency:
 * - `onConfigure` is safe to call multiple times because ioredis's `subscribe` is itself
 *   idempotent (additional calls return immediately without re-subscribing).
 * - `onDestroy` is safe because both `unsubscribe` and `removeListener` are idempotent.
 *
 * Document lifecycle role -- cross-server transport layer for `connect -> edit -> persist
 * -> disconnect`:
 * - `edit`: Yjs CRDT updates from clients are propagated across servers via the inherited
 *   base extension's per-document channels (not overridden here).
 * - `disconnect` (force-close path): when a force-close is initiated locally,
 *   `forceCloseDocumentAcrossServers` calls `publishAdminCommand` to notify peer servers
 *   via the `hocuspocus:admin` channel; peer servers receive via `handleAdminMessage` and
 *   dispatch to the registered `ForceCloseHandler` callback.
 *
 * `connect` and `persist` are handled in `lib/auth.ts` and `extensions/database.ts`
 * respectively (not in this file).
 */
export class Redis extends HocuspocusRedis {
  private adminHandlers = new Map<AdminCommand, AdminCommandHandler>();
  private readonly ADMIN_CHANNEL = "hocuspocus:admin";
  // Dedicated subscriber connection for `ADMIN_CHANNEL`. Isolated from the base extension's
  // `this.sub` so its `messageBuffer` Yjs decoder never receives admin JSON -- routing admin
  // messages through `this.sub` made that decoder throw lib0 errors (QA #2 / #5).
  private adminSub: ReturnType<typeof getRedisClient> | null = null;

  constructor() {
    super({ redis: getRedisClient() });
  }

  /**
   * Hocuspocus configuration hook -- invoked once during server bootstrap, before any
   * client connections are accepted.
   *
   * Side effects:
   * 1. Calls `super.onConfigure(payload)` so the base extension configures its own pub/sub
   *    setup (the per-document Yjs sync channels).
   * 2. Opens a dedicated subscriber connection `this.adminSub = getRedisClient().duplicate()`
   *    and subscribes it to `this.ADMIN_CHANNEL` (wrapped in a Promise so the subscribe
   *    callback's error path rejects).
   * 3. Attaches the bound `handleAdminMessage` listener to the `"message"` event on
   *    `adminSub` -- NOT `this.sub` -- so admin JSON never reaches the base extension's
   *    `messageBuffer` Yjs decoder (the cause of QA #2 / #5).
   *
   * Error handling: subscribe failures reject the Promise and propagate to Hocuspocus,
   * which fails server startup. Listener attachment failures are not caught here and would
   * surface as uncaught exceptions during `start.ts` bootstrap.
   *
   * @param payload - Hocuspocus configuration payload forwarded to `super.onConfigure`.
   */
  async onConfigure(payload: onConfigurePayload) {
    await super.onConfigure(payload);

    // Open a DEDICATED subscriber connection for the admin channel. The base extension
    // attaches a `messageBuffer` listener to `this.sub` that Yjs-decodes EVERY message on
    // that connection regardless of channel; sharing `this.sub` for admin JSON made the base
    // decoder throw lib0 errors as unhandled rejections (QA #2 / #5). A separate connection
    // keeps the admin control-plane fully isolated from the document-sync pipeline.
    const adminSub = getRedisClient().duplicate();
    this.adminSub = adminSub;

    // Subscribe to admin channel
    await new Promise<void>((resolve, reject) => {
      adminSub.subscribe(this.ADMIN_CHANNEL, (error: Error | null | undefined) => {
        if (error) {
          logger.error(`[Redis] Failed to subscribe to admin channel:`, error);
          reject(error);
        } else {
          logger.info(`[Redis] Subscribed to admin channel: ${this.ADMIN_CHANNEL}`);
          resolve();
        }
      });
    });

    // Listen for admin messages on the dedicated connection
    adminSub.on("message", this.handleAdminMessage);
    logger.info(`[Redis] Attached admin message listener`);
  }

  /**
   * ioredis `"message"` event handler for the admin channel. Bound as an arrow function so
   * `this` is preserved when attached and removed as a listener.
   *
   * Trigger: fires when a message is published on the dedicated `adminSub` connection (only
   * `this.ADMIN_CHANNEL` is subscribed there); the leading channel guard is retained as
   * belt-and-suspenders in case the connection ever carries additional subscriptions.
   *
   * State read: parses `message` as JSON into `AdminCommandData`; validates `data.command`
   * against the `AdminCommand` enum. Looks up the registered handler via
   * `this.adminHandlers.get(data.command)`.
   *
   * Dispatch: invokes the registered handler with the parsed `data`. If no handler is
   * registered for the command, logs a warning and returns (silent skip).
   *
   * Error handling: JSON parse failures, invalid command values, and handler exceptions are
   * all caught and logged via `@plane/logger.error` without rethrowing -- a malformed admin
   * message must NOT crash the server.
   *
   * @param channel - The Redis channel the message was published to.
   * @param message - The raw JSON-encoded message payload.
   */
  private handleAdminMessage = async (channel: string, message: string) => {
    if (channel !== this.ADMIN_CHANNEL) return;

    try {
      const data = JSON.parse(message) as AdminCommandData;

      // Validate command
      if (!data.command || !Object.values(AdminCommand).includes(data.command as AdminCommand)) {
        logger.warn(`[Redis] Invalid admin command received: ${data.command}`);
        return;
      }

      const handler = this.adminHandlers.get(data.command);

      if (handler) {
        await handler(data);
      } else {
        logger.warn(`[Redis] No handler registered for admin command: ${data.command}`);
      }
    } catch (error) {
      logger.error("[Redis] Error handling admin message:", error);
    }
  };

  /**
   * Register handler for an admin command
   *
   * Stores `handler` in `this.adminHandlers` keyed by `command`; `handleAdminMessage` looks
   * it up on every inbound admin message that matches the command. The type parameter `T`
   * (extends `AdminCommandData`) lets callers narrow the inbound data type -- e.g.
   * `ForceCloseHandler` registers with `<ForceCloseCommandData>`.
   *
   * Registering twice for the same command **replaces** the previous handler (Map
   * semantics) -- intentional, allows hot-swap during tests.
   *
   * Primary caller: `apps/live/src/extensions/force-close-handler.ts`'s
   * `ForceCloseHandler.onConfigure` (registers the `FORCE_CLOSE` handler).
   *
   * @param command - The `AdminCommand` enum value to associate this handler with.
   * @param handler - Async or sync callback invoked with the parsed command data.
   */
  public onAdminCommand<T extends AdminCommandData = AdminCommandData>(
    command: AdminCommand,
    handler: AdminCommandHandler<T>
  ) {
    this.adminHandlers.set(command, handler as AdminCommandHandler);
    logger.info(`[Redis] Registered admin command: ${command}`);
  }

  /**
   * Publish admin command to global channel
   *
   * Publishes a typed admin command to the global `hocuspocus:admin` Redis channel. All
   * servers (including this one) that subscribed via `onConfigure` receive the message and
   * route it through `handleAdminMessage`. The type parameter `T` lets callers narrow the
   * published data type -- e.g. `forceCloseDocumentAcrossServers` uses
   * `<ForceCloseCommandData>`.
   *
   * Validation: enforces `data.command` is a valid `AdminCommand` enum value; throws
   * `AppError("Invalid admin command: ${data.command}")` otherwise.
   *
   * Wire format: `JSON.stringify(data)` published via
   * `this.pub.publish(this.ADMIN_CHANNEL, message)`.
   *
   * Primary caller: `apps/live/src/extensions/force-close-handler.ts`'s
   * `forceCloseDocumentAcrossServers` (publishes `FORCE_CLOSE`).
   *
   * Each call publishes a separate message -- invoking this twice with the same payload
   * causes subscribers to receive two messages. The receiving handler in `ForceCloseHandler`
   * is itself idempotent (no-op when the target document is already unloaded), so
   * duplicates are safe at the application layer.
   *
   * @param data - The command payload. Must include a valid `AdminCommand` in
   *   `data.command`.
   * @returns Number of Redis subscribers that received the message (from ioredis
   *   `publish`'s return value).
   * @throws {AppError} If `data.command` is missing or not a valid `AdminCommand`.
   */
  public async publishAdminCommand<T extends AdminCommandData>(data: T): Promise<number> {
    // Validate command data
    if (!data.command || !Object.values(AdminCommand).includes(data.command)) {
      throw new AppError(`Invalid admin command: ${data.command}`);
    }

    const message = JSON.stringify(data);
    const receivers = await this.pub.publish(this.ADMIN_CHANNEL, message);

    logger.info(`[Redis] Published "${data.command}" command, received by ${receivers} server(s)`);
    return receivers;
  }

  /**
   * Hocuspocus teardown hook -- invoked once during server shutdown, called from
   * `Server.destroy()` via the Hocuspocus `closeConnections()` cascade.
   *
   * Cleanup sequence (only when `adminSub` was opened):
   * 1. Unsubscribes from `this.ADMIN_CHANNEL` on the dedicated `adminSub`. Unsubscribe
   *    errors are logged but do not block teardown (the Promise always resolves).
   * 2. Removes the `handleAdminMessage` listener from `adminSub` to prevent memory leaks
   *    via dangling listener references.
   * 3. Closes `adminSub` via `quit()` (guarded so a failed quit cannot break teardown) and
   *    clears the field.
   * 4. Calls `super.onDestroy()` so the base extension tears down its own pub/sub state
   *    (the per-document Yjs sync channels).
   *
   * The underlying ioredis connection itself is closed later by `redisManager.disconnect()`
   * from `apps/live/src/server.ts.destroy()`, AFTER all Hocuspocus extensions have torn
   * down. The separation is intentional because multiple extensions may share the same
   * Redis manager.
   */
  async onDestroy() {
    // Tear down the dedicated admin subscriber connection opened in onConfigure.
    const adminSub = this.adminSub;
    if (adminSub) {
      // Unsubscribe from admin channel
      await new Promise<void>((resolve) => {
        adminSub.unsubscribe(this.ADMIN_CHANNEL, (error: Error | null | undefined) => {
          if (error) {
            logger.error(`[Redis] Error unsubscribing from admin channel:`, error);
          }
          resolve();
        });
      });

      // Remove the message listener to prevent memory leaks
      adminSub.removeListener("message", this.handleAdminMessage);
      logger.info(`[Redis] Removed admin message listener`);

      // Close the dedicated connection; guarded so a failed quit never breaks teardown.
      try {
        await adminSub.quit();
      } catch (error) {
        logger.error(`[Redis] Error closing admin subscriber connection:`, error);
      }
      this.adminSub = null;
    }

    await super.onDestroy();
  }

  /**
   * Broadcast a message to a document across all servers via Redis.
   * Uses empty identifier so ALL servers process the message.
   *
   * Publishes a stateless broadcast message to a specific document name; every server in
   * the cluster (including this one) will dispatch the message to its local clients on
   * that document.
   *
   * Wire format: builds an
   * `OutgoingMessage(documentName).writeBroadcastStateless(stringPayload)` (Hocuspocus
   * wire protocol). The Hocuspocus Redis pub/sub uses a server-identifier prefix to filter
   * loopback messages; this method prepends `Buffer.concat([Buffer.from([0])])` -- an
   * empty server identifier -- so every server (including the publisher) processes the
   * message rather than skipping it.
   *
   * Channel: derived from `this["pubKey"](documentName)` -- the base class's per-document
   * channel naming convention. Bracket-notation access is required because `pubKey` is a
   * protected method TypeScript does not expose through the subclass.
   *
   * Primary caller: `apps/live/src/utils/broadcast-message.ts`'s `broadcastMessageToPage`
   * (relays awareness events like `property_updated` to subscribers of a parent page).
   *
   * Each invocation publishes one message -- application-level idempotency is the
   * receiver's responsibility.
   *
   * @param documentName - The Hocuspocus document name (the page id) to address.
   * @param payload - Arbitrary value; non-string payloads are JSON-stringified.
   * @returns Number of Redis subscribers that received the message (from
   *   `this.pub.publishBuffer`'s return value).
   */
  public async broadcastToDocument(documentName: string, payload: unknown): Promise<number> {
    const stringPayload = typeof payload === "string" ? payload : JSON.stringify(payload);

    const message = new OutgoingMessage(documentName).writeBroadcastStateless(stringPayload);

    const emptyPrefix = Buffer.concat([Buffer.from([0])]);
    const channel = this["pubKey"](documentName);
    const encodedMessage = Buffer.concat([emptyPrefix, Buffer.from(message.toUint8Array())]);

    const result = await this.pub.publishBuffer(channel, encodedMessage);

    logger.info(`REDIS_EXTENSION: Published to ${documentName}, ${result} subscribers`);

    return result;
  }
}
