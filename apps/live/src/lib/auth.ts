/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * WebSocket authentication workflow for the apps/live Hocuspocus collaboration server.
 *
 * Wiring: `onAuthenticate` is registered on the Hocuspocus server constructor in
 * `apps/live/src/hocuspocus.ts` (see the `onAuthenticate` field on the `Hocuspocus`
 * options object) and is invoked once per incoming WebSocket handshake — before any
 * document is loaded and before any extension `onConnect` fires.
 *
 * Authentication scheme: Plane uses session cookies (NOT JWT). The client must pass
 * the session cookie during the WebSocket handshake. Cookie sources, in priority
 * order, are: (1) the JSON-encoded token payload (`TUserDetails` from
 * `@plane/editor`) carried in `data.token`, and (2) the `cookie` request header
 * (`data.requestHeaders.cookie`). URL query parameters are intentionally NOT used as
 * a credential transport — placing session cookies in URLs would leak them into
 * proxy logs, browser histories, and server access logs. A missing cookie after both
 * sources are tried short-circuits to `AppError("AUTH_MISSING_CREDENTIALS")`.
 *
 * Authentication chain:
 *   1. Parse the token payload and request cookie.
 *   2. Enrich the mutable Hocuspocus `context` (`HocusPocusServerContext`) with
 *      `cookie`, `documentType`, `projectId`, `userId`, and `workspaceSlug`.
 *   3. Delegate to `handleAuthentication`, which calls `UserService.currentUser(cookie)`
 *      against apps/api `GET /api/users/me/`.
 *   4. Verify the apps/api-returned user id matches the token-derived `userId`.
 *
 * Context enrichment: the populated `HocusPocusServerContext` is read by ALL
 * downstream extension hooks (`apps/live/src/extensions/database.ts`,
 * `apps/live/src/extensions/title-sync.ts`, etc.) to scope subsequent apps/api
 * calls by workspace, project, and user — extensions never re-parse the token.
 *
 * Document lifecycle traceability (connect → edit → persist → disconnect):
 *   - connect: `onAuthenticate` validates the WebSocket handshake and populates
 *     `context`, which then flows into `extensions/database.ts.fetchDocument`
 *     for the initial document load.
 *   - edit: `context.cookie` + `context.workspaceSlug` + `context.projectId` are
 *     used by extensions to scope subsequent apps/api calls.
 *   - persist: `extensions/database.ts.storeDocument` uses `context.cookie` to
 *     authenticate the PATCH back to apps/api.
 *   - disconnect: voluntary close requires no cleanup here; involuntary
 *     force-close surfaces failures via `AppError` from `@/lib/errors`.
 *
 * Cross-reference: see `apps/live/src/lib/auth-middleware.ts.requireSecretKey`
 * for the HTTP inter-service authentication counterpart; both flows ultimately
 * depend on `LIVE_SERVER_SECRET_KEY` to establish trust between apps/live and
 * apps/api.
 */

// plane imports
import type { IncomingHttpHeaders } from "http";
import type { TUserDetails } from "@plane/editor";
import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
// services
import { UserService } from "@/services/user.service";
// types
import type { HocusPocusServerContext, TDocumentTypes } from "@/types";

/**
 * Hocuspocus `onAuthenticate` callback — validates the incoming WebSocket auth
 * payload and enriches the connection context for all downstream extension hooks.
 *
 * Trigger: incoming WebSocket handshake, before any document is loaded and before
 * any extension `onConnect` fires (registered in `apps/live/src/hocuspocus.ts`).
 *
 * State read:
 *   - `data.token` — JSON-parsed into `TUserDetails` (from `@plane/editor`) to
 *     extract the user `id` and `cookie`.
 *   - `data.requestHeaders.cookie` — used as a fallback when the token payload
 *     does not carry a cookie.
 *   - `data.requestParameters` URL query — `documentType`, `projectId`, and
 *     `workspaceSlug` (non-credential scoping metadata). The session cookie is
 *     NOT read from query parameters: credentials must travel in the token
 *     payload or `Cookie` header so they do not leak into proxy/browser/server
 *     access logs.
 *
 * State write — mutates the shared `HocusPocusServerContext`:
 *   - `context.cookie` — session cookie used by every subsequent apps/api call.
 *   - `context.documentType` — narrowed to `TDocumentTypes` (e.g. `"project_page"`).
 *   - `context.projectId` — project ownership scope (nullable).
 *   - `context.userId` — authenticated user id.
 *   - `context.workspaceSlug` — workspace ownership scope (nullable).
 *
 * Validation: throws `AppError` with `code: "AUTH_MISSING_CREDENTIALS"` when
 * either `cookie` or `userId` is absent after extraction. A token-parse failure
 * is non-fatal — the error is logged and the cookie fallback chain continues.
 *
 * Delegation: calls `handleAuthentication({ cookie, userId })` to verify the
 * session against apps/api and returns the resolved user shape
 * `{ user: { id, name } }` to Hocuspocus core, which stores it as
 * `connection.context.user` for all subsequent hooks.
 *
 * Architectural note: all downstream extension hooks
 * (`extensions/database.ts.fetchDocument`/`storeDocument`,
 * `extensions/title-sync.ts`, etc.) READ from this enriched context — they
 * never re-parse the raw token.
 *
 * @param data - The Hocuspocus authentication payload object.
 * @param data.requestHeaders - Incoming HTTP request headers from the handshake.
 * @param data.requestParameters - URL search parameters carried on the handshake.
 * @param data.context - The mutable `HocusPocusServerContext` populated here.
 * @param data.token - Raw token string (JSON-encoded `TUserDetails`) sent by the client.
 * @returns A Promise resolving to `{ user: { id, name } }` for the authenticated user.
 * @throws {AppError} With `code: "AUTH_MISSING_CREDENTIALS"` when cookie or userId is missing.
 */
export const onAuthenticate = async ({
  requestHeaders,
  requestParameters,
  context,
  token,
}: {
  requestHeaders: IncomingHttpHeaders;
  context: HocusPocusServerContext;
  requestParameters: URLSearchParams;
  token: string;
}) => {
  let cookie: string | undefined = undefined;
  let userId: string | undefined = undefined;

  // Extract cookie (fallback to request headers) and userId from token (for scenarios where
  // the cookies are not passed in the request headers)
  try {
    const parsedToken = JSON.parse(token) as TUserDetails;
    userId = parsedToken.id;
    cookie = parsedToken.cookie;
  } catch (error) {
    const appError = new AppError(error, {
      context: { operation: "onAuthenticate" },
    });
    logger.error("Token parsing failed, using request headers", appError);
  } finally {
    // If cookie is still not found, fallback to request headers
    if (!cookie) {
      cookie = requestHeaders.cookie?.toString();
    }
  }

  if (!cookie || !userId) {
    const appError = new AppError("Credentials not provided", { code: "AUTH_MISSING_CREDENTIALS" });
    logger.error("Credentials not provided", appError);
    throw appError;
  }

  // set cookie in context, so it can be used throughout the ws connection
  // INTENT UNCLEAR: the `requestParameters.get("cookie")` branch is unreachable because
  // the preceding `!cookie` guard always throws when `cookie` is falsy; this fallback
  // may be a legacy artifact, but URL-query credential transport is unsafe (leaks into
  // proxy/browser/server access logs) so removing it should be a separate, deliberate change.
  context.cookie = cookie ?? requestParameters.get("cookie") ?? "";
  context.documentType = requestParameters.get("documentType")?.toString() as TDocumentTypes;
  context.projectId = requestParameters.get("projectId");
  context.userId = userId;
  context.workspaceSlug = requestParameters.get("workspaceSlug");

  return await handleAuthentication({
    cookie: context.cookie,
    userId: context.userId,
  });
};

/**
 * Verifies a session cookie against apps/api by fetching the current user and
 * confirming that the returned identity matches the token-derived `userId`.
 *
 * Behavior: instantiates `UserService` (from `@/services/user.service`) and calls
 * `userService.currentUser(cookie)`, which performs `GET /api/users/me/` on
 * apps/api with the cookie attached. The response's `user.id` is then compared
 * against the supplied `userId` to detect cookie/token mismatch attacks.
 *
 * Failure modes:
 *   - User-id mismatch — throws `AppError` with `code: "AUTH_USER_MISMATCH"`
 *     (the token was issued for a different user than the session cookie).
 *   - Network error / 401 from apps/api / any other failure — the underlying
 *     error is wrapped into an `AppError`, logged via `@plane/logger`, and a
 *     fresh `AppError("Authentication unsuccessful", { code })` is rethrown so
 *     the Hocuspocus client receives a uniform error code.
 *
 * Architectural note: Plane uses session cookies (NOT JWT) — the cookie is the
 * source of truth. The token-derived `userId` is a redundant integrity check
 * that guards against token tampering and cookie/token mismatch.
 *
 * Cross-reference: `apps/live/src/services/user.service.ts.currentUser` for the
 * underlying axios call against apps/api `GET /api/users/me/`.
 *
 * @param params - The credentials extracted from the WebSocket handshake.
 * @param params.cookie - The session cookie used to authenticate against apps/api.
 * @param params.userId - The user id extracted from the token payload.
 * @returns A Promise resolving to `{ user: { id, name } }` — the shape Hocuspocus
 *   stores on the connection.
 * @throws {AppError} With `code: "AUTH_USER_MISMATCH"` when the apps/api-returned
 *   user id does not match the supplied `userId`; otherwise a generic `AppError`
 *   carrying the underlying failure code.
 */
export const handleAuthentication = async ({ cookie, userId }: { cookie: string; userId: string }) => {
  // fetch current user info
  try {
    const userService = new UserService();
    const user = await userService.currentUser(cookie);
    if (user.id !== userId) {
      throw new AppError("Authentication unsuccessful: User ID mismatch", { code: "AUTH_USER_MISMATCH" });
    }

    return {
      user: {
        id: user.id,
        name: user.display_name,
      },
    };
  } catch (error) {
    const appError = new AppError(error, {
      context: { operation: "handleAuthentication" },
    });
    logger.error("Authentication failed", appError);
    throw new AppError("Authentication unsuccessful", { code: appError.code });
  }
};
