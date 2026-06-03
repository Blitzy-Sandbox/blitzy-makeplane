/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared TypeScript contracts for the PDF subsystem.
 *
 * Models the subset of the TipTap document schema the PDF renderer reads
 * (`TipTapDocument`, `TipTapNode`, `TipTapMark`), the PDF-side renderer
 * contracts (`PDFNodeRenderer`, `PDFMarkRenderer`, the registry maps,
 * `PDFRenderContext`, `KeyGenerator`), and the public export-time options
 * (`PDFExportOptions`, `PDFExportMetadata`, `PDFUserMention`).
 *
 * Consumed by `./node-renderers`, `./mark-renderers`, `./plane-pdf-exporter`,
 * and (via the `@/lib/pdf` barrel) by
 * `apps/live/src/services/pdf-export/pdf-export.service.ts` and
 * `apps/live/src/services/pdf-export/types.ts`.
 */

import type { Style } from "@react-pdf/types";

/**
 * A single inline-formatting mark on a TipTap text node (e.g., `bold`,
 * `italic`, `link`). `type` is the mark name; `attrs` carries
 * extension-specific data (e.g., `attrs.href` for `link`, `attrs.color` for
 * `textStyle`). Maps directly to the TipTap mark schema.
 */
export type TipTapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

/**
 * A single node in the TipTap document tree.
 *
 * `type` is the node name. `content` carries child nodes for block / list /
 * table containers. `text` is set on text nodes only — when present, `marks`
 * carries the inline-formatting marks applied to that run. The renderer
 * branches on `type` to decide layout; absent fields (`content` for empty
 * blocks, `marks` for unmarked text) are simply omitted by TipTap.
 */
export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
};

/**
 * Root TipTap document. `type` is always the literal `"doc"`
 * (a discriminant that lets `renderNode` skip type-narrowing) and `content`
 * holds the top-level block nodes.
 */
export type TipTapDocument = {
  type: "doc";
  content?: TipTapNode[];
};

/**
 * Factory function that yields a unique, stable string key per call.
 * Used to assign React `key` props to PDF tree elements so React-PDF can
 * diff them without warnings.
 */
export type KeyGenerator = () => string;

/**
 * Context threaded through the recursive PDF render traversal.
 * `getKey` supplies React keys; `metadata` carries entity resolution
 * (user mentions, resolved image URLs, asset suppression) for leaf renderers.
 */
export type PDFRenderContext = {
  getKey: KeyGenerator;
  metadata?: PDFExportMetadata;
};

/**
 * Signature of an individual node-type renderer.
 *
 * @param node     - The TipTap node being rendered (with any
 *                   traversal-injected attrs prefixed `_`).
 * @param children - Pre-rendered React-PDF elements for the node's
 *                   `content` children (the traversal handles recursion
 *                   before invoking the renderer).
 * @param context  - Shared render context.
 * @returns A React-PDF element.
 */
export type PDFNodeRenderer = (
  node: TipTapNode,
  children: React.ReactElement[],
  context: PDFRenderContext
) => React.ReactElement;

/**
 * Signature of an individual mark-type renderer.
 * Receives the mark and the current accumulated style; returns the next
 * `Style` (typically `{ ...currentStyle, /* contribution *\/ }`).
 */
export type PDFMarkRenderer = (mark: TipTapMark, currentStyle: Style) => Style;

/**
 * Map from TipTap node `type` name to its `PDFNodeRenderer`.
 *
 * Extensible: adding support for a new TipTap node type only requires adding
 * a new key here — the traversal already falls back to a generic
 * children-only `View` when the key is missing.
 */
export type NodeRendererRegistry = Record<string, PDFNodeRenderer>;

/**
 * Map from TipTap mark `type` name to its `PDFMarkRenderer`. Unknown marks
 * are silently skipped by `applyMarks` so adding new TipTap mark extensions
 * never crashes the PDF pipeline.
 */
export type MarkRendererRegistry = Record<string, PDFMarkRenderer>;

/**
 * Public options accepted by `createPdfDocument`, `renderPlaneDocToPdfBuffer`,
 * and `renderPlaneDocToPdfBlob`.
 *
 * The TipTap document is passed as a separate first argument to those
 * functions and is NOT part of this options object. `metadata` is forwarded
 * verbatim to node renderers; the top-level `noAssets` is merged into
 * `metadata.noAssets` inside `createPdfDocument` so leaf renderers only need
 * to consult one location.
 */
export type PDFExportOptions = {
  title?: string;
  author?: string;
  subject?: string;
  pageSize?: "A4" | "A3" | "A2" | "LETTER" | "LEGAL" | "TABLOID";
  pageOrientation?: "portrait" | "landscape";
  metadata?: PDFExportMetadata;
  /** When true, images and other assets are excluded from the PDF */
  noAssets?: boolean;
};

/**
 * Metadata for resolving entity references in PDF export
 */
export type PDFExportMetadata = {
  /** User mentions (user_mention in mention node) */
  userMentions?: PDFUserMention[];
  /** Resolved image URLs: Map of asset ID to presigned URL */
  resolvedImageUrls?: Record<string, string>;
  /** When true, images and other assets are excluded from the PDF */
  noAssets?: boolean;
};

/**
 * Shape of resolved user-mention data passed via `PDFExportMetadata`.
 *
 * `display_name` is the name rendered as `@<name>` in the PDF;
 * `avatar_url` is currently accepted but not rendered (PDF mention pills are
 * text-only).
 */
export type PDFUserMention = {
  id: string;
  display_name: string;
  avatar_url?: string;
};
