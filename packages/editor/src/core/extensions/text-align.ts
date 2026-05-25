/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Text-alignment extension for the Plane editor.
 *
 * Wraps `@tiptap/extension-text-align` with a restricted alignment set
 * applied only to heading and paragraph nodes. Re-exported through
 * `core/extensions/index.ts` and consumed by the editor extension registry.
 */

import TextAlign from "@tiptap/extension-text-align";

/** Supported text-alignment values for paragraph and heading nodes. */
export type TTextAlign = "left" | "center" | "right";

/**
 * Pre-configured text-alignment extension restricted to the alignment set
 * and node types the Plane editor supports.
 *
 * Exposes:
 *   - Upstream `@tiptap/extension-text-align` commands: `setTextAlign(alignment)`, `unsetTextAlign()`
 *   - The `textAlign` data attribute rendered on aligned nodes
 *
 * Overrides:
 *   - none (configuration-only call site; no extension behavior is re-declared)
 *
 * Hides:
 *   - `"justify"` alignment (upstream default option set includes it but Plane omits it)
 *   - Alignment on all node types except `"heading"` and `"paragraph"`
 *     (lists, blockquotes, callouts, table cells cannot be aligned via this extension)
 *
 * WHY: `"justify"` produces inconsistent typography in collaborative contexts;
 * limiting alignable nodes to headings and paragraphs prevents broken layouts on
 * structural elements where alignment is either irrelevant or visually broken.
 */
export const CustomTextAlignExtension = TextAlign.configure({
  alignments: ["left", "center", "right"],
  types: ["heading", "paragraph"],
});
