/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * HocusPocus singleton manager for the apps/live real-time collaboration layer.
 *
 * This module exports {@link HocusPocusServerManager}, the cached factory that wires the
 * collaborative document server used by Plane's editor (`@plane/editor` over Y.js CRDT).
 * It composes three first-party hooks into a single Hocuspocus instance:
 *   - `getExtensions()` from `@/extensions` — registers Logger, Database, Redis, TitleSync,
 *     and ForceCloseHandler in a specific order so multi-node broadcasts work correctly.
 *   - `onAuthenticate` from `@/lib/auth` — validates the incoming WebSocket session and
 *     enriches the Hocuspocus context (userId, workspaceSlug, projectId, documentType, cookie).
 *   - `onStateless` from `@/lib/stateless` — relays collaboration events (e.g. lock/unlock,
 *     archive) to all clients connected to the document.
 *
 * The Hocuspocus instance is created with `debounce: 10000` so document state is persisted
 * at most once every 10 seconds; this batches rapid Yjs edits before triggering the
 * Database extension's `storeDocument` callback (cross-reference tech spec §5.2.5.4).
 *
 * The instance is constructed lazily and cached — subsequent calls to `initialize()`
 * return the existing instance, making startup idempotent. The Hocuspocus `name` option
 * is derived from `env.HOSTNAME || uuidv4()` so each pod/process has a stable identifier
 * for cluster-wide broadcasts emitted by the Redis extension.
 */

import { Hocuspocus } from "@hocuspocus/server";
import { v4 as uuidv4 } from "uuid";
// env
import { env } from "@/env";
// extensions
import { getExtensions } from "@/extensions";
// lib
import { onAuthenticate } from "@/lib/auth";
import { onStateless } from "@/lib/stateless";

/**
 * Singleton manager that constructs and caches the Hocuspocus collaborative server.
 *
 * Pattern:
 *   - Private constructor prevents direct instantiation.
 *   - Static `instance` field caches the manager; `getInstance()` is the factory.
 *   - The underlying `Hocuspocus` server is held on the instance field `server` and built
 *     lazily inside `initialize()` so it can be retrieved later via `getServer()`.
 *
 * Extension composition order (from `getExtensions()` in `@/extensions/index.ts`):
 *   Logger → Database → Redis → TitleSyncExtension → ForceCloseHandler.
 * Order matters: `ForceCloseHandler` must register AFTER `Redis` so it can subscribe to
 * the Redis pub/sub channel and receive force-close broadcasts emitted from other nodes.
 *
 * Hocuspocus options applied by `initialize()`:
 *   - `name`: `env.HOSTNAME || uuidv4()` — uniquely identifies this server instance
 *     across the cluster (used by the Redis extension for source/target attribution).
 *   - `onAuthenticate`: delegated to `@/lib/auth.onAuthenticate` — validates the WebSocket
 *     auth payload (session cookie handoff from apps/api) and enriches the Hocuspocus
 *     context with `userId`, `workspaceSlug`, `projectId`, `documentType`, and `cookie`.
 *   - `onStateless`: delegated to `@/lib/stateless.onStateless` — relays stateless
 *     broadcast messages used for collaboration event relay (lock, archive, etc.) across
 *     all clients of a given document.
 *   - `extensions`: returned by `getExtensions()` — controls persistence (`Database`),
 *     logging (`Logger`), multi-node awareness (`Redis`), title sync
 *     (`TitleSyncExtension`), and force-close coordination (`ForceCloseHandler`).
 *   - `debounce: 10000` — persists document state at most once every 10 seconds (per
 *     tech spec §5.2.5.4). Rapid Yjs edits are batched before triggering the Database
 *     extension's `storeDocument` callback.
 *
 * Document lifecycle traceability — the chain
 * `connect → edit → persist → disconnect` is wired here as follows:
 *   - `connect`:    `onAuthenticate` (from `@/lib/auth`) validates the WS handshake.
 *   - `edit`:       Yjs CRDT updates are processed by Hocuspocus core and relayed
 *                   cluster-wide by the `Redis` extension; conflict resolution is the
 *                   automatic CRDT merge (no explicit resolver callback).
 *   - `persist`:    `extensions/database.ts.storeDocument` fires at most every 10s
 *                   (controlled by `debounce: 10000`) and PATCHes page state to apps/api.
 *   - `disconnect`: `extensions/force-close-handler.ts` coordinates cluster-wide force
 *                   close via Redis pub/sub when admin or page-lifecycle events require it.
 *
 * Per-document lifecycle hooks live inside the extensions, not this manager. See
 * `apps/live/src/extensions/database.ts` for the `fetchDocument`/`storeDocument`
 * implementation that backs the Hocuspocus persistence contract.
 */
export class HocusPocusServerManager {
  private static instance: HocusPocusServerManager | null = null;
  private server: Hocuspocus | null = null;
  // server options
  private serverName = env.HOSTNAME || uuidv4();

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  /**
   * Get the singleton instance of HocusPocusServerManager.
   *
   * Lazily constructs the singleton on the first call and returns the cached instance
   * on subsequent calls. No explicit locking is required: Node.js executes JavaScript
   * on a single-threaded event loop, so the "construct then assign" sequence cannot
   * be interleaved across callers.
   *
   * @returns The cached `HocusPocusServerManager` (creating it if it does not exist).
   */
  public static getInstance(): HocusPocusServerManager {
    if (!HocusPocusServerManager.instance) {
      HocusPocusServerManager.instance = new HocusPocusServerManager();
    }
    return HocusPocusServerManager.instance;
  }

  /**
   * Initialize and configure the HocusPocus server.
   *
   * Idempotent: returns the already-built `Hocuspocus` instance if `initialize()` has
   * been called before; otherwise constructs a new one using the configuration sourced
   * from this manager and its collaborators:
   *   - server `name`: `env.HOSTNAME || uuidv4()` (captured at construction time).
   *   - `extensions`: returned by `getExtensions()` from `@/extensions`.
   *   - `onAuthenticate`: from `@/lib/auth` — validates the WebSocket handshake.
   *   - `onStateless`: from `@/lib/stateless` — relays stateless broadcasts.
   *   - `debounce: 10000` — 10-second persistence batching window.
   *
   * Called once at boot by `apps/live/src/server.ts` during `Server.initialize()` and
   * the resulting Hocuspocus instance is passed to `CollaborationController` for the
   * WebSocket upgrade path.
   *
   * @returns The configured `Hocuspocus` server instance (newly constructed or cached).
   */
  public async initialize(): Promise<Hocuspocus> {
    if (this.server) {
      return this.server;
    }

    this.server = new Hocuspocus({
      name: this.serverName,
      onAuthenticate,
      onStateless,
      extensions: getExtensions(),
      debounce: 10000,
    });

    return this.server;
  }

  /**
   * Get the configured server instance.
   *
   * Returns `null` when `initialize()` has not yet been called — callers that need
   * to access the running Hocuspocus server (e.g. tests, or runtime broadcast
   * utilities such as `apps/live/src/utils/broadcast-message.ts`) can use this
   * accessor instead of re-entering the `initialize()` path.
   *
   * @returns The cached `Hocuspocus` server, or `null` if it has not been initialized.
   */
  public getServer(): Hocuspocus | null {
    return this.server;
  }

  /**
   * Reset the singleton instance (useful for testing).
   *
   * Clears the static `instance` field so that the next call to `getInstance()`
   * constructs a fresh manager. This does NOT close the underlying Hocuspocus
   * server's connections — callers that need a clean teardown in non-test contexts
   * must invoke the server's `closeConnections()` (or equivalent shutdown path)
   * before calling this method.
   */
  public static resetInstance(): void {
    HocusPocusServerManager.instance = null;
  }
}
