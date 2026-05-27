/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * HTTP and WebSocket orchestration entry point for the Live Node service.
 *
 * Exports the {@link Server} class, which owns the Express middleware chain,
 * controller route registration, Hocuspocus orchestration, Redis manager
 * initialization, and the graceful shutdown sequence consumed by `start.ts`.
 *
 * Lifecycle composition: `constructor` (synchronous Express setup) →
 * `initialize()` (async data-plane dependencies) → `listen()` (bind port) →
 * `destroy()` (teardown).
 */

import type { Server as HttpServer } from "http";
import type { Hocuspocus } from "@hocuspocus/server";
import compression from "compression";
import cors from "cors";
import type { Express, Request, Response, Router } from "express";
import express from "express";
import expressWs from "express-ws";
import helmet from "helmet";
// plane imports
import { registerController } from "@plane/decorators";
import { logger, loggerMiddleware } from "@plane/logger";
// controllers
import { CONTROLLERS } from "@/controllers";
// env
import { env } from "@/env";
// hocuspocus server
import { HocusPocusServerManager } from "@/hocuspocus";
// redis
import { redisManager } from "@/redis";

/**
 * Central HTTP + WebSocket orchestrator for Plane's real-time collaboration
 * layer (AAP Directive 4 / tech spec §3.2.6 — HocusPocus + Y.js + Express).
 *
 * Constructor responsibilities: instantiates Express, applies
 * `expressWs(this.app)` to enable WebSocket upgrade handling, calls
 * `setupMiddleware()` to wire the chain, creates the router, sets
 * `app.set("port", env.PORT || 3000)`, and mounts the router under
 * `env.LIVE_BASE_PATH` (default `/live`) — so `/health` becomes `/live/health`
 * externally.
 *
 * Middleware chain order (see `setupMiddleware`):
 *   `helmet` (security) → `compression` (gzip with `env.COMPRESSION_LEVEL` /
 *   `env.COMPRESSION_THRESHOLD`) → `loggerMiddleware` from `@plane/logger` →
 *   `express.json()` → `express.urlencoded({ extended: true })` →
 *   `setupCors()` (allowed origins parsed from `env.CORS_ALLOWED_ORIGINS`).
 *
 * Lifecycle methods: `initialize`, `listen`, `destroy`.
 *
 * Internal helpers: `setupMiddleware`, `setupCors`, `setupNotFoundHandler`,
 * `setupRoutes`.
 *
 * Document lifecycle traceability (`connect → edit → persist → disconnect`):
 * incoming WebSocket upgrades are routed via `CollaborationController`
 * (registered in `setupRoutes`); the Hocuspocus server constructed in
 * `initialize()` accepts the connection; subsequent `edit` / `persist` /
 * `disconnect` events are handled by extensions in `apps/live/src/extensions/`.
 */
export class Server {
  private app: Express;
  private router: Router;
  private hocuspocusServer: Hocuspocus | undefined;
  private httpServer: HttpServer | undefined;

  /**
   * Synchronous Express setup: instantiates the app, enables WebSocket support
   * via `expressWs(this.app)`, wires the middleware chain, creates the router,
   * sets the port from `env.PORT || 3000`, and mounts the router at
   * `env.LIVE_BASE_PATH`.
   *
   * Async data-plane dependencies (Redis, Hocuspocus) are deferred to
   * {@link Server.initialize} so construction never throws on connection
   * failure.
   */
  constructor() {
    this.app = express();
    expressWs(this.app);
    this.setupMiddleware();
    this.router = express.Router();
    this.app.set("port", env.PORT || 3000);
    this.app.use(env.LIVE_BASE_PATH, this.router);
  }

  /**
   * Asynchronously brings up data-plane dependencies and wires controller
   * routes before the server begins accepting traffic.
   *
   * Sequence: `redisManager.initialize()` (establishes the ioredis client with
   * PING verification) → `HocusPocusServerManager.getInstance().initialize()`
   * (constructs the Hocuspocus server with extensions) →
   * `setupRoutes(hocuspocusServer)` (registers controllers via
   * `registerController` from `@plane/decorators`) → `setupNotFoundHandler()`
   * (JSON 404 fallback).
   *
   * Architectural note: Redis here is for caching / session / pub-sub
   * awareness only — task queueing uses RabbitMQ via apps/api (AAP §0.2.2).
   *
   * Errors are logged via `logger.error` and rethrown so `start.ts` can
   * `process.exit(1)`.
   */
  public async initialize(): Promise<void> {
    try {
      await redisManager.initialize();
      logger.info("SERVER: Redis setup completed");
      const manager = HocusPocusServerManager.getInstance();
      this.hocuspocusServer = await manager.initialize();
      logger.info("SERVER: HocusPocus setup completed");
      this.setupRoutes(this.hocuspocusServer);
      this.setupNotFoundHandler();
    } catch (error) {
      logger.error("SERVER: Failed to initialize live server dependencies:", error);
      throw error;
    }
  }

  /**
   * Wires the Express middleware chain in order-significant sequence: helmet
   * first so security headers precede every response, then compression, then
   * logging (so every response is logged), then JSON / urlencoded body
   * parsing, and finally CORS via {@link Server.setupCors} (allowed origins
   * parsed from `env.CORS_ALLOWED_ORIGINS`).
   */
  private setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    // Middleware for response compression
    this.app.use(compression({ level: env.COMPRESSION_LEVEL, threshold: env.COMPRESSION_THRESHOLD }));
    // Logging middleware
    this.app.use(loggerMiddleware);
    // Body parsing middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    // cors middleware
    this.setupCors();
  }

  /**
   * Parses the comma-separated `env.CORS_ALLOWED_ORIGINS` and registers the
   * `cors` middleware with `credentials: true` to support cookie-based session
   * handoff from apps/api.
   *
   * Allowed HTTP methods: GET, POST, PUT, DELETE, OPTIONS. Allowed headers:
   * Content-Type, Authorization, x-api-key.
   */
  private setupCors() {
    const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    this.app.use(
      cors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : false,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
      })
    );
  }

  /**
   * Registers a JSON 404 fallback at the END of the middleware chain — invoked
   * for any unmatched route, returning `{ message: "Not Found" }` with HTTP
   * status 404.
   */
  private setupNotFoundHandler() {
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        message: "Not Found",
      });
    });
  }

  /**
   * Iterates over the `CONTROLLERS` registry (from `@/controllers`) and binds
   * each controller via `registerController` from `@plane/decorators`, passing
   * the Hocuspocus server instance as a constructor dependency.
   *
   * This is the decorator-driven route binding mechanism for the live
   * server's controllers (Collaboration, Document, Health, PdfExport).
   */
  private setupRoutes(hocuspocusServer: Hocuspocus) {
    CONTROLLERS.forEach((controller) => registerController(this.router, controller, [hocuspocusServer]));
  }

  /**
   * Binds the underlying HTTP server to `app.get("port")` (resolved from
   * `env.PORT || 3000` in the constructor) and logs the started port.
   *
   * Any listen error is logged via `logger.error` and rethrown so the calling
   * `start.ts` can `process.exit(1)`.
   */
  public listen() {
    this.httpServer = this.app
      .listen(this.app.get("port"), () => {
        logger.info(`SERVER: Express server has started at port ${this.app.get("port")}`);
      })
      .on("error", (err) => {
        logger.error("SERVER: Failed to start server:", err);
        throw err;
      });
  }

  /**
   * Graceful teardown invoked by `start.ts` SIGTERM / SIGINT handlers.
   *
   * Teardown sequence: closes Hocuspocus connections via `closeConnections()`
   * from `@hocuspocus/server` → disconnects Redis via
   * `redisManager.disconnect()` → closes the HTTP server through a Promise
   * wrapper around `httpServer.close()`.
   *
   * Resolves once all three steps complete; rejects on any underlying close
   * failure.
   */
  public async destroy() {
    if (this.hocuspocusServer) {
      this.hocuspocusServer.closeConnections();
      logger.info("SERVER: HocusPocus connections closed gracefully.");
    }

    await redisManager.disconnect();
    logger.info("SERVER: Redis connection closed gracefully.");

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            logger.info("SERVER: Express server closed gracefully.");
            resolve();
          }
        });
      });
    }
  }
}
