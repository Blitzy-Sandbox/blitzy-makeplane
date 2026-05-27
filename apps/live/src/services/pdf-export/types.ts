/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared type contracts for the PDF export feature in `apps/live`.
 *
 * Exports four `readonly` interfaces (immutable DTOs flowing through the
 * Effect-TS pipeline in `./pdf-export.service`):
 *
 *  1. {@link PdfExportInput} — request shape consumed by `exportToPdf`;
 *     populated by `controllers/pdf-export.controller.ts` from the HTTP
 *     request (body validated against `PdfExportRequestBody` from
 *     `@/schema/pdf-export`, plus the session cookie extracted from
 *     `req.headers.cookie` and a generated request ID).
 *  2. {@link PdfExportResult} — response shape returned by `exportToPdf` and
 *     written to the HTTP response body by the controller.
 *  3. {@link PageContent} — intermediate shape produced by `fetchPageContent`
 *     after decoding the Yjs binary description; consumed downstream by
 *     `extractImageAssetIds` and `renderPdf` in the service pipeline.
 *  4. {@link MetadataResult} — intermediate shape collecting user mentions
 *     (and optionally resolved image URLs) passed to `renderPdf`.
 *
 * External dependencies:
 *   - `TipTapDocument` — parsed TipTap node tree (the editable content).
 *   - `PDFUserMention` — user-mention metadata shape.
 *
 * Both come from `@/lib/pdf`, the React-PDF rendering layer.
 *
 * Re-exported via `./index.ts` (`export * from "./types"`), so consumers
 * import these types from the `@/services/pdf-export` barrel.
 *
 * All fields on every interface are marked `readonly` to enforce immutability
 * at the type level — these are DTOs and must not be mutated after
 * construction.
 *
 * Document lifecycle context (AAP Directive 4): this module participates in
 * the PDF export READ path against persisted data, NOT the real-time editing
 * path. The Yjs binary that backs `PageContent.descriptionBinary` is written
 * out-of-band by `apps/live/src/extensions/database.ts` during a prior
 * `connect → edit → persist` collaboration cycle; PDF export only reads it.
 */

import type { TipTapDocument, PDFUserMention } from "@/lib/pdf";

/**
 * Input contract for the PDF export pipeline.
 *
 * Constructed by `controllers/pdf-export.controller.ts` from the HTTP request
 * body (validated via the `PdfExportRequestBody` Schema from
 * `@/schema/pdf-export`) plus the session cookie (extracted from
 * `req.headers.cookie`) and a generated request ID. Consumed by `exportToPdf`
 * in `./pdf-export.service`.
 *
 * Required fields:
 *  - `pageId` — page UUID to export (the document whose Yjs binary will be
 *    decoded and rendered).
 *  - `workspaceSlug` — workspace identifier used for tenant scoping in API
 *    calls and asset URL resolution.
 *  - `cookie` — session cookie value forwarded to the `ProjectPageService`
 *    constructor as the session cookie. Plane uses **session cookies, NOT
 *    JWT**; this is the canonical Plane auth credential.
 *  - `requestId` — request correlation ID for structured log correlation
 *    across pipeline stages (NOT a tracing span ID or a security token).
 *
 * Optional fields:
 *  - `projectId` — required for project-scoped pages (currently the only
 *    supported `documentType`, `"project_page"`); used in URL building for
 *    `/api/workspaces/<slug>/projects/<id>/pages/<page>/`.
 *  - `title` — overrides the document's own decoded `titleHTML` in PDF
 *    metadata; if omitted, the title is extracted from the document binary.
 *  - `author` — passed through to React-PDF document metadata.
 *  - `subject` — passed through to React-PDF document metadata.
 *  - `pageSize` — paper size; defaults are resolved downstream in `@/lib/pdf`
 *    (typically A4).
 *  - `pageOrientation` — page orientation; default resolved downstream
 *    (typically portrait).
 *  - `fileName` — overrides the default `page-${pageId}.pdf` filename
 *    returned in `PdfExportResult.outputFileName`.
 *  - `noAssets` — when `true`, skips image resolution and processing entirely
 *    (faster export; images render as placeholders). Use for quick previews
 *    or when assets are unavailable.
 */
export interface PdfExportInput {
  readonly pageId: string;
  readonly workspaceSlug: string;
  readonly projectId?: string;
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly pageSize?: "A4" | "A3" | "A2" | "LETTER" | "LEGAL" | "TABLOID";
  readonly pageOrientation?: "portrait" | "landscape";
  readonly fileName?: string;
  readonly noAssets?: boolean;
  readonly cookie: string;
  readonly requestId: string;
}

/**
 * Response shape returned by `exportToPdf` on a successful pipeline run.
 *
 * Returned by `controllers/pdf-export.controller.ts` as the HTTP body, with
 * `Content-Type: application/pdf` and `Content-Disposition` set from
 * `outputFileName`.
 *
 * Fields:
 *  - `pdfBuffer` — the rendered PDF binary; written directly to the HTTP
 *    response body.
 *  - `outputFileName` — the final filename, computed as
 *    `` input.fileName || `page-${pageId}.pdf` `` in `exportToPdf`; used by
 *    the controller in the `Content-Disposition: attachment; filename=...`
 *    header.
 *  - `pageId` — echoed back from the input for caller correlation (downstream
 *    observability or response routing).
 */
export interface PdfExportResult {
  readonly pdfBuffer: Buffer;
  readonly outputFileName: string;
  readonly pageId: string;
}

/**
 * Intermediate shape returned by `fetchPageContent` in `./pdf-export.service`.
 *
 * Consumed downstream by `extractImageAssetIds` (reads `contentJSON`) and
 * `renderPdf` (reads `contentJSON` and uses `titleHTML` as a fallback document
 * title when `input.title` is not provided).
 *
 * Produced by decoding the Yjs binary description via
 * `getAllDocumentFormatsFromDocumentEditorBinaryData(binaryData, true)` from
 * `@plane/editor/lib`. The `true` flag requests title extraction.
 *
 * Fields:
 *  - `contentJSON` — the decoded TipTap document tree (the editable content);
 *    type imported from `@/lib/pdf`.
 *  - `titleHTML` — extracted title HTML from the document's first heading or
 *    title node. May be `null` if the page has no title node — in that case
 *    the renderer falls back to a generic document name.
 *  - `descriptionBinary` — the original Yjs binary state, preserved for
 *    debugging or future use (e.g., re-decoding with different options). The
 *    field is not currently consumed downstream but is kept on the shape for
 *    future extensibility.
 */
export interface PageContent {
  readonly contentJSON: TipTapDocument;
  readonly titleHTML: string | null;
  readonly descriptionBinary: Buffer;
}

/**
 * Metadata - includes user mentions.
 *
 * Aggregated metadata passed to the PDF renderer; collects user mentions
 * (from `apps/api`) and the resolved image URL map (from `processImages`).
 *
 * Construction:
 *  - Returned by `fetchUserMentions` in `./pdf-export.service` with only
 *    `userMentions` populated.
 *  - Extended in `exportToPdf` with `resolvedImageUrls` when image processing
 *    is enabled (`!input.noAssets` AND at least one image asset is found).
 *
 * Consumed by `renderPdf`, which forwards it to `renderPlaneDocToPdfBuffer`
 * from `@/lib/pdf`. The renderer uses mentions to resolve `@user` references
 * to display names + avatars, and uses the image URL map to embed images as
 * JPEG data URLs.
 *
 * Fields:
 *  - `userMentions` — mention metadata for `@user` references in the
 *    document; each `PDFUserMention` carries `{ id, display_name,
 *    avatar_url? }` (shape imported from `@/lib/pdf`). Empty array if the
 *    mention fetch failed (recovered via `recoverWithDefault([])` in
 *    `fetchUserMentions`).
 *  - `resolvedImageUrls` — optional map of asset UUID → base64 data URL
 *    (`"data:image/jpeg;base64,<…>"`). Only populated when `input.noAssets`
 *    is `false` AND images successfully resolved. Empty or missing →
 *    images render as placeholders in the PDF.
 */
export interface MetadataResult {
  readonly userMentions: PDFUserMention[];
  readonly resolvedImageUrls?: Record<string, string>;
}
