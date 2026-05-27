/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Hocuspocus } from "@hocuspocus/server";
import type { Request } from "express";
import type WebSocket from "ws";
// plane imports
import { Controller, WebSocket as WSDecorator } from "@plane/decorators";
import { logger } from "@plane/logger";

/**
 * WebSocket gateway controller for Plane's real-time collaborative editing.
 *
 * Mount path:
 *   - Internal: `/collaboration` (via `@Controller("/collaboration")`)
 *   - External: `/live/collaboration` (composed with `env.LIVE_BASE_PATH`)
 *
 * Decorators consumed from `@plane/decorators`:
 *   - `@Controller("/collaboration")` — mounts the class on the live-server router
 *   - `@WebSocket("/")` (imported as `WSDecorator` to avoid clashing with the
 *     `WebSocket` runtime type from `ws`) — binds the handler to the
 *     `expressWs` upgrade endpoint at the controller root
 *
 * Hocuspocus injection: the `Hocuspocus` server instance is supplied through
 * the `registerController` argument array `[hocuspocusServer]` constructed in
 * `apps/live/src/server.ts:setupRoutes`. The controller does not own the
 * Hocuspocus lifecycle; it merely forwards upgraded sockets to it.
 *
 * Auth requirement: NOT enforced at the controller level. Authentication is
 * delegated to Hocuspocus's `onAuthenticate` hook (see `apps/live/src/lib/auth.ts`),
 * which validates the client-supplied token before accepting the connection.
 *
 * Document lifecycle: this controller is the **`connect` entrypoint** of the
 * `connect → edit → persist → disconnect` lifecycle. Once the socket is
 * accepted here, all subsequent state transitions (auth, load, change, store,
 * disconnect) are driven by Hocuspocus extensions registered in
 * `apps/live/src/extensions/` (database, force-close-handler, logger, redis,
 * title-sync). See `apps/live/src/hocuspocus.ts` for extension composition.
 */
@Controller("/collaboration")
export class CollaborationController {
  [key: string]: unknown;
  private readonly hocusPocusServer: Hocuspocus;

  constructor(hocusPocusServer: Hocuspocus) {
    this.hocusPocusServer = hocusPocusServer;
  }

  /**
   * Forwards an incoming WebSocket upgrade to the shared Hocuspocus server.
   *
   * Trigger: an HTTP `Upgrade: websocket` request hitting
   * `/live/collaboration/` is promoted by `express-ws` and routed here.
   *
   * Behavior: hands the accepted socket + originating Express request to
   * `hocusPocusServer.handleConnection(ws, req)`, which then runs the
   * registered Hocuspocus hooks in order (`onConnect`, `onAuthenticate`,
   * `onLoadDocument`, etc.). Any pre-handoff or synchronous failure is
   * caught and the socket is closed with code 1011 (internal error).
   *
   * Error handling: attaches a `ws.on("error", ...)` listener that logs via
   * `@plane/logger` with the `COLLABORATION_CONTROLLER:` prefix and closes
   * the socket with code 1011 and reason `"Internal server error"`. Code
   * 1011 is used (rather than 1006) so the client receives an explicit
   * server-initiated close and can apply its retry/backoff policy.
   *
   * Persistence side effects: none directly. All state writes happen later
   * inside the Hocuspocus pipeline (notably the `database` extension's
   * debounced `onStoreDocument` PATCH back to `apps/api`).
   */
  @WSDecorator("/")
  handleConnection(ws: WebSocket, req: Request) {
    try {
      // Initialize the connection with Hocuspocus
      this.hocusPocusServer.handleConnection(ws, req);

      // Set up error handling for the connection
      ws.on("error", (error: Error) => {
        logger.error("COLLABORATION_CONTROLLER: WebSocket connection error:", error);
        ws.close(1011, "Internal server error");
      });
    } catch (error) {
      logger.error("COLLABORATION_CONTROLLER: WebSocket connection error:", error);
      ws.close(1011, "Internal server error");
    }
  }
}
