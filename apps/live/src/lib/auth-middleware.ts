/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Express middleware for inter-service HTTP authentication in the apps/live
 * real-time collaboration server.
 *
 * Exports `requireSecretKey` — a route-level guard that validates the
 * `live-server-secret-key` request header against `env.LIVE_SERVER_SECRET_KEY`
 * (declared REQUIRED in `apps/live/src/env.ts`, so the apps/live process refuses
 * to start when the variable is missing). It is the primary authentication
 * boundary for inter-service HTTP calls from `apps/api` into `apps/live` —
 * admin commands, force-close coordination, and document export triggers.
 *
 * Applied to controller routes via the `@Middleware(requireSecretKey)` decorator
 * from `@plane/decorators` (e.g., `apps/live/src/controllers/document.controller.ts`).
 *
 * Architectural distinction: this module secures HTTP routes only. WebSocket
 * connection authentication is handled separately by `apps/live/src/lib/auth.ts`
 * (the `onAuthenticate` hook), which validates session cookies — Plane uses
 * session-cookie auth, NOT JWT. Both modules consume the same
 * `LIVE_SERVER_SECRET_KEY` for inter-service trust, but at different transport
 * layers (HTTP request header vs. WebSocket handshake).
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@plane/logger";
import { env } from "@/env";

/**
 * Express middleware to verify secret key authentication for protected endpoints
 *
 * Checks for secret key in headers:
 * - x-admin-secret-key (preferred for admin endpoints)
 * - live-server-secret-key (for backward compatibility)
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * ```typescript
 * import { Middleware } from "@plane/decorators";
 * import { requireSecretKey } from "@/lib/auth-middleware";
 *
 * @Get("/protected")
 * @Middleware(requireSecretKey)
 * async protectedEndpoint(req: Request, res: Response) {
 *   // This will only execute if secret key is valid
 * }
 * ```
 *
 * @remarks
 * Route-level guard semantics: requires the `live-server-secret-key` request
 * header to match `env.LIVE_SERVER_SECRET_KEY` (validated as REQUIRED at server
 * startup via `apps/live/src/env.ts`).
 *
 * Failure behavior: on missing or mismatched header, responds with HTTP
 * `401 Unauthorized` and JSON body `{ error: "Unauthorized", status: 401 }`;
 * does NOT call `next()`, so the wrapped route handler never executes.
 *
 * Audit logging on failure: emits a structured `logger.warn(...)` from
 * `@plane/logger` including the request `path`, `method`, `ip`, and
 * `User-Agent` for security observability.
 *
 * Success behavior: calls `next()` to pass control to the next middleware or
 * route handler with no state mutation on the request object.
 *
 * @see `apps/live/src/lib/auth.ts` — WebSocket equivalent (`onAuthenticate`
 * hook); both modules consume `LIVE_SERVER_SECRET_KEY` for inter-service auth.
 */
// TODO - Move to hmac
export const requireSecretKey = (req: Request, res: Response, next: NextFunction): void => {
  const secretKey = req.headers["live-server-secret-key"];

  if (!secretKey || secretKey !== env.LIVE_SERVER_SECRET_KEY) {
    logger.warn(`
  ⚠️  [AUTH] Unauthorized access attempt
     Endpoint: ${req.path}
     Method: ${req.method}
     IP: ${req.ip}
     User-Agent: ${req.headers["user-agent"]}
      `);

    res.status(401).json({
      error: "Unauthorized",
      status: 401,
    });
    return;
  }

  // Secret key is valid, proceed to the route handler
  next();
};
