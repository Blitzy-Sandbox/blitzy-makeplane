/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * PDF export pipeline for the apps/live real-time collaboration server.
 *
 * Exports {@link PdfExportService} (an Effect-TS service) and {@link exportToPdf}
 * (the orchestration entry point). Together they implement the synchronous HTTP
 * PDF export pipeline consumed by `apps/live/src/controllers/pdf-export.controller.ts`.
 *
 * Architectural note: PDF export is a synchronous HTTP request/response — NOT a
 * Celery-style background task. Plane's overall architecture queues most heavy work
 * via Celery on RabbitMQ (with Redis used for caching/sessions only), so readers
 * familiar with that pattern must NOT assume PDF export is offloaded to a queue.
 * The Effect library is scoped to `apps/live/src/services/pdf-export/` and the
 * `pdf-export` controller; its presence here reflects the per-step
 * timeout/retry/recovery semantics that would be cumbersome to express with raw
 * Promises.
 *
 * Pipeline stages (executed in order by {@link exportToPdf}):
 *   1. Page service resolution — `getPageService(documentType, context)` from
 *      `@/services/page/handler` returns a `ProjectPageService` instance scoped to
 *      the request's `workspaceSlug`, `projectId`, and session cookie.
 *   2. Content fetch — `pageService.fetchDescriptionBinary(pageId)` retrieves the
 *      Yjs binary state from apps/api; `getAllDocumentFormatsFromDocumentEditorBinaryData`
 *      from `@plane/editor/lib` decodes it into a TipTap JSON document + extracted
 *      title HTML.
 *   3. Image asset ID extraction — recursively walks the TipTap document collecting
 *      `imageComponent` / `image` node `attrs.src` values that look like asset UUIDs
 *      (i.e., not URLs and not data URIs).
 *   4. User mention fetch — `pageService.fetchUserMentions(pageId)` retrieves user
 *      mention metadata from apps/api (optional — recovers with `[]` on failure).
 *   5. Image processing (skipped when `noAssets` is true) — per-asset pipeline run
 *      with max concurrency `IMAGE_CONCURRENCY` (4): `resolveImageAssetUrl` →
 *      `fetch` → `sharp` rotate/flatten/resize/jpeg → base64 data URL.
 *   6. PDF render — `renderPlaneDocToPdfBuffer` from `@/lib/pdf` produces a
 *      React-PDF `Buffer` from the TipTap JSON + aggregated metadata + render options.
 *
 * Runtime budgets (constants declared below in this module):
 *   - `IMAGE_CONCURRENCY = 4` — max parallel image processings.
 *   - `IMAGE_TIMEOUT_MS = 8000` — per-image processing budget (with 1 retry).
 *   - `CONTENT_FETCH_TIMEOUT_MS = 7000` — page content fetch budget (with 3 retries).
 *   - `PDF_RENDER_TIMEOUT_MS = 15000` — final PDF render budget (no retries; rendering
 *     is deterministic so retrying is wasted).
 *   - `IMAGE_MAX_DIMENSION = 1200` — `sharp` `resize(1200, 1200, { fit: "inside",
 *     withoutEnlargement: true })` cap.
 *
 * Document type: currently hardcoded to `"project_page"` by
 * `PdfExportService.getDocumentType`; future expansion would inspect the input and
 * route to additional types (e.g., `"workspace_page"`).
 *
 * Error taxonomy (from `@/schema/pdf-export`): `PdfContentFetchError`,
 * `PdfGenerationError`, `PdfImageProcessingError`, `PdfTimeoutError`.
 *
 * Document lifecycle context: the full `connect → edit → persist → disconnect`
 * Yjs collaboration lifecycle is owned by `apps/live/src/extensions/database.ts`
 * (WebSocket-based). PDF export is an out-of-band READ path that fetches data
 * previously persisted to apps/api by that WebSocket pipeline — it is NOT itself
 * a real-time editing path.
 *
 * Consumer: `apps/live/src/controllers/pdf-export.controller.ts` invokes
 * `exportToPdf(input)` from this module and provides `PdfExportService.Default`
 * to the Effect runtime via `Effect.provide`.
 */

import { Effect } from "effect";
import sharp from "sharp";
import { getAllDocumentFormatsFromDocumentEditorBinaryData } from "@plane/editor/lib";
import type { PDFExportMetadata, TipTapDocument } from "@/lib/pdf";
import { renderPlaneDocToPdfBuffer } from "@/lib/pdf";
import { getPageService } from "@/services/page/handler";
import type { TDocumentTypes } from "@/types";
import {
  PdfContentFetchError,
  PdfGenerationError,
  PdfImageProcessingError,
  PdfTimeoutError,
} from "@/schema/pdf-export";
import { withTimeoutAndRetry, recoverWithDefault, tryAsync } from "./effect-utils";
import type { PdfExportInput, PdfExportResult, PageContent, MetadataResult } from "./types";

const IMAGE_CONCURRENCY = 4;
const IMAGE_TIMEOUT_MS = 8000;
const CONTENT_FETCH_TIMEOUT_MS = 7000;
const PDF_RENDER_TIMEOUT_MS = 15000;
const IMAGE_MAX_DIMENSION = 1200;

/**
 * Defense-in-depth scheme allowlist for {@link isAllowedImageUrl}.
 *
 * Only `http:` and `https:` URLs are valid sources for image assets used by the
 * PDF exporter. The list intentionally excludes `data:`, `file:`, `blob:`,
 * `ftp:`, `javascript:`, and any other scheme so that a misconfigured (or
 * malicious upstream) apps/api response cannot trick the live server into
 * reading local files, executing JS in unexpected contexts, or following
 * arbitrary protocols.
 */
const ALLOWED_IMAGE_URL_SCHEMES = new Set(["http:", "https:"]);

/**
 * Defense-in-depth validation for image URLs returned by apps/api asset
 * resolution before {@link fetch} is called.
 *
 * SSRF threat model: the URLs reaching this guard come from
 * `pageService.resolveImageAssetUrl`, which captures the `Location` header from
 * apps/api's 302 redirect for `/api/assets/v2/.../<assetId>/`. Apps/api is the
 * source of truth for which storage backend (MinIO/S3/R2/GCS) hosts the asset
 * and emits a presigned URL accordingly. This guard does NOT re-implement that
 * trust decision; instead it provides a minimal scheme allowlist so that a
 * compromised or misconfigured apps/api response cannot expand the attack
 * surface beyond plain HTTP fetches (e.g., `file:///etc/passwd`, `data:` URLs
 * carrying executable payloads, etc.).
 *
 * Host-level allowlisting is intentionally NOT performed here because the set
 * of legitimate storage hosts is operator-configurable (every deployment may
 * use a different bucket name or storage backend), and the apps/live service
 * does not have access to apps/api's storage configuration. Operators that
 * require stricter host enforcement should run apps/live behind an egress
 * policy that restricts outbound traffic to known storage CIDRs.
 *
 * Behavior:
 *   - Invalid URL → `false`.
 *   - Scheme not in {@link ALLOWED_IMAGE_URL_SCHEMES} → `false`.
 *   - Otherwise → `true`. The downstream `fetch(url)` still respects Node's
 *     standard HTTP/HTTPS error handling for network-level failures.
 *
 * @param rawUrl - The URL string returned by apps/api asset resolution.
 * @returns `true` iff the URL parses and has an http(s) scheme.
 */
const isAllowedImageUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_IMAGE_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
};

/**
 * Minimal structural shape used only inside this module for TipTap document
 * traversal (e.g., {@link PdfExportService.extractImageAssetIds}); only `type`,
 * `attrs`, and `content` are read locally.
 *
 * Kept local rather than imported from `@/lib/pdf` (which exports a richer
 * `TipTapNode` discriminated union) so the traversal does not need to pull in
 * the wider node-type union that carries cases this code path never inspects.
 */
type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
};

/**
 * PDF Export Service
 *
 * Effect-TS service that exposes the six building-block methods of the PDF export
 * pipeline. Registered through the
 * `Effect.Service<PdfExportService>()("PdfExportService", { sync: () => ({ ... }) }) {}`
 * pattern: the `sync` factory returns the methods bag and Effect's runtime wires up
 * dependency injection automatically. The string tag `"PdfExportService"` is the
 * identity used by the Effect environment to resolve this service in
 * {@link exportToPdf} via `yield* PdfExportService` (the caller — the controller —
 * is responsible for `Effect.provide(effect, PdfExportService.Default)`).
 *
 * Methods exposed via the `sync` factory:
 *   1. `getDocumentType(_input)` — returns the document-type discriminator (currently
 *      always `"project_page"`).
 *   2. `extractImageAssetIds(doc)` — recursively walks a TipTap document collecting
 *      asset-UUID `src` values.
 *   3. `fetchPageContent(pageService, pageId, requestId)` — fetches + decodes the
 *      Yjs binary into a TipTap JSON document + title HTML.
 *   4. `fetchUserMentions(pageService, pageId, requestId)` — fetches user-mention
 *      metadata; gracefully falls back to `[]`.
 *   5. `processImages(pageService, workspaceSlug, projectId, assetIds, requestId)` —
 *      resolves + processes images concurrently with `sharp`.
 *   6. `renderPdf(contentJSON, metadata, options, requestId)` — final PDF buffer
 *      rendering via `@/lib/pdf`.
 *
 * Why an Effect.Service (not a plain class): the pipeline composes typed errors
 * (`PdfContentFetchError`, `PdfGenerationError`, etc.) and applies per-step
 * timeout/retry/recovery via `withTimeoutAndRetry` / `recoverWithDefault` from
 * `./effect-utils`. Effect's environment supplies structured dependency injection
 * and typed error channels that would be cumbersome to express with raw Promises.
 */
export class PdfExportService extends Effect.Service<PdfExportService>()("PdfExportService", {
  sync: () => ({
    /**
     * Determines document type
     *
     * Returns the document-type discriminator used by `getPageService` (from
     * `@/services/page/handler`) to route to the correct page service implementation.
     * Currently always returns `"project_page"` — the only document type supported by
     * PDF export today.
     *
     * @param _input - Intentionally unused (prefixed with `_` per TypeScript
     *   convention); reserved for future expansion when additional document types
     *   (e.g., `"workspace_page"`) are supported.
     * @returns Always `"project_page"`.
     */
    getDocumentType: (_input: PdfExportInput): TDocumentTypes => {
      return "project_page";
    },

    /**
     * Extracts image asset IDs from document content
     *
     * Recursively walks the TipTap document tree collecting `attrs.src` values from
     * `imageComponent` / `image` nodes that look like asset UUIDs (i.e., not URLs and
     * not data URIs). Drives the downstream image-processing stage in
     * {@link exportToPdf}.
     *
     * Filter criteria (a node's src is collected iff ALL hold):
     *   - `node.type === "imageComponent" || node.type === "image"`.
     *   - `node.attrs?.src` is present and truthy.
     *   - `src` does NOT start with `"http"` — excludes already-resolved URLs that
     *     do not need re-fetching from apps/api.
     *   - `src` does NOT start with `"data:"` — excludes inline data URIs that are
     *     already embedded in the document.
     *
     * Traversal is depth-first via an inner `traverse(node)` helper that recurses
     * into each `node.content` child. The returned list is deduplicated through
     * `new Set(...)` because a document may reference the same asset multiple times
     * (e.g., a header logo) and downstream {@link processImages} should fetch each
     * asset exactly once.
     *
     * @param doc - Root node of the TipTap document (the module-local
     *   {@link TipTapNode} structural type).
     * @returns Deduplicated list of asset UUIDs.
     */
    extractImageAssetIds: (doc: TipTapNode): string[] => {
      const assetIds: string[] = [];

      const traverse = (node: TipTapNode) => {
        if ((node.type === "imageComponent" || node.type === "image") && node.attrs?.src) {
          const src = node.attrs.src as string;
          if (src && !src.startsWith("http") && !src.startsWith("data:")) {
            assetIds.push(src);
          }
        }
        if (node.content) {
          for (const child of node.content) {
            traverse(child);
          }
        }
      };

      traverse(doc);
      return [...new Set(assetIds)];
    },

    /**
     * Fetches page content (description binary) and parses it
     *
     * Fetches the Yjs binary description from apps/api via
     * `pageService.fetchDescriptionBinary(pageId)` and decodes it into a TipTap JSON
     * document + extracted title HTML using
     * `getAllDocumentFormatsFromDocumentEditorBinaryData(binaryData, true)` from
     * `@plane/editor/lib` (the second argument requests title extraction).
     *
     * Read-path origin: the binary fetched here was originally persisted to apps/api
     * by `apps/live/src/extensions/database.ts` during a prior
     * connect → edit → persist Yjs lifecycle. PDF export is therefore a READ path
     * against already-persisted data and does NOT itself open a WebSocket
     * collaboration session.
     *
     * Resilience: wrapped in `withTimeoutAndRetry("fetch page content", { timeoutMs:
     * CONTENT_FETCH_TIMEOUT_MS = 7000, maxRetries: 3 })` — bounds the network call to
     * 7 seconds with up to 3 exponential-backoff retries.
     *
     * Failure paths:
     *   - Network/HTTP failure →
     *     `PdfContentFetchError({ message: "Failed to fetch page content", cause })`.
     *   - Empty binary (page content not found) →
     *     `PdfContentFetchError({ message: "Page content not found" })`.
     *   - Timeout exhaustion → `PdfTimeoutError` from `withTimeoutAndRetry`.
     *
     * @param pageService - `ProjectPageService` instance returned by `getPageService`
     *   for `"project_page"` documents.
     * @param pageId - The page UUID to fetch.
     * @param requestId - Request correlation ID for structured log entries.
     * @returns Effect yielding the parsed `PageContent`
     *   (`{ contentJSON, titleHTML, descriptionBinary }`) or failing with one of the
     *   two typed errors above.
     */
    fetchPageContent: (
      pageService: ReturnType<typeof getPageService>,
      pageId: string,
      requestId: string
    ): Effect.Effect<PageContent, PdfContentFetchError | PdfTimeoutError> =>
      Effect.gen(function* () {
        yield* Effect.logDebug("PDF_EXPORT: Fetching page content", { requestId, pageId });

        const descriptionBinary = yield* tryAsync(
          () => pageService.fetchDescriptionBinary(pageId),
          (cause) =>
            new PdfContentFetchError({
              message: "Failed to fetch page content",
              cause,
            })
        ).pipe(
          withTimeoutAndRetry("fetch page content", {
            timeoutMs: CONTENT_FETCH_TIMEOUT_MS,
            maxRetries: 3,
          })
        );

        if (!descriptionBinary) {
          return yield* Effect.fail(
            new PdfContentFetchError({
              message: "Page content not found",
            })
          );
        }

        const binaryData = new Uint8Array(descriptionBinary);
        const { contentJSON, titleHTML } = getAllDocumentFormatsFromDocumentEditorBinaryData(binaryData, true);

        return {
          contentJSON: contentJSON as TipTapDocument,
          titleHTML: titleHTML || null,
          descriptionBinary,
        };
      }),

    /**
     * Fetches user mentions for the page
     *
     * Fetches user-mention metadata for `@user` references in the document and maps
     * the result into the `PDFUserMention` shape (`{ id, display_name, avatar_url }`).
     * Mentions are non-critical metadata — failure NEVER aborts the export; the
     * document still renders without them.
     *
     * Resilience: `pageService.fetchUserMentions?.(pageId)` is optional-chained
     * because `PageCoreService` declares the method but subclasses may override or
     * omit it; missing implementations short-circuit to `[]`. The wrapper
     * `recoverWithDefault([] as Array<...>)` then absorbs any remaining error so the
     * effect's error channel collapses to `never`.
     *
     * @param pageService - `ProjectPageService` instance.
     * @param pageId - The page UUID.
     * @param requestId - Request correlation ID.
     * @returns Effect yielding a `MetadataResult` with `userMentions` populated; the
     *   error channel is `never`.
     */
    fetchUserMentions: (
      pageService: ReturnType<typeof getPageService>,
      pageId: string,
      requestId: string
    ): Effect.Effect<MetadataResult> =>
      Effect.gen(function* () {
        yield* Effect.logDebug("PDF_EXPORT: Fetching user mentions", { requestId });

        const userMentionsRaw = yield* tryAsync(
          async () => {
            if (pageService.fetchUserMentions) {
              return await pageService.fetchUserMentions(pageId);
            }
            return [];
          },
          () => []
        ).pipe(recoverWithDefault([] as Array<{ id: string; display_name: string; avatar_url?: string }>));

        return {
          userMentions: userMentionsRaw.map((u) => ({
            id: u.id,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
          })),
        };
      }),

    /**
     * Resolves and processes images for PDF embedding
     *
     * Resolves image asset URLs from apps/api and processes each into a base64 data
     * URL suitable for embedding into the React-PDF document. Two-phase pipeline:
     *
     *   1. Resolution phase (serial): for each asset ID, calls
     *      `pageService.resolveImageAssetUrl?.(workspaceSlug, assetId, projectId)`.
     *      Run serially (not in parallel) because URL resolution shares the apps/api
     *      session and benefits from sequential ordering. Failures collapse to an
     *      empty `Map` via `recoverWithDefault(new Map())`.
     *   2. Processing phase (parallel, max `IMAGE_CONCURRENCY = 4`): per resolved
     *      URL, `fetch(url)` → `arrayBuffer()` →
     *      `sharp(...).rotate().flatten({ background: { r: 255, g: 255, b: 255 } })
     *      .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, { fit: "inside",
     *      withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()` → base64
     *      data URL. `rotate()` respects EXIF orientation; `flatten()` paints
     *      transparent PNGs against white so React-PDF does not render garbled
     *      backgrounds; `resize()` caps dimension to control PDF size and render
     *      time; `jpeg({ quality: 85 })` is a balanced size/quality tradeoff.
     *
     * Per-image resilience: each image effect is wrapped in
     * ``withTimeoutAndRetry(`process image ${assetId}`, { timeoutMs: IMAGE_TIMEOUT_MS
     * = 8000, maxRetries: 1 })`` and an `Effect.tapError` log warning. Final failures
     * collapse to `null` via `Effect.catchAll` and are filtered out before the
     * returned map is constructed — a partial image set is acceptable. If
     * `assetIds.length === 0`, returns `{}` immediately and skips all work.
     *
     * Concurrency rationale: 4 balances throughput against memory pressure —
     * `sharp` holds the full decoded image in memory during transformation, so
     * higher concurrency would risk OOM in the long-lived live server process.
     *
     * @param pageService - `ProjectPageService` instance.
     * @param workspaceSlug - Workspace identifier.
     * @param projectId - Project identifier (optional for non-project pages).
     * @param assetIds - Deduplicated asset UUIDs from {@link extractImageAssetIds}.
     * @param requestId - Request correlation ID.
     * @returns Effect yielding a map of `assetId → "data:image/jpeg;base64,..."`;
     *   the error channel is `never` because individual image failures are swallowed.
     */
    processImages: (
      pageService: ReturnType<typeof getPageService>,
      workspaceSlug: string,
      projectId: string | undefined,
      assetIds: string[],
      requestId: string
    ): Effect.Effect<Record<string, string>> =>
      Effect.gen(function* () {
        if (assetIds.length === 0) {
          return {};
        }

        yield* Effect.logDebug("PDF_EXPORT: Processing images", {
          requestId,
          count: assetIds.length,
        });

        // Resolve URLs first
        const resolvedUrlMap = yield* tryAsync(
          async () => {
            const urlMap = new Map<string, string>();
            for (const assetId of assetIds) {
              const url = await pageService.resolveImageAssetUrl?.(workspaceSlug, assetId, projectId);
              if (url) urlMap.set(assetId, url);
            }
            return urlMap;
          },
          () => new Map<string, string>()
        ).pipe(recoverWithDefault(new Map<string, string>()));

        if (resolvedUrlMap.size === 0) {
          return {};
        }

        // Process each image
        const processSingleImage = ([assetId, url]: [string, string]) =>
          Effect.gen(function* () {
            // Defense-in-depth: reject any URL that isn't an http(s) string before
            // fetch. The URL is supplied by apps/api's asset resolution (the trust
            // boundary), but a misconfigured or compromised response must not be
            // able to broaden the attack surface beyond plain HTTP/HTTPS. See
            // `isAllowedImageUrl` above for the threat model and host-allowlisting
            // rationale.
            if (!isAllowedImageUrl(url)) {
              return yield* Effect.fail(
                new PdfImageProcessingError({
                  message: "Image URL rejected by scheme allowlist",
                  assetId,
                })
              );
            }

            const response = yield* tryAsync(
              () => fetch(url),
              (cause) =>
                new PdfImageProcessingError({
                  message: "Failed to fetch image",
                  assetId,
                  cause,
                })
            );

            if (!response.ok) {
              return yield* Effect.fail(
                new PdfImageProcessingError({
                  message: `Image fetch returned ${response.status}`,
                  assetId,
                })
              );
            }

            const arrayBuffer = yield* tryAsync(
              () => response.arrayBuffer(),
              (cause) =>
                new PdfImageProcessingError({
                  message: "Failed to read image body",
                  assetId,
                  cause,
                })
            );

            const processedBuffer = yield* tryAsync(
              () =>
                sharp(Buffer.from(arrayBuffer))
                  .rotate()
                  .flatten({ background: { r: 255, g: 255, b: 255 } })
                  .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
                  .jpeg({ quality: 85 })
                  .toBuffer(),
              (cause) =>
                new PdfImageProcessingError({
                  message: "Failed to process image",
                  assetId,
                  cause,
                })
            );

            const base64 = processedBuffer.toString("base64");
            return [assetId, `data:image/jpeg;base64,${base64}`] as const;
          }).pipe(
            withTimeoutAndRetry(`process image ${assetId}`, {
              timeoutMs: IMAGE_TIMEOUT_MS,
              maxRetries: 1,
            }),
            Effect.tapError((error) =>
              Effect.logWarning("PDF_EXPORT: Image processing failed", {
                requestId,
                assetId,
                error,
              })
            ),
            Effect.catchAll(() => Effect.succeed(null as readonly [string, string] | null))
          );

        const entries = Array.from(resolvedUrlMap.entries());
        const pairs = yield* Effect.forEach(entries, processSingleImage, {
          concurrency: IMAGE_CONCURRENCY,
        });

        const filtered = pairs.filter((p): p is readonly [string, string] => p !== null);
        return Object.fromEntries(filtered);
      }),

    /**
     * Renders document to PDF buffer
     *
     * Renders the final PDF buffer from the TipTap content JSON + aggregated metadata
     * + render options via `renderPlaneDocToPdfBuffer` from `@/lib/pdf` (a React-PDF
     * pipeline that walks the TipTap tree with the node and mark renderer registries).
     *
     * Resilience: wrapped in `withTimeoutAndRetry("render PDF", { timeoutMs:
     * PDF_RENDER_TIMEOUT_MS = 15000, maxRetries: 0 })` — NO retries because PDF
     * rendering is deterministic (same input → same output) and retrying on failure
     * would only waste the time budget. The 15-second timeout accommodates large
     * documents.
     *
     * Failure paths:
     *   - Render error from `renderPlaneDocToPdfBuffer` →
     *     `PdfGenerationError({ message: "Failed to render PDF", cause })`.
     *   - Timeout exhaustion → `PdfTimeoutError`.
     *
     * @param contentJSON - The parsed TipTap document tree.
     * @param metadata - Aggregated metadata (user mentions, resolved image URLs).
     * @param options - Render-time configuration: `title`, `author`, `subject`,
     *   `pageSize`, `pageOrientation`, `noAssets`.
     * @param requestId - Request correlation ID.
     * @returns Effect yielding the rendered PDF `Buffer` or failing with
     *   `PdfGenerationError` / `PdfTimeoutError`.
     */
    renderPdf: (
      contentJSON: TipTapDocument,
      metadata: PDFExportMetadata,
      options: {
        title?: string;
        author?: string;
        subject?: string;
        pageSize?: "A4" | "A3" | "A2" | "LETTER" | "LEGAL" | "TABLOID";
        pageOrientation?: "portrait" | "landscape";
        noAssets?: boolean;
      },
      requestId: string
    ): Effect.Effect<Buffer, PdfGenerationError | PdfTimeoutError> =>
      Effect.gen(function* () {
        yield* Effect.logDebug("PDF_EXPORT: Rendering PDF", { requestId });

        const pdfBuffer = yield* tryAsync(
          () =>
            renderPlaneDocToPdfBuffer(contentJSON, {
              title: options.title,
              author: options.author,
              subject: options.subject,
              pageSize: options.pageSize,
              pageOrientation: options.pageOrientation,
              metadata,
              noAssets: options.noAssets,
            }),
          (cause) =>
            new PdfGenerationError({
              message: "Failed to render PDF",
              cause,
            })
        ).pipe(withTimeoutAndRetry("render PDF", { timeoutMs: PDF_RENDER_TIMEOUT_MS, maxRetries: 0 }));

        yield* Effect.logInfo("PDF_EXPORT: PDF rendered successfully", {
          requestId,
          size: pdfBuffer.length,
        });

        return pdfBuffer;
      }),
  }),
}) {}

/**
 * Main export pipeline - orchestrates the entire PDF export process
 * Separate function to avoid circular dependency in service definition
 *
 * Top-level orchestration entry point for PDF export. Acquires `PdfExportService`
 * from the Effect environment (`const service = yield* PdfExportService;`) and runs
 * the pipeline stages in sequence; the caller (the `pdf-export` controller) is
 * responsible for providing `PdfExportService.Default` to the Effect runtime via
 * `Effect.provide`.
 *
 * Stages executed:
 *   1. `service.getDocumentType(input)` — determine document type discriminator.
 *   2. `getPageService(documentType, context)` — construct page service. The context
 *      carries `workspaceSlug`, `projectId`, the session `cookie`, the document
 *      type, and a hardcoded empty `userId: ""`. The empty userId is acceptable
 *      because `ProjectPageService` only reads `workspaceSlug`, `projectId`, and
 *      `cookie` from its context — PDF export runs in a stateless HTTP handler
 *      where the user is authenticated via the session cookie (Plane uses session
 *      cookies, not JWTs).
 *   3. `service.fetchPageContent(...)` — fetch and decode the Yjs binary.
 *   4. `service.extractImageAssetIds(...)` — collect referenced asset UUIDs.
 *   5. `service.fetchUserMentions(...)` — fetch user-mention metadata.
 *   6. `service.processImages(...)` — conditionally process images, skipped when
 *      `noAssets` is true OR the document references no images.
 *   7. `service.renderPdf(...)` — produce the final PDF `Buffer`. The render title
 *      defaults to `input.title || content.titleHTML || undefined`.
 *
 * The output file name defaults to `` `page-${pageId}.pdf` `` when `input.fileName`
 * is not supplied.
 *
 * Observability:
 *   - Entry:
 *     `Effect.logInfo("PDF_EXPORT: Starting export", { requestId, pageId, workspaceSlug })`.
 *   - Metadata prepared:
 *     `Effect.logDebug("PDF_EXPORT: Metadata prepared", { requestId, userMentions, resolvedImages })`.
 *   - Completion:
 *     `Effect.logInfo("PDF_EXPORT: Export complete", { requestId, pageId, size })`.
 *
 * @param input - See `./types.ts` for the full {@link PdfExportInput} shape
 *   (`pageId`, `workspaceSlug`, `projectId`, `cookie`, `requestId` + optional
 *   `title`, `author`, `subject`, `pageSize`, `pageOrientation`, `fileName`,
 *   `noAssets`).
 * @returns Effect that requires `PdfExportService` in its environment; success
 *   yields `{ pdfBuffer, outputFileName, pageId }`. Failure surfaces one of
 *   `PdfContentFetchError`, `PdfGenerationError`, or `PdfTimeoutError`.
 */
export const exportToPdf = (
  input: PdfExportInput
): Effect.Effect<PdfExportResult, PdfContentFetchError | PdfGenerationError | PdfTimeoutError, PdfExportService> =>
  Effect.gen(function* () {
    const service = yield* PdfExportService;
    const { requestId, pageId, workspaceSlug, projectId, noAssets } = input;

    yield* Effect.logInfo("PDF_EXPORT: Starting export", { requestId, pageId, workspaceSlug });

    // Create page service
    const documentType = service.getDocumentType(input);
    const pageService = getPageService(documentType, {
      workspaceSlug,
      projectId: projectId || null,
      cookie: input.cookie,
      documentType,
      userId: "",
    });

    // Fetch content
    const content = yield* service.fetchPageContent(pageService, pageId, requestId);

    // Extract image asset IDs
    const imageAssetIds = service.extractImageAssetIds(content.contentJSON as TipTapNode);

    // Fetch user mentions
    let metadata = yield* service.fetchUserMentions(pageService, pageId, requestId);

    // Process images if needed
    if (!noAssets && imageAssetIds.length > 0) {
      const resolvedImages = yield* service.processImages(
        pageService,
        workspaceSlug,
        projectId,
        imageAssetIds,
        requestId
      );
      metadata = { ...metadata, resolvedImageUrls: resolvedImages };
    }

    yield* Effect.logDebug("PDF_EXPORT: Metadata prepared", {
      requestId,
      userMentions: metadata.userMentions?.length ?? 0,
      resolvedImages: Object.keys(metadata.resolvedImageUrls ?? {}).length,
    });

    // Render PDF
    const documentTitle = input.title || content.titleHTML || undefined;
    const pdfBuffer = yield* service.renderPdf(
      content.contentJSON,
      metadata,
      {
        title: documentTitle,
        author: input.author,
        subject: input.subject,
        pageSize: input.pageSize,
        pageOrientation: input.pageOrientation,
        noAssets,
      },
      requestId
    );

    yield* Effect.logInfo("PDF_EXPORT: Export complete", {
      requestId,
      pageId,
      size: pdfBuffer.length,
    });

    return {
      pdfBuffer,
      outputFileName: input.fileName || `page-${pageId}.pdf`,
      pageId,
    };
  });
