/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Title-only editor schema bundle for single-line title editors.
 *
 * Composes three upstream TipTap extensions into the minimal schema needed to render an H1 title field: a `Document` that ONLY contains a single `heading`, the `Heading` extension restricted to `level: 1`, and the `Text` inline content. Consumed by `core/hooks/use-title-editor.ts` and re-exported as `TITLE_EDITOR_EXTENSIONS` from `core/helpers/yjs-utils.ts` for Y.js title-document conversion.
 */

import type { AnyExtension, Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Text from "@tiptap/extension-text";

/**
 * Minimal extension bundle for single-line title editors.
 *
 * Exposes:
 *   - `@tiptap/extension-document` — the document schema root.
 *   - `@tiptap/extension-heading` — heading node attributes plus the `setHeading` and `toggleHeading` commands.
 *   - `@tiptap/extension-text` — inline text content.
 *
 * Overrides:
 *   - Document content schema: replaced from `"block+"` (any block content) to `"heading"` so a title document MUST consist of exactly one heading node — pressing Enter or pasting multi-block content cannot inject paragraphs into the title.
 *   - Heading `levels` option: restricted from `[1, 2, 3, 4, 5, 6]` to `[1]` only — no H2/H3/etc. are valid in a title.
 *
 * Hides:
 *   - All other nodes and marks (paragraph, lists, blockquote, code-block, bold, italic, links, etc.) — none of these extensions appear in this array, so they are absent from the title editor's ProseMirror schema entirely.
 *
 * WHY a separate extension set:
 *   Title editors enforce single-line H1 semantics. The constrained schema makes structurally-invalid title content impossible at the ProseMirror schema layer rather than relying on input handlers or runtime sanitization.
 *
 * Consumers:
 *   - `packages/editor/src/core/hooks/use-title-editor.ts` — spreads `TitleExtensions` into the title editor's extension list.
 *   - `packages/editor/src/core/helpers/yjs-utils.ts` — re-exports as `TITLE_EDITOR_EXTENSIONS` for Y.js title-document conversion (consumed downstream by `apps/live/src/extensions/title-sync.ts`).
 */
export const TitleExtensions: Extensions = [
  Document.extend({
    content: "heading",
  }),
  // Existing type cast required by the upstream `Heading.configure(...)` return type, which does not directly satisfy `Extensions` array element typing.
  Heading.configure({
    levels: [1],
  }) as AnyExtension,
  Text,
];
