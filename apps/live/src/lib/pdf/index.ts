/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel entrypoint for the `apps/live` PDF export subsystem.
 *
 * Consumers — notably `apps/live/src/services/pdf-export/pdf-export.service.ts`,
 * which is invoked from `apps/live/src/controllers/pdf-export.controller.ts` —
 * should import from this stable path rather than deep-importing implementation
 * modules so renderer internals can evolve without breaking callers.
 *
 * Re-export surface:
 *  - `./plane-pdf-exporter`: top-level PDF document construction and rendering
 *    helpers (`createPdfDocument`, `renderPlaneDocToPdfBuffer`,
 *    `renderPlaneDocToPdfBlob`).
 *  - `./node-renderers`: node-level rendering registry and recursive traversal
 *    (`nodeRenderers`, `renderNode`, `createKeyGenerator`).
 *  - `./mark-renderers`: inline-mark rendering registry and ordered reducer
 *    (`markRenderers`, `applyMarks`).
 *  - `./styles`: central React-PDF stylesheet (`pdfStyles`).
 *  - `./types`: shared TipTap and PDF contract types.
 */

export { createPdfDocument, renderPlaneDocToPdfBlob, renderPlaneDocToPdfBuffer } from "./plane-pdf-exporter";
export { createKeyGenerator, nodeRenderers, renderNode } from "./node-renderers";
export { markRenderers, applyMarks } from "./mark-renderers";
export { pdfStyles } from "./styles";
export type {
  KeyGenerator,
  MarkRendererRegistry,
  NodeRendererRegistry,
  PDFExportMetadata,
  PDFExportOptions,
  PDFMarkRenderer,
  PDFNodeRenderer,
  PDFRenderContext,
  PDFUserMention,
  TipTapDocument,
  TipTapMark,
  TipTapNode,
} from "./types";
