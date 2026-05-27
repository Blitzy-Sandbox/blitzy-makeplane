/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime contract for PDF export requests and the tagged-error hierarchy for
 * the PDF export pipeline in the `apps/live` real-time collaboration service.
 *
 * Built on Effect Schema (the `effect` package — NOT Zod, despite this file
 * living under `schema/`). A single Effect Schema (`PdfExportRequestBody`)
 * powers both runtime validation (`Schema.decodeUnknown(...)`) and the
 * compile-time type (`TPdfExportRequestBody = Schema.Schema.Type<...>`),
 * keeping the two in sync — changes to the schema flow automatically into
 * the inferred TypeScript type.
 *
 * Consumers:
 *  - `apps/live/src/controllers/pdf-export.controller.ts` validates inbound
 *    request bodies via `Schema.decodeUnknown(PdfExportRequestBody)(req.body)`
 *    and maps the tagged errors below onto HTTP status codes.
 *  - `apps/live/src/services/pdf-export/` uses the tagged errors as the
 *    `Effect.Effect<..., PdfExportError, ...>` error channel, enabling
 *    `Effect.catchTag(...)` pattern matching for typed error recovery.
 */

import { Schema } from "effect";

/**
 * Canonical Effect Schema for incoming PDF export request bodies — the single
 * source of truth from which the controller validates input and the service
 * layer derives its compile-time type (`TPdfExportRequestBody`).
 *
 * Required fields:
 *  - `pageId` (non-empty trimmed string): UUID identifying which page to export.
 *  - `workspaceSlug` (non-empty trimmed string): the workspace the page belongs to.
 *
 * Optional fields:
 *  - `projectId` (non-empty trimmed string): present only when the page is
 *    project-scoped; workspace-level pages omit this field.
 *  - `title`, `author`, `subject` (strings): PDF document metadata rendered
 *    into the PDF's metadata/header.
 *  - `pageSize`: literal union `"A4" | "A3" | "A2" | "LETTER" | "LEGAL" | "TABLOID"`.
 *  - `pageOrientation`: literal union `"portrait" | "landscape"`.
 *  - `fileName` (string): desired output filename without the `.pdf` extension
 *    (the controller appends it).
 *  - `noAssets` (boolean): when `true`, skips image processing during
 *    rendering — faster but produces a PDF with no inline images.
 *
 * Use site: `apps/live/src/controllers/pdf-export.controller.ts` (line 35)
 * invokes `Schema.decodeUnknown(PdfExportRequestBody)(req.body)`; decode
 * failures are lifted to `PdfValidationError`.
 */
export const PdfExportRequestBody = Schema.Struct({
  pageId: Schema.NonEmptyTrimmedString,
  workspaceSlug: Schema.NonEmptyTrimmedString,
  projectId: Schema.optional(Schema.NonEmptyTrimmedString),
  title: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  pageSize: Schema.optional(Schema.Literal("A4", "A3", "A2", "LETTER", "LEGAL", "TABLOID")),
  pageOrientation: Schema.optional(Schema.Literal("portrait", "landscape")),
  fileName: Schema.optional(Schema.String),
  noAssets: Schema.optional(Schema.Boolean),
});

/**
 * TypeScript type alias inferred from `PdfExportRequestBody` via
 * `Schema.Schema.Type<...>` — runtime validation and compile-time types are
 * derived from the same source, so changing the schema automatically updates
 * the type.
 *
 * Used for compile-time typing in `apps/live/src/services/pdf-export/` and in
 * tests that operate on request objects after validation has succeeded.
 */
export type TPdfExportRequestBody = Schema.Schema.Type<typeof PdfExportRequestBody>;

/**
 * Raised when `Schema.decodeUnknown(PdfExportRequestBody)(req.body)` fails —
 * the request body has missing, malformed, or mistyped fields.
 *
 * Payload: `{ message: string, cause?: unknown }`. The optional `cause` field
 * preserves the underlying Effect `ParseError` so diagnostic logs can surface
 * which field failed.
 *
 * HTTP mapping: 400 (Bad Request) — see
 * `apps/live/src/controllers/pdf-export.controller.ts.mapErrorToHttpResponse`.
 */
export class PdfValidationError extends Schema.TaggedError<PdfValidationError>()("PdfValidationError", {
  message: Schema.NonEmptyTrimmedString,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Raised when cookie/session validation fails before the request body is
 * parsed — the controller short-circuits with this error when the auth
 * cookie is missing or invalid (see `pdf-export.controller.ts` lines 26-33).
 *
 * Payload: `{ message: string }`. No `cause` field — authentication failures
 * do not propagate inner errors.
 *
 * HTTP mapping: 401 (Unauthorized).
 */
export class PdfAuthenticationError extends Schema.TaggedError<PdfAuthenticationError>()("PdfAuthenticationError", {
  message: Schema.NonEmptyTrimmedString,
}) {}

/**
 * Raised when the page description fetch from `apps/api` fails — network
 * error, non-2xx response, or unexpected payload shape (emitted by
 * `services/pdf-export/pdf-export.service.ts` at lines 85 and 98).
 *
 * Payload: `{ message: string, cause?: unknown }`. The optional `cause` field
 * preserves the original axios/Effect error for diagnostic logging.
 *
 * HTTP mapping: 404 when `message.includes("not found")`, otherwise 502 (Bad
 * Gateway) — see the controller `mapErrorToHttpResponse` switch.
 */
export class PdfContentFetchError extends Schema.TaggedError<PdfContentFetchError>()("PdfContentFetchError", {
  message: Schema.NonEmptyTrimmedString,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Raised when the mention metadata fetch (user lookups for `@mention`
 * rendering in the PDF) fails.
 *
 * Payload: `{ message: string, source: "user-mentions", cause?: unknown }`.
 * The `source` field is a fixed literal — present for discriminated-union
 * narrowing should additional metadata sources be added later.
 *
 * HTTP mapping: 502 (Bad Gateway).
 */
export class PdfMetadataFetchError extends Schema.TaggedError<PdfMetadataFetchError>()("PdfMetadataFetchError", {
  message: Schema.NonEmptyTrimmedString,
  source: Schema.Literal("user-mentions"),
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Raised when `sharp`-based image conversion fails for a specific asset —
 * download, decode, or resize errors (emitted by
 * `services/pdf-export/pdf-export.service.ts` at lines 187, 196, 206, 222).
 *
 * Payload: `{ message: string, assetId: string, cause?: unknown }`. The
 * `assetId` field identifies which embedded image triggered the failure so
 * the log/response can pinpoint the problematic asset.
 *
 * HTTP mapping: 502 (Bad Gateway).
 */
export class PdfImageProcessingError extends Schema.TaggedError<PdfImageProcessingError>()("PdfImageProcessingError", {
  message: Schema.NonEmptyTrimmedString,
  assetId: Schema.NonEmptyTrimmedString,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Raised when React-PDF rendering of the assembled document fails — template
 * error, malformed node tree, or `@react-pdf/renderer` crash (emitted by
 * `services/pdf-export/pdf-export.service.ts` at line 286).
 *
 * Payload: `{ message: string, cause?: unknown }`.
 *
 * HTTP mapping: 500 (Internal Server Error).
 */
export class PdfGenerationError extends Schema.TaggedError<PdfGenerationError>()("PdfGenerationError", {
  message: Schema.NonEmptyTrimmedString,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Raised when an `Effect.timeout(...)` fires for any step in the pipeline —
 * content fetch, image processing, or PDF generation. Emitted by
 * `services/pdf-export/effect-utils.ts` at line 21 (via `Effect.timeoutFail`)
 * and surfaced through the retry telemetry at line 30.
 *
 * Payload: `{ message: string, operation: string }`. No `cause` — timeouts
 * originate from Effect itself, not a wrapped error. The `operation` field
 * identifies which step exceeded its timeout so logs and error messages can
 * localize the failure.
 *
 * HTTP mapping: 504 (Gateway Timeout).
 */
export class PdfTimeoutError extends Schema.TaggedError<PdfTimeoutError>()("PdfTimeoutError", {
  message: Schema.NonEmptyTrimmedString,
  operation: Schema.NonEmptyTrimmedString,
}) {}

/**
 * Discriminated union of every tagged error the PDF export pipeline can
 * raise. Used as the error channel type in `Effect.Effect<..., PdfExportError,
 * ...>` signatures throughout `apps/live/src/services/pdf-export/`.
 *
 * Each constituent error carries a `_tag` field (auto-generated by
 * `Schema.TaggedError`) whose value matches the class name; that field is the
 * discriminant that `Effect.catchTag(...)` / `Effect.catchTags(...)` use for
 * typed error recovery.
 */
export type PdfExportError =
  | PdfValidationError
  | PdfAuthenticationError
  | PdfContentFetchError
  | PdfMetadataFetchError
  | PdfImageProcessingError
  | PdfGenerationError
  | PdfTimeoutError;
