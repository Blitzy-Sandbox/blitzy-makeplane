/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reusable Effect-based resilience helpers for the PDF export pipeline in the
 * `apps/live` real-time collaboration service. Built on the `effect` library
 * (imported below), this module exports three composable helpers that wrap
 * external operations with timeout, retry, and error-recovery semantics.
 *
 * Exported helpers:
 *  - `withTimeoutAndRetry` — wraps an Effect with a `Duration`-bounded timeout
 *    (default `5000` ms) and exponential-backoff retry (default `2` retries),
 *    failing with `PdfTimeoutError` on timeout exhaustion.
 *  - `recoverWithDefault` — converts any failure into a provided fallback
 *    value, logging a warning before recovery so the failure remains
 *    observable in operator logs.
 *  - `tryAsync` — adapts a `Promise`-returning callback into a typed
 *    `Effect.Effect<A, E>` with custom error mapping; the canonical bridge
 *    from native Promise-based APIs (axios, sharp, fetch) into Effect.
 *
 * Use site: `./pdf-export.service.ts` composes these helpers around every
 * external operation (page content fetch, user-mention lookup, asset URL
 * resolution, image download/transform, PDF render) to enforce per-step
 * timeouts and bounded retries.
 *
 * Schema dependency: `PdfTimeoutError` from `@/schema/pdf-export` is a tagged
 * Effect error used as the timeout failure code in `withTimeoutAndRetry`;
 * downstream callers pattern-match against it via `Effect.catchTag` and the
 * controller maps it onto HTTP 504 (Gateway Timeout).
 *
 * Architectural rationale: the PDF export pipeline runs as a synchronous HTTP
 * request from `../../controllers/pdf-export.controller.ts` — it is NOT a
 * Celery task (Celery is the `apps/api` task spine on RabbitMQ and is not
 * used inside `apps/live`). Bounding each step prevents the HTTP handler from
 * hanging on slow `apps/api` responses or oversized assets. The Effect
 * library is scoped to this folder (and the corresponding controller)
 * because per-step timeout/retry/recovery semantics would be cumbersome to
 * express with raw Promises.
 */

import { Effect, Duration, Schedule, pipe } from "effect";
import { PdfTimeoutError } from "@/schema/pdf-export";

/**
 * Wraps an effect with timeout and exponential backoff retry logic.
 * Preserves the environment type `R` for proper dependency injection so
 * downstream callers can compose this helper with other Effect services
 * without losing the dependency-injection environment.
 *
 * @param operation - Operation label embedded in the timeout error message
 *   (`Operation "<operation>" timed out after <timeoutMs>ms`) and in retry
 *   log warnings (`PDF_EXPORT: Retrying operation`); used by operators to
 *   identify which pipeline stage failed.
 * @param config - Optional configuration object:
 *   - `timeoutMs` (number, default `5000`): per-attempt timeout in
 *     milliseconds; on expiry the Effect fails with `PdfTimeoutError`.
 *   - `maxRetries` (number, default `2`): number of additional retry
 *     attempts after the first failure (so up to `maxRetries + 1` total
 *     attempts).
 * @returns A curried function that wraps any `Effect.Effect<A, E, R>` into
 *   `Effect.Effect<A, E | PdfTimeoutError, R>` — preserving the original
 *   environment `R` while expanding the error channel with `PdfTimeoutError`.
 *
 * Timeout behaviour: `Effect.timeoutFail` arms a `Duration.millis(timeoutMs)`
 * deadline and lifts expiry into a new `PdfTimeoutError({ message, operation })`
 * (the tagged error from `@/schema/pdf-export`), which the controller maps
 * to HTTP 504 (Gateway Timeout).
 *
 * Retry schedule: `Schedule.exponential(Duration.millis(200))` composed with
 * `Schedule.recurs(maxRetries)`; `Schedule.tapInput` emits
 * `Effect.logWarning("PDF_EXPORT: Retrying operation", { operation, error })`
 * for each retry so operators can trace transient failures. `tapInput`
 * receives the failure that triggered the retry (vs. `tapOutput`, which
 * would observe the schedule's emitted delay) — the correct source for
 * diagnostic logging.
 *
 * Backoff progression: the inter-attempt wait doubles per retry —
 * 200 ms, 400 ms, 800 ms, ... With the defaults
 * (`maxRetries = 2`, `timeoutMs = 5000`) the worst-case wall-clock for three
 * attempts plus two backoff gaps is `5000 + 200 + 5000 + 400 + 5000 = 15600`
 * ms.
 *
 * Use sites in `./pdf-export.service.ts`:
 *  - `fetch page content` (`timeoutMs: 7000`, `maxRetries: 3`) — page
 *    description fetch from `apps/api` (line 90); aggressive retry because
 *    transient network blips are common on this hop.
 *  - `process image ${assetId}` (`timeoutMs: 8000`, `maxRetries: 1`) — image
 *    download + sharp transform (line 232); one retry guards against
 *    transient asset-store hiccups.
 *  - `render PDF` (`timeoutMs: 15000`, `maxRetries: 0`) — final
 *    `@react-pdf/renderer` invocation (line 290); rendering is deterministic
 *    so retrying would waste budget.
 */
export const withTimeoutAndRetry =
  (operation: string, { timeoutMs = 5000, maxRetries = 2 }: { timeoutMs?: number; maxRetries?: number } = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | PdfTimeoutError, R> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: Duration.millis(timeoutMs),
        onTimeout: () =>
          new PdfTimeoutError({
            message: `Operation "${operation}" timed out after ${timeoutMs}ms`,
            operation,
          }),
      }),
      Effect.retry(
        pipe(
          Schedule.exponential(Duration.millis(200)),
          Schedule.compose(Schedule.recurs(maxRetries)),
          Schedule.tapInput((error: E | PdfTimeoutError) =>
            Effect.logWarning("PDF_EXPORT: Retrying operation", { operation, error })
          )
        )
      )
    );

/**
 * Recovers from any error with a default fallback value.
 * Logs the error before recovering so the failure remains observable in
 * operator dashboards even though it no longer propagates.
 *
 * @param fallback - Value typed to match the success channel of the wrapped
 *   Effect; emitted in place of the failure. Callers typically supply an
 *   empty collection (e.g. `[]`, `new Map()`) for non-critical metadata
 *   lookups; the `A` type is inferred at the call site, so an explicit
 *   annotation (e.g. `recoverWithDefault([] as Array<...>)`) keeps the
 *   fallback aligned with the wrapped Effect's success type.
 * @returns A curried function that wraps any `Effect.Effect<A, E, R>` into
 *   `Effect.Effect<A, never, R>` — the error channel is eliminated because
 *   every failure resolves to `fallback`; the environment type `R` is
 *   preserved so the helper composes with Effect service layers.
 *
 * Behaviour:
 *  1. `Effect.tapError((error) => Effect.logWarning("PDF_EXPORT: Operation
 *     failed, using fallback", { error }))` — emits a structured warning
 *     while the error is still in flight so the failure is visible in logs.
 *  2. `Effect.catchAll(() => Effect.succeed(fallback))` — catches every
 *     failure and emits the fallback value as success, collapsing the error
 *     channel to `never`.
 *
 * Use sites in `./pdf-export.service.ts`:
 *  - Line 133: the `fetchUserMentions` lookup falls back to `[]` (empty
 *    mention list); user mentions are decorative metadata, so the PDF still
 *    renders without them.
 *  - Line 175: image URL resolution falls back to `new Map<string, string>()`
 *    (empty URL map); images degrade to placeholders but the document still
 *    renders.
 *
 * Caution: this helper silently swallows errors after logging. Apply it only
 * when the surrounding logic can tolerate the absence of the value;
 * otherwise let the failure propagate so the caller (or `Effect.catchTag`)
 * can handle it.
 */
export const recoverWithDefault =
  <A>(fallback: A) =>
  <E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
    effect.pipe(
      Effect.tapError((error) => Effect.logWarning("PDF_EXPORT: Operation failed, using fallback", { error })),
      Effect.catchAll(() => Effect.succeed(fallback))
    );

/**
 * Wraps a promise-returning function with proper Effect error handling.
 * Adapts a `Promise`-returning callback into a typed `Effect.Effect<A, E>`
 * with custom error mapping — the canonical bridge from native Promise-based
 * APIs (axios, sharp, fetch) into the Effect pipeline.
 *
 * @param fn - A zero-argument thunk that returns a promise. MUST be a thunk
 *   (not a pre-created promise) so Effect's runtime controls when execution
 *   begins; passing an already-running promise would break Effect's
 *   referential transparency and resource-scoping guarantees.
 * @param onError - Maps thrown errors / rejected promise causes (`unknown`)
 *   to typed Effect failures (typically constructing a tagged error such as
 *   `PdfContentFetchError`, `PdfImageProcessingError`, or
 *   `PdfGenerationError`).
 * @returns An `Effect.Effect<A, E>` that, when run, invokes `fn()` once and
 *   maps any rejection through `onError`. Thin wrapper around
 *   `Effect.tryPromise({ try: fn, catch: onError })` — direct calls to
 *   `Effect.tryPromise` would be equally valid but more verbose at call
 *   sites. `Effect.tryPromise` is preferred over `Effect.promise` because it
 *   requires a `catch` handler, lifting rejections into typed failures
 *   rather than propagating them as untyped defects.
 *
 * Use sites in `./pdf-export.service.ts`:
 *  - Lines 82-94: page content fetch via
 *    `pageService.fetchDescriptionBinary(pageId)` → mapped to
 *    `PdfContentFetchError`.
 *  - Lines 125-133: user mention fetch via
 *    `pageService.fetchUserMentions?.(pageId)` → mapped to `[]` via
 *    `recoverWithDefault`.
 *  - Lines 165-175: asset URL resolution via
 *    `pageService.resolveImageAssetUrl?.(...)` → mapped to `new Map()` via
 *    `recoverWithDefault`.
 *  - Lines 184-192: image fetch via `fetch(url)` → mapped to
 *    `PdfImageProcessingError`.
 *  - Lines 203-211: image body read via `response.arrayBuffer()` → mapped to
 *    `PdfImageProcessingError`.
 *  - Lines 213-227: image transformation via
 *    `sharp(...).rotate()...toBuffer()` → mapped to
 *    `PdfImageProcessingError`.
 *  - Lines 274-290: PDF render via `renderPlaneDocToPdfBuffer(...)` → mapped
 *    to `PdfGenerationError`.
 */
export const tryAsync = <A, E>(fn: () => Promise<A>, onError: (cause: unknown) => E): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: fn,
    catch: onError,
  });
