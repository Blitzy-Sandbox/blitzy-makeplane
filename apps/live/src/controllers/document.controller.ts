/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request, Response } from "express";
import { z } from "zod";
// helpers
import { Controller, Post } from "@plane/decorators";
import { convertHTMLDocumentToAllFormats } from "@plane/editor";
// logger
import { logger } from "@plane/logger";
import type { TConvertDocumentRequestBody } from "@/types";

// Define the schema with more robust validation
const convertDocumentSchema = z.object({
  description_html: z
    .string()
    .min(1, "HTML content cannot be empty")
    .refine((html) => html.trim().length > 0, "HTML content cannot be just whitespace")
    .refine((html) => html.includes("<") && html.includes(">"), "Content must be valid HTML"),
  variant: z.enum(["rich", "document"]),
});

/**
 * Server-side HTML-to-editor-format converter for Plane document content.
 *
 * Mount path:
 *   - Internal: `/convert-document` (via `@Controller("/convert-document")`)
 *   - External: `/live/convert-document` (composed with `env.LIVE_BASE_PATH`)
 *
 * Decorators consumed from `@plane/decorators`:
 *   - `@Controller("/convert-document")` — mounts the class on the live-server router
 *   - `@Post("/")` — registers the POST handler at the controller root
 *
 * Auth requirement: no controller- or method-level auth middleware is applied;
 * access control is the responsibility of upstream callers (typically
 * `apps/api`) and any infrastructure-level gating in front of `apps/live`.
 *
 * Delegates the actual conversion to `convertHTMLDocumentToAllFormats` from
 * `@plane/editor`, which encapsulates the TipTap/ProseMirror + Y.js encoding
 * pipeline so callers do not need to load editor extensions server-side.
 */
@Controller("/convert-document")
export class DocumentController {
  /**
   * Converts an HTML document payload into Plane's editor formats.
   *
   * HTTP method: POST
   * Route: `/` (relative to controller mount — externally `/live/convert-document`)
   *
   * Request body (validated by `convertDocumentSchema`):
   *   - `description_html` (string, required): non-empty, non-whitespace-only;
   *     must contain `<` and `>` (a loose "looks like HTML" check used to reject
   *     plain-text uploads before invoking the heavier conversion pipeline)
   *   - `variant` ("rich" | "document", required): editor variant the output
   *     should target, controlling which extension set is applied
   *
   * Response (200):
   *   - `description_json` — ProseMirror JSON representation
   *   - `description_binary` — Y.js binary update buffer for collaborative sync
   *
   * Error responses:
   *   - 400: Zod validation failure; body includes `{ message, context.validationErrors[] }`
   *     with `{ path, message }` per failed field — caller can map back to form fields.
   *   - 500: Any non-Zod exception; generic message to avoid leaking internals.
   *
   * Why the dual-format response: collaborative editing requires the binary
   * Y.js update to seed CRDT state, while non-collab consumers can read the
   * JSON; returning both avoids a second round trip when the caller intends
   * to persist a document that will later be edited collaboratively.
   */
  @Post("/")
  async convertDocument(req: Request, res: Response) {
    try {
      // Validate request body
      const validatedData = convertDocumentSchema.parse(req.body as TConvertDocumentRequestBody);
      const { description_html, variant } = validatedData;

      // Process document conversion
      const { description_json, description_binary } = convertHTMLDocumentToAllFormats({
        document_html: description_html,
        variant,
      });

      // Return successful response
      res.status(200).json({
        description_json,
        description_binary,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
        }));
        logger.error("DOCUMENT_CONTROLLER: Validation error", {
          validationErrors,
        });
        return res.status(400).json({
          message: `Validation error`,
          context: {
            validationErrors,
          },
        });
      } else {
        logger.error("DOCUMENT_CONTROLLER: Internal server error", error);
        return res.status(500).json({
          message: `Internal server error.`,
        });
      }
    }
  }
}
