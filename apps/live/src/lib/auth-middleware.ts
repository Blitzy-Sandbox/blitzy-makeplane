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
import { timingSafeEqual } from "node:crypto";
import { logger } from "@plane/logger";
import { env } from "@/env";

/**
 * Constant-time verification of a request-supplied secret key against
 * `env.LIVE_SERVER_SECRET_KEY`.
 *
 * Resistant to timing-attack reconnaissance: the cryptographic comparison runs
 * for the same number of byte operations regardless of where the first
 * mismatching byte sits, so an attacker cannot infer matched prefix length from
 * response latency.
 *
 * Length-mismatch behavior: `node:crypto.timingSafeEqual` requires equal-length
 * buffers and throws otherwise; this helper short-circuits on length mismatch
 * before invoking it. The length comparison itself is non-secret (the expected
 * key length is constant per-process and unrelated to the attacker-supplied
 * input), so this short-circuit does not leak useful timing information about
 * the secret material.
 *
 * Multi-value / missing header behavior: rejects when the header is absent or
 * arrives as `string[]` (multi-header transport), which Express models as
 * `string | string[] | undefined`.
 *
 * @param providedKey - The value of the incoming `live-server-secret-key`
 *   request header. Express returns `string | string[] | undefined`.
 * @returns `true` only when `providedKey` is a single string whose bytes match
 *   `env.LIVE_SERVER_SECRET_KEY` under constant-time comparison.
 */
const isSecretKeyValid = (providedKey: string | string[] | undefined): boolean => {
  if (typeof providedKey !== "string" || providedKey.length === 0) {
    return false;
  }

  const expected = Buffer.from(env.LIVE_SERVER_SECRET_KEY);
  const received = Buffer.from(providedKey);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
};

/**
 * Express middleware that authenticates requests by constant-time comparison of
 * the `live-server-secret-key` header against `env.LIVE_SERVER_SECRET_KEY`.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Express next function.
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
 * Validation contract: the comparison is performed by {@link isSecretKeyValid}
 * using `node:crypto.timingSafeEqual` to defeat timing-attack reconnaissance.
 * Direct `===`/`!==` string comparison is intentionally NOT used — JavaScript's
 * string equality returns as soon as the first mismatching byte is observed,
 * which would leak matched-prefix length through response latency.
 *
 * Failure behavior: on missing, multi-valued, length-mismatched, or
 * byte-mismatched header, responds with HTTP `401 Unauthorized` and JSON body
 * `{ error: "Unauthorized", status: 401 }`; does NOT call `next()`, so the
 * wrapped route handler never executes. The failure response is uniform
 * regardless of cause so the client cannot distinguish between the failure
 * modes.
 *
 * Audit logging on failure: emits a structured `logger.warn(...)` from
 * `@plane/logger` including the request `path`, `method`, `ip`, and
 * `User-Agent` for security observability. The provided header value is NEVER
 * logged so a misconfigured caller's secret cannot leak through log sinks.
 *
 * Success behavior: calls `next()` to pass control to the next middleware or
 * route handler with no state mutation on the request object.
 *
 * @see `apps/live/src/lib/auth.ts` — WebSocket equivalent (`onAuthenticate`
 * hook); both modules consume `LIVE_SERVER_SECRET_KEY` for inter-service auth.
 */
export const requireSecretKey = (req: Request, res: Response, next: NextFunction): void => {
  const secretKey = req.headers["live-server-secret-key"];

  if (!isSecretKeyValid(secretKey)) {
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
