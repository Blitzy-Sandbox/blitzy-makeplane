/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Adapter extension that bridges `@hocuspocus/extension-logger` to the
 * centralized `@plane/logger` package used across the apps/live service.
 *
 * Routing log output through `@plane/logger` ensures every Hocuspocus
 * extension log line participates in Plane's standard formatters, level
 * filters, and downstream sinks instead of landing in the upstream
 * extension's default `console.log` transport.
 *
 * Registered first in `./index.ts` `getExtensions()` so that every
 * subsequently registered extension (`Database`, `Redis`,
 * `TitleSyncExtension`, `ForceCloseHandler`) has its lifecycle events
 * observed and forwarded. The module contains no custom state or branching
 * behavior — it is a pure pass-through adapter.
 */

import { Logger as HocuspocusLogger } from "@hocuspocus/extension-logger";
import { logger } from "@plane/logger";

/**
 * Hocuspocus logger extension that forwards every emitted message to
 * `@plane/logger.info` rather than `console.log`, which the upstream
 * `@hocuspocus/extension-logger` package uses by default.
 *
 * Configuration applied in `super({...})`:
 *  - `onChange: false` — suppresses the per-edit `onChange` log line that
 *    the base extension would otherwise emit for every Yjs document
 *    change. Plane document edits arrive at high frequency, so leaving
 *    this enabled would flood the log and obscure more meaningful
 *    connection, load, and persistence events.
 *  - `log: (message) => logger.info(message)` — forwards each formatted
 *    message through `@plane/logger`, keeping log shape, level filtering,
 *    and downstream sinks uniform with the rest of apps/live.
 *
 * Lifecycle hooks observed (from the base extension): `onConnect`,
 * `onDisconnect`, `onChange` (suppressed via the option above),
 * `onLoadDocument`, `onStoreDocument`, `onAuthenticate`, `onDestroy`, and
 * the other hooks documented by `@hocuspocus/extension-logger`. This
 * subclass does not override or add any hooks — it only customizes the
 * message sink and the change-event toggle, so it carries no additional
 * state, branching, or side effects beyond logging.
 *
 * Registered as the first entry in `apps/live/src/extensions/index.ts`
 * `getExtensions()` so that lifecycle events emitted by extensions
 * registered later (`Database`, `Redis`, `TitleSyncExtension`,
 * `ForceCloseHandler`) are observed and forwarded.
 */
export class Logger extends HocuspocusLogger {
  constructor() {
    super({
      onChange: false,
      log: (message) => {
        logger.info(message);
      },
    });
  }
}
