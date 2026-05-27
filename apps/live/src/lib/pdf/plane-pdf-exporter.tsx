/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level entrypoint for the `apps/live` PDF export subsystem.
 *
 * Builds React-PDF `Document` and `Page` trees from a `TipTapDocument` (the
 * shape produced by the Plane TipTap editor / persisted by the live server)
 * and exposes async helpers that materialize either a Node `Buffer` (for HTTP
 * response streaming) or a `Blob` (for browser / Edge runtimes).
 *
 * Inter font registration happens once at module load: `createRequire` resolves
 * the `@fontsource/inter` package path under ESM (the package only ships CJS
 * metadata, so a `require` bridge is needed) and `Font.register` from
 * `@react-pdf/renderer` then loads the four weight/style variants used across
 * the stylesheet defined in `./styles`.
 *
 * Consumed by `apps/live/src/services/pdf-export/pdf-export.service.ts`, which
 * imports `renderPlaneDocToPdfBuffer` and pipes the resulting bytes through the
 * `PdfExportController` HTTP response.
 */

import { createRequire } from "module";
import path from "path";
import { Document, Font, Page, pdf, Text } from "@react-pdf/renderer";
import { createKeyGenerator, renderNode } from "./node-renderers";
import { pdfStyles } from "./styles";
import type { PDFExportOptions, TipTapDocument } from "./types";

// Use createRequire for ESM compatibility to resolve font file paths
const require = createRequire(import.meta.url);

// Resolve local font file paths from @fontsource/inter package
const interFontDir = path.dirname(require.resolve("@fontsource/inter/package.json"));

/** Registers the Inter font family at module load so all PDFs emitted by this
 *  module share consistent typography. Runs once per module evaluation. */
Font.register({
  family: "Inter",
  fonts: [
    {
      src: path.join(interFontDir, "files/inter-latin-400-normal.woff"),
      fontWeight: 400,
    },
    {
      src: path.join(interFontDir, "files/inter-latin-400-italic.woff"),
      fontWeight: 400,
      fontStyle: "italic",
    },
    {
      src: path.join(interFontDir, "files/inter-latin-600-normal.woff"),
      fontWeight: 600,
    },
    {
      src: path.join(interFontDir, "files/inter-latin-600-italic.woff"),
      fontWeight: 600,
      fontStyle: "italic",
    },
    {
      src: path.join(interFontDir, "files/inter-latin-700-normal.woff"),
      fontWeight: 700,
    },
    {
      src: path.join(interFontDir, "files/inter-latin-700-italic.woff"),
      fontWeight: 700,
      fontStyle: "italic",
    },
  ],
});

/**
 * Synchronously assembles a React-PDF `Document` tree from a TipTap document
 * and metadata. Returns the unrendered React element; callers must pass it to
 * `renderPlaneDocToPdfBuffer` or `renderPlaneDocToPdfBlob` to materialize PDF
 * bytes.
 *
 * @param doc - Parsed TipTap document (`{ type: "doc", content: [...] }`) to
 *              render.
 * @param options - Optional metadata (`title`, `author`, `subject`),
 *                  page settings (`pageSize`, `pageOrientation`), entity
 *                  resolution (`metadata` → user mentions, resolved image URLs),
 *                  and asset suppression (`noAssets`). `noAssets` is merged
 *                  into `metadata` before being threaded through node renderers
 *                  so image nodes can short-circuit when assets must be
 *                  excluded.
 */
export const createPdfDocument = (doc: TipTapDocument, options: PDFExportOptions = {}) => {
  const { title, author, subject, pageSize = "A4", pageOrientation = "portrait", metadata, noAssets } = options;

  // Merge noAssets into metadata for use in node renderers
  const mergedMetadata = { ...metadata, noAssets };

  const content = doc.content || [];
  const getKey = createKeyGenerator();
  const renderedContent = content.map((node, index) => renderNode(node, "doc", index, mergedMetadata, getKey));

  return (
    <Document title={title} author={author} subject={subject}>
      <Page size={pageSize} orientation={pageOrientation} style={pdfStyles.page}>
        {title && <Text style={pdfStyles.title}>{title}</Text>}
        {renderedContent}
      </Page>
    </Document>
  );
};

/**
 * Server-side renderer: builds the PDF document and returns a Node `Buffer`
 * containing the rendered PDF bytes. Used by
 * `apps/live/src/services/pdf-export/pdf-export.service.ts` to stream the
 * payload through the `PdfExportController` HTTP response.
 *
 * @param doc - TipTap document to render.
 * @param options - Same options accepted by `createPdfDocument`.
 * @returns A `Buffer` of finalized PDF bytes.
 */
export const renderPlaneDocToPdfBuffer = async (
  doc: TipTapDocument,
  options: PDFExportOptions = {}
): Promise<Buffer> => {
  const pdfDocument = createPdfDocument(doc, options);
  const pdfInstance = pdf(pdfDocument);
  const blob = await pdfInstance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

/**
 * Browser / Edge runtime renderer: builds the PDF document and returns a
 * `Blob` suitable for client-side download flows. Exposed in parallel with
 * `renderPlaneDocToPdfBuffer` so callers can pick the form they need without a
 * second `Buffer ↔ Blob` conversion.
 *
 * @param doc - TipTap document to render.
 * @param options - Same options accepted by `createPdfDocument`.
 * @returns A `Blob` of finalized PDF bytes.
 */
export const renderPlaneDocToPdfBlob = async (doc: TipTapDocument, options: PDFExportOptions = {}): Promise<Blob> => {
  const pdfDocument = createPdfDocument(doc, options);
  const pdfInstance = pdf(pdfDocument);
  return await pdfInstance.toBlob();
};
