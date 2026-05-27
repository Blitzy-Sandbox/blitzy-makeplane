/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request, Response } from "express";
import { Effect, Schema, Cause } from "effect";
import { Controller, Post } from "@plane/decorators";
import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
import { PdfExportRequestBody, PdfValidationError, PdfAuthenticationError } from "@/schema/pdf-export";
import { PdfExportService, exportToPdf } from "@/services/pdf-export";
import type { PdfExportInput } from "@/services/pdf-export";

/**
 * Server-side PDF export controller for Plane page documents.
 *
 * Mount path:
 *   - Internal: `/pdf-export` (via `@Controller("/pdf-export")`)
 *   - External: `/live/pdf-export` (composed with `env.LIVE_BASE_PATH`)
 *
 * Decorators consumed from `@plane/decorators`:
 *   - `@Controller("/pdf-export")` — mounts the class on the live-server router
 *   - `@Post("/")` — registers the POST handler at the controller root
 *
 * Auth requirement: cookie presence check inside the handler. The originating
 * cookie is forwarded to the `apps/api` calls made by the PDF pipeline, so
 * session validity is ultimately enforced upstream — this controller only
 * asserts that *some* cookie is present before doing work. A missing cookie
 * short-circuits to 401 via `PdfAuthenticationError`.
 *
 * Architecture: Effect-based (`effect` library) so the parse + service + error
 * mapping pipeline can be composed declaratively. The actual rendering is
 * delegated to `PdfExportService.Default` from `@/services/pdf-export`,
 * which handles content fetching from `apps/api`, image processing, and
 * pdfmake document generation. Tagged domain errors from the service are
 * translated to HTTP status codes by `mapErrorToHttpResponse`.
 */
@Controller("/pdf-export")
export class PdfExportController {
  /**
   * Parses and validates the request, returning a typed input object
   */
  private parseRequest(
    req: Request,
    requestId: string
  ): Effect.Effect<PdfExportInput, PdfValidationError | PdfAuthenticationError> {
    return Effect.gen(function* () {
      const cookie = req.headers.cookie || "";
      if (!cookie) {
        return yield* Effect.fail(
          new PdfAuthenticationError({
            message: "Authentication required",
          })
        );
      }

      const body = yield* Schema.decodeUnknown(PdfExportRequestBody)(req.body).pipe(
        Effect.mapError(
          (cause) =>
            new PdfValidationError({
              message: "Invalid request body",
              cause,
            })
        )
      );

      return {
        pageId: body.pageId,
        workspaceSlug: body.workspaceSlug,
        projectId: body.projectId,
        title: body.title,
        author: body.author,
        subject: body.subject,
        pageSize: body.pageSize,
        pageOrientation: body.pageOrientation,
        fileName: body.fileName,
        noAssets: body.noAssets,
        cookie,
        requestId,
      };
    });
  }

  /**
   * Maps domain errors to HTTP responses
   */
  private mapErrorToHttpResponse(error: unknown): { status: number; error: string } {
    if (error && typeof error === "object" && "_tag" in error) {
      const tag = (error as { _tag: string })._tag;
      const message = (error as { message?: string }).message || "Unknown error";

      switch (tag) {
        case "PdfValidationError":
          return { status: 400, error: message };
        case "PdfAuthenticationError":
          return { status: 401, error: message };
        case "PdfContentFetchError":
          return {
            status: message.includes("not found") ? 404 : 502,
            error: message,
          };
        case "PdfTimeoutError":
          return { status: 504, error: message };
        case "PdfGenerationError":
          return { status: 500, error: message };
        case "PdfMetadataFetchError":
        case "PdfImageProcessingError":
          return { status: 502, error: message };
        default:
          return { status: 500, error: message };
      }
    }
    return { status: 500, error: "Failed to generate PDF" };
  }

  /**
   * Generates a PDF export of a Plane page and streams it back to the caller.
   *
   * HTTP method: POST
   * Route: `/` (relative to controller mount — externally `/live/pdf-export`)
   *
   * Request body (validated by `Schema.decodeUnknown(PdfExportRequestBody)`):
   *   - `pageId` (string, required, non-empty trimmed)
   *   - `workspaceSlug` (string, required, non-empty trimmed)
   *   - `projectId` (string, optional)
   *   - `title`, `author`, `subject`, `fileName` (string, optional) — PDF metadata + download filename
   *   - `pageSize` ("A4"|"A3"|"A2"|"LETTER"|"LEGAL"|"TABLOID", optional)
   *   - `pageOrientation` ("portrait"|"landscape", optional)
   *   - `noAssets` (boolean, optional) — when true, skips image fetching/embedding
   *
   * Request headers:
   *   - `Cookie` (required) — forwarded to `apps/api` to resolve the calling session
   *
   * Success response (200):
   *   - `Content-Type: application/pdf`
   *   - `Content-Disposition: attachment; filename="<sanitized>"; filename*=UTF-8''<encoded>`
   *     The unsanitized name is preserved in `filename*` (RFC 5987) so non-ASCII is
   *     downloadable; the sanitized name protects against header-injection.
   *   - `Content-Length: <bytes>`
   *   - Body: raw PDF buffer from `exportToPdf(input)`
   *
   * Error mapping (via `Effect.catchAll` → `mapErrorToHttpResponse`):
   *   - `PdfValidationError` → 400 (bad request body)
   *   - `PdfAuthenticationError` → 401 (missing cookie)
   *   - `PdfContentFetchError` → 404 if message includes `"not found"`, else 502
   *   - `PdfMetadataFetchError` → 502 (upstream `apps/api` failure)
   *   - `PdfImageProcessingError` → 502 (image fetch/transform failure)
   *   - `PdfTimeoutError` → 504 (operation exceeded budget)
   *   - `PdfGenerationError` → 500 (pdfmake/document assembly failure)
   *   - Unexpected defects → 500 via `Effect.catchAllDefect` with `AppError` logged
   *
   * Each request is assigned a `crypto.randomUUID()` `requestId` propagated
   * through the Effect pipeline and into log entries, so failures can be
   * correlated across the live server and downstream `apps/api` calls.
   */
  @Post("/")
  async exportToPdf(req: Request, res: Response) {
    const requestId = crypto.randomUUID();

    const effect = Effect.gen(this, function* () {
      // Parse request
      const input = yield* this.parseRequest(req, requestId);

      // Delegate to service
      return yield* exportToPdf(input);
    }).pipe(
      // Log errors before catching them
      Effect.tapError((error) => Effect.logError("PDF_EXPORT: Export failed", { requestId, error })),
      // Map all tagged errors to HTTP responses
      Effect.catchAll((error) => Effect.succeed(this.mapErrorToHttpResponse(error))),
      // Handle unexpected defects
      Effect.catchAllDefect((defect) => {
        const appError = new AppError(Cause.pretty(Cause.die(defect)), {
          context: { requestId, operation: "exportToPdf" },
        });
        logger.error("PDF_EXPORT: Unexpected failure", appError);
        return Effect.succeed({ status: 500, error: "Failed to generate PDF" });
      })
    );

    const result = await Effect.runPromise(Effect.provide(effect, PdfExportService.Default));

    // Check if result is an error response
    if ("error" in result && "status" in result) {
      return res.status(result.status).json({ message: result.error });
    }

    // Success - send PDF
    const { pdfBuffer, outputFileName } = result;

    // Sanitize filename for Content-Disposition header to prevent header injection
    const sanitizedFileName = outputFileName
      .replace(/["\\\r\n]/g, "") // Remove quotes, backslashes, and CRLF
      .replace(/[^\x20-\x7E]/g, "_"); // Replace non-ASCII with underscore

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizedFileName}"; filename*=UTF-8''${encodeURIComponent(outputFileName)}`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  }
}
