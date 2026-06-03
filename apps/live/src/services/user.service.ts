/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * UserService — authenticated current-user lookup against apps/api.
 *
 * This module is the bridge between the Hocuspocus WebSocket authentication callback and the apps/api
 * `GET /api/users/me/` endpoint. Plane uses session cookies (NOT JWT) per the architectural context, so the cookie
 * is the source of truth for identity; the token-derived user ID is a redundant integrity check enforced by the
 * consumer.
 *
 * Sole consumer: `apps/live/src/lib/auth.ts.handleAuthentication` instantiates `new UserService()` once per
 * WebSocket handshake and calls `currentUser` to confirm the session cookie resolves to the user ID carried in
 * the token.
 *
 * Inheritance: `UserService` extends `APIService` (from `@/services/api.service`) for axios client setup
 * (`withCredentials: true`, 20s timeout), `baseURL` resolution from `env.API_BASE_URL`, the response interceptor
 * that normalizes failures into `AppError`, and the in-memory header bag.
 */

// types
import { logger } from "@plane/logger";
import type { IUser } from "@plane/types";
// services
import { AppError } from "@/lib/errors";
import { APIService } from "@/services/api.service";

/**
 * Authenticated current-user lookup service against apps/api `GET /api/users/me/`.
 *
 * Extends `APIService` to inherit the axios client (`withCredentials: true`, 20-second timeout),
 * `setHeader` / `getHeader` helpers, HTTP verb wrappers (`get` / `post` / `put` / `patch` / `delete` / `request`),
 * and the response interceptor that wraps every axios failure into an `AppError`.
 *
 * Auth scheme: cookie-based session handoff via the `Cookie` request header — Plane does NOT use JWT (see
 * the architectural context). The consumer `apps/live/src/lib/auth.ts.handleAuthentication` is the only caller;
 * it instantiates this service per WebSocket handshake and uses `currentUser(cookie)` to verify the session
 * against apps/api.
 *
 * Errors from apps/api are wrapped in `AppError` with `context: { operation: "currentUser" }`, logged via
 * `@plane/logger`, and rethrown so the auth flow surfaces a uniform error code.
 *
 * @see apps/live/src/lib/auth.ts (sole consumer; participates in the `connect` phase of the document lifecycle)
 */
export class UserService extends APIService {
  /**
   * Defer to `APIService` to resolve `baseURL` from `env.API_BASE_URL` (validated as a required URL in
   * `apps/live/src/env.ts`). The base URL is not parameterized — this service always targets the apps/api host
   * configured via the `API_BASE_URL` env variable.
   */
  constructor() {
    super();
  }

  /**
   * Build the fully qualified absolute URL for the `/api/users/me/` endpoint using the inherited `baseURL`.
   *
   * Metadata helper for callers that need the absolute URL (e.g., logging, request builders, or non-axios HTTP
   * clients) without performing the GET — for the actual request, use `currentUser(cookie)`.
   *
   * @returns Object containing the complete URL ready for axios consumption.
   */
  currentUserConfig() {
    return {
      url: `${this.baseURL}/api/users/me/`,
    };
  }

  /**
   * Perform an authenticated GET to apps/api `/api/users/me/` with the session cookie attached, returning the
   * authenticated user's profile.
   *
   * The relative URL is sent through the inherited axios client (`withCredentials: true`, 20s timeout) which
   * prepends `baseURL` from `env.API_BASE_URL`. The `Cookie` header carries the session cookie and is the
   * canonical auth mechanism — Plane uses session cookies, NOT JWT (per the architectural context); the
   * token-derived user ID is verified against the returned `user.id` by the consumer in `lib/auth.ts`, not by
   * this method.
   *
   * On failure, the underlying axios error is wrapped in `AppError` with `context: { operation: "currentUser" }`,
   * a structured error is emitted via `@plane/logger`, and the `AppError` is rethrown so callers (typically
   * `handleAuthentication` in `lib/auth.ts`) can react to authentication failures.
   *
   * @param cookie - The session cookie string (typically extracted from the WebSocket handshake by
   *   `onAuthenticate` in `lib/auth.ts`) sent verbatim in the `Cookie` request header.
   * @returns The authenticated user's `IUser` profile (id, display_name, email, avatar_url, etc., per the `IUser`
   *   interface from `@plane/types`).
   */
  async currentUser(cookie: string): Promise<IUser> {
    return this.get("/api/users/me/", {
      headers: {
        Cookie: cookie,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        const appError = new AppError(error, {
          context: { operation: "currentUser" },
        });
        logger.error("Failed to fetch current user", appError);
        throw appError;
      });
  }
}
