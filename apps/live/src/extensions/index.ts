/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition entrypoint for the Hocuspocus extension stack used by the apps/live
 * real-time collaboration server.
 *
 * Wiring: {@link getExtensions} is invoked exactly once from
 * `apps/live/src/hocuspocus.ts.HocusPocusServerManager.initialize()`, and the returned
 * array is passed as the `extensions:` option to `new Hocuspocus(...)`. Because
 * `initialize()` is idempotent (it returns the cached `Hocuspocus` server on re-entry),
 * the extensions declared here are constructed and registered exactly once per server
 * boot.
 *
 * The five extensions wired here own distinct phases of the document lifecycle
 * (`connect -> edit -> persist -> disconnect`); see {@link getExtensions} for the
 * per-extension lifecycle role breakdown.
 *
 * Stack: HocusPocus 2.15.2 + Y.js 13.6.20 (tech spec sec. 3.2.6).
 */

import { Database } from "./database";
import { ForceCloseHandler } from "./force-close-handler";
import { Logger } from "./logger";
import { Redis } from "./redis";
import { TitleSyncExtension } from "./title-sync";

/**
 * Construct the ordered list of Hocuspocus extensions registered with the apps/live
 * server. A fresh array of newly-instantiated extensions is returned on every call so
 * the result never carries state between invocations -- this preserves test isolation
 * when `HocusPocusServerManager.resetInstance()` is used in tests.
 *
 * Registration order is FUNCTIONALLY CRITICAL -- do not reorder:
 *   1. `Logger` -- registered first so subsequent extensions' lifecycle events
 *      (connect, load, store, disconnect, ...) are observed and forwarded to
 *      `@plane/logger`. Owns logging across the entire lifecycle.
 *   2. `Database` -- Yjs persistence: `fetchDocument` loads initial state from apps/api
 *      on `connect`, and `storeDocument` PATCHes the debounced state back during
 *      `persist`. The 10-second persistence debounce is configured in `hocuspocus.ts`
 *      via `debounce: 10000`, NOT here.
 *   3. `Redis` -- pub/sub transport for multi-node awareness fan-out during `edit` and
 *      the `hocuspocus:admin` control-plane channel used by `ForceCloseHandler`. Redis
 *      here is for awareness AND admin commands only -- task queueing across the wider
 *      Plane platform uses RabbitMQ via apps/api Celery, NOT this channel.
 *   4. `TitleSyncExtension` -- observes the Yjs `title` XmlFragment during `edit` and
 *      debounces direct PATCH calls to apps/api so collaborative title edits propagate
 *      to page metadata; force-flushes pending updates during `disconnect` via
 *      `beforeUnloadDocument`.
 *   5. `ForceCloseHandler` -- MUST follow `Redis`: its `onConfigure` hook locates the
 *      registered Redis extension via
 *      `instance.configuration.extensions.find((ext) => ext instanceof Redis)` and
 *      subscribes a handler to the `hocuspocus:admin` channel for cluster-wide
 *      involuntary `disconnect` (force-close) broadcasts. If `Redis` is missing or
 *      registered after this handler, the lookup returns `undefined`, a warning is
 *      logged, and force-close broadcasts are silently dropped. The inline comment at
 *      the call site documents the same constraint.
 *
 * Conflict resolution for collaborative `edit` operations is Yjs CRDT auto-merge
 * (structural last-writer-wins via Y.Doc state encoding); there is no explicit
 * resolver callback. See `database.ts` for details.
 *
 * @returns A fresh array of Hocuspocus extension instances in the registration order
 *          described above, suitable for passing as the `extensions:` option to
 *          `new Hocuspocus(...)`.
 */
export const getExtensions = () => [
  new Logger(),
  new Database(),
  new Redis(),
  new TitleSyncExtension(),
  new ForceCloseHandler(), // Must be after Redis to receive broadcasts
];
