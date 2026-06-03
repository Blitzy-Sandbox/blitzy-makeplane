/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical error module for the `apps/live` real-time collaboration service.
 *
 * Exposes {@link AppError}, the single error type used to normalize every diverse error source —
 * plain strings, standard `Error`, `DOMException` aborts, axios `AxiosError`, and already-wrapped
 * `AppError` instances — into a uniform shape carrying minimal but sufficient diagnostic info.
 *
 * Use sites (illustrative, not exhaustive):
 *   - HTTP service layer: `services/api.service.ts` (axios response interceptor at line 31),
 *     `services/page/core.service.ts` (lines 33, 56, 75, 83, 97, 125, 148),
 *     `services/page/handler.ts` (line 21), `services/page/project-page.service.ts` (lines 23, 25),
 *     `services/user.service.ts` (line 33)
 *   - Hocuspocus extensions: `extensions/database.ts` (lines 53, 62, 93),
 *     `extensions/title-sync.ts` (lines 62, 165),
 *     `extensions/title-update/title-update-manager.ts` (line 69),
 *     `extensions/redis.ts` (lines 19, 94)
 *   - Stateless broadcast helpers: `utils/broadcast-message.ts` (line 19)
 *   - HTTP controllers: `controllers/pdf-export.controller.ts` (line 111)
 *   - Authentication: `lib/auth.ts` (lines 45, 57, 81, 91, 95)
 *   - Process bootstrap: `start.ts` (lines 56, 61 — `unhandledRejection` / `uncaughtException` handlers)
 *
 * Security: this module deliberately strips bulky and sensitive runtime details (request headers,
 * cookies, full axios config, full response bodies) before reaching log sinks. When consumers log
 * via `@plane/logger`, the truncated shape prevents session-cookie and OAuth-token leakage in
 * downstream error pipelines — bypassing this wrapper would defeat that protection.
 */

import type { AxiosError } from "axios";

/**
 * Application error class that sanitizes and standardizes errors across the app.
 * Extracts only essential information from AxiosError to prevent massive log bloat
 * and sensitive data leaks (cookies, tokens, etc).
 *
 * Usage:
 *   new AppError("Simple error message")
 *   new AppError("Custom error", { code: "MY_CODE", statusCode: 400 })
 *   new AppError(axiosError)  // Auto-extracts essential info
 *   new AppError(anyError)    // Works with any error type
 *
 * Class hierarchy: extends the standard `Error`. The constructor short-circuits when the input is
 * already an `AppError` and returns the existing instance unchanged, so chains like
 * `new AppError(new AppError(originalError))` collapse to a single layer (idempotent under repeated
 * wrapping — see branch 1 of the normalization sequence below).
 *
 * Preserved diagnostic fields (all optional, declared just below this docblock):
 *   - `statusCode?: number` — HTTP status, extracted from `AxiosError.response.status`
 *   - `method?: string` — HTTP method (uppercased), extracted from `AxiosError.config.method`
 *   - `url?: string` — request URL, extracted from `AxiosError.config.url`
 *   - `code?: string` — error code; populated from `AxiosError.code` (e.g., `"ECONNREFUSED"`),
 *     DOMException name (`"ABORT_ERROR"`), standard `Error.name`, or an explicit `data` override
 *   - `context?: Record<string, any>` — caller-supplied metadata for additional diagnostic context
 *     (e.g., `{ operation: "onAuthenticate" }`, `{ pageId }`); deliberately untyped so debugging
 *     info can be attached freely at the call site
 *
 * Normalization branches (constructor evaluation order):
 *   1. Already-AppError — returns the existing instance unchanged; guards against re-wrapping
 *   2. String message — standard `Error(message)` behavior plus optional `data` field assignment
 *   3. AxiosError — extracts ONLY `response.data.message || message`, `response.status`,
 *      uppercased `config.method`, `config.url`, and `code`; explicitly excludes `config.headers`,
 *      `config.data`, and the full response object to prevent credential leaks
 *   4. DOMException AbortError — extracts message and sets `code = "ABORT_ERROR"` so callers can
 *      distinguish cancelled requests from genuine failures
 *   5. Standard Error — extracts message and sets `code = error.name`
 *   6. Unknown type fallback — generic `"Unknown error occurred"` message
 *
 * Known `code` conventions emitted by in-tree callers:
 *   - `"AUTH_MISSING_CREDENTIALS"` — `lib/auth.ts#onAuthenticate` when cookie or userId is absent
 *   - `"AUTH_USER_MISMATCH"` — `lib/auth.ts#handleAuthentication` on session/token user-id mismatch
 *   - `"ABORT_ERROR"` — set internally by branch 4 for cancelled axios requests
 *   - Framework codes propagated from `AxiosError.code` (e.g., `"ECONNREFUSED"`, `"ETIMEDOUT"`,
 *     `"ERR_CANCELED"`, `"ERR_BAD_RESPONSE"`) and from `Error.name` (e.g., `"TypeError"`,
 *     `"RangeError"`)
 *
 * Constructor signature: the first argument is either a literal message string or any error-shaped
 * value (`AppError`, `AxiosError`, `DOMException`, `Error`, or `unknown`); the optional `data`
 * argument is a partial override that can preset `statusCode` / `method` / `url` / `code` /
 * `context` on the resulting instance (currently honored only on the string-message branch — other
 * branches derive these fields from the source error and ignore the override).
 *
 * Sanitization rationale: this class is the single chokepoint that strips axios's verbose default
 * error shape from logs. Callers must opt-in to additional fields via the `data.context` parameter
 * and must never log the raw axios error directly, as it would leak headers, cookies, and request
 * payloads to the log pipeline.
 *
 * Lifecycle traceability (`connect → edit → persist → disconnect`):
 *   - `connect` failures: `lib/auth.ts` throws `AppError` with auth-specific codes
 *     (`AUTH_MISSING_CREDENTIALS`, `AUTH_USER_MISMATCH`)
 *   - `edit` / `persist` failures: `extensions/database.ts` and `services/page/core.service.ts`
 *     wrap axios failures in `AppError`, typically with `{ context: { pageId } }`
 *   - `disconnect` involuntary failures: `extensions/force-close-handler.ts` and
 *     `utils/broadcast-error.ts` surface them through `AppError` to the connected clients
 *
 * @see {@link AxiosError} for the upstream axios error shape this class sanitizes.
 */
export class AppError extends Error {
  statusCode?: number;
  method?: string;
  url?: string;
  code?: string;
  context?: Record<string, any>;

  constructor(messageOrError: string | unknown, data?: Partial<Omit<AppError, "name" | "message">>) {
    // Handle error objects - extract essential info
    const error = messageOrError;

    // Already AppError - return immediately for performance (no need to re-process)
    if (error instanceof AppError) {
      return error;
    }

    // Handle string message (simple case like regular Error)
    if (typeof messageOrError === "string") {
      super(messageOrError);
      this.name = "AppError";
      if (data) {
        Object.assign(this, data);
      }
      return;
    }

    // AxiosError - extract ONLY essential info (no config, no headers, no cookies)
    if (error && typeof error === "object" && "isAxiosError" in error) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data as any;
      super(responseData?.message || axiosError.message);
      this.name = "AppError";
      this.statusCode = axiosError.response?.status;
      this.method = axiosError.config?.method?.toUpperCase();
      this.url = axiosError.config?.url;
      this.code = axiosError.code;
      return;
    }

    // DOMException (AbortError from cancelled requests)
    if (error instanceof DOMException && error.name === "AbortError") {
      super(error.message);
      this.name = "AppError";
      this.code = "ABORT_ERROR";
      return;
    }

    // Standard Error objects
    if (error instanceof Error) {
      super(error.message);
      this.name = "AppError";
      this.code = error.name;
      return;
    }

    // Unknown error types - safe fallback
    super("Unknown error occurred");
    this.name = "AppError";
  }
}
