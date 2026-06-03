/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Executable entrypoint for the Live Node service (Hocuspocus + Express collaboration server),
 * launched by `pnpm --filter=live start`.
 *
 * Bootstrap sequence:
 *   1. {@link startServer} instantiates {@link Server}.
 *   2. `server.initialize()` brings up the Redis manager and the HocusPocus singleton, then registers Express routes.
 *   3. `server.listen()` binds the HTTP port resolved from `env.PORT`.
 *
 * Shutdown lifecycle:
 *   - SIGTERM handler — graceful container shutdown (Docker / Kubernetes); exits 0 on success.
 *   - SIGINT handler — terminal Ctrl+C; exits 1 to signal interrupted execution.
 *   Both call `server.destroy()` to close Hocuspocus connections, disconnect Redis, and stop the HTTP server.
 *
 * Global error normalization:
 *   - `unhandledRejection` and `uncaughtException` are wrapped in {@link AppError} (from `@/lib/errors`)
 *     and logged via `@plane/logger` so diagnostics stay consistent without terminating the long-running
 *     WebSocket workload.
 *
 * The module-scoped `server` variable holds the singleton {@link Server} instance so the signal
 * handlers can reach `server.destroy()` regardless of bootstrap timing.
 */

import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
import { Server } from "./server";

let server: Server;

/**
 * Bootstraps and starts the Live server by wiring Redis, HocusPocus, and Express together.
 *
 * Invoked exactly once at module load; on any initialization failure the error is logged through
 * `@plane/logger` and the process exits with code 1 so the container runtime can observe the
 * failed startup.
 */
async function startServer() {
  server = new Server();
  try {
    await server.initialize();
    server.listen();
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

// Handle process signals
/**
 * SIGTERM handler — invoked when a container orchestrator (Docker / Kubernetes) requests a
 * graceful pod termination. Calls `server.destroy()` to close Hocuspocus connections, disconnect
 * Redis, and stop the HTTP server, then exits with code 0 on a clean shutdown or code 1 if
 * `destroy()` throws.
 */
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM signal. Initiating graceful shutdown...");
  try {
    if (server) {
      await server.destroy();
    }
    logger.info("Server shut down gracefully");
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
  process.exit(0);
});

/**
 * SIGINT handler — invoked when a developer interrupts the process from an interactive terminal
 * (typically Ctrl+C). Performs the same {@link Server.destroy} teardown as the SIGTERM handler but
 * exits with code 1 to signal that execution was interrupted rather than gracefully requested.
 */
process.on("SIGINT", async () => {
  logger.info("Received SIGINT signal. Killing node process...");
  try {
    if (server) {
      await server.destroy();
    }
    logger.info("Server shut down gracefully");
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
  process.exit(1);
});

/**
 * Last-resort handler for Promise rejections not caught by `.catch()` or `try`/`catch` anywhere
 * in the application. Wraps the original error in {@link AppError} (from `@/lib/errors`) to
 * normalize the diagnostic shape and logs it under the `[UNHANDLED_REJECTION]` tag without
 * terminating the process, preserving uptime for the long-running WebSocket workload.
 */
process.on("unhandledRejection", (err: Error) => {
  const error = new AppError(err);
  logger.error(`[UNHANDLED_REJECTION]`, error);
});

/**
 * Last-resort handler for synchronous exceptions thrown outside any `try`/`catch` boundary.
 * Wraps the original error in {@link AppError} (from `@/lib/errors`) and logs it under the
 * `[UNCAUGHT_EXCEPTION]` tag without terminating the process, preserving uptime for the
 * long-running WebSocket workload.
 */
process.on("uncaughtException", (err: Error) => {
  const error = new AppError(err);
  logger.error(`[UNCAUGHT_EXCEPTION]`, error);
});
