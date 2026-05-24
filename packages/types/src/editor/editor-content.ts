/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Editor content type markers for the `@plane/types/editor` subfolder.
 *
 * Defines compile-time discriminants for the rich-text document schema used by
 * the `@plane/editor` TipTap wrapper — these aliases identify which content
 * format (HTML string vs. ProseMirror JSON node tree) is being passed across
 * boundaries between the editor, the API, and downstream consumers.
 *
 * Locally defined to avoid taking a runtime dependency on TipTap or ProseMirror
 * packages inside `@plane/types`; the shapes here mirror the public ProseMirror
 * JSON contract just enough for type-call-site safety.
 *
 * Consumers:
 * - `@plane/editor` (core editor types and helpers in
 *   `packages/editor/src/core/types/editor.ts`,
 *   `packages/editor/src/core/helpers/yjs-utils.ts`,
 *   `packages/editor/src/core/helpers/parser.ts`)
 * - `apps/web/core/components/issues/issue-detail/description/`,
 *   `apps/web/core/components/pages/` (description and page editors)
 * - `apps/live/src/extensions/title-sync.ts` (real-time title sync extension)
 * - `packages/types/src/issues/activity/issue_comment.ts` (comment activity)
 */

/**
 * One node in a TipTap/ProseMirror JSON document tree — the structured
 * representation of rich-text content.
 *
 * Recursive via the `content` field, supporting arbitrarily nested document
 * trees (lists, blockquotes, table cells, etc.). The index signature absorbs
 * extension-specific metadata without compile-time friction.
 *
 * Non-obvious fields:
 * - `type`: Node-type identifier matching a TipTap extension/schema name
 *   (e.g., `"doc"`, `"paragraph"`, `"text"`, `"heading"`, `"bulletList"`).
 * - `attrs`: Node-level attributes whose shape depends on `type` and the
 *   matching TipTap extension's schema (e.g., heading level, image src).
 * - `content`: Child nodes — absent for leaf nodes such as `text`.
 * - `marks`: Inline formatting marks (bold, italic, link, ...) applied to a
 *   `text` node; each mark requires a `type` string and may carry `attrs`.
 * - `text`: Literal text content — present only on `text` nodes; mutually
 *   exclusive with `content` in well-formed ProseMirror documents.
 * - `[key: string]: unknown`: Intentional escape hatch for extension-specific
 *   metadata; not a leaky abstraction.
 */
export type JSONContent = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: {
    type: string;
    attrs?: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  text?: string;
  [key: string]: unknown;
};

/**
 * HTML-serialized rich-text content — a semantic alias for `string` carrying
 * markup produced by the editor's HTML serializer or accepted by its parser.
 *
 * Exists to distinguish HTML-format payloads from arbitrary strings at
 * type-call sites; at runtime this is a bare `string` with no enforcement of
 * well-formedness, so producers and consumers must agree on the HTML contract.
 *
 * Consumers: `packages/editor/src/core/helpers/parser.ts` (HTML→JSON parsing),
 * `packages/utils/src/string.ts`, `apps/web/core/hooks/use-parse-editor-content.ts`,
 * `apps/web/core/components/pages/modals/export-page-modal.tsx` (HTML export).
 */
export type HTMLContent = string;

/**
 * Umbrella union of supported editor content forms — the broadest accepted
 * shape for editor inputs/outputs where the representation may vary.
 *
 * Union arms:
 * - `HTMLContent` (string): HTML-serialized representation accepted by
 *   TipTap's HTML parser and produced by `editor.getHTML()`.
 * - `JSONContent`: A single ProseMirror JSON document root — typical shape
 *   after `editor.getJSON()`; consumed by `editor.commands.setContent()` and
 *   Y.js-aware initializers.
 * - `JSONContent[]`: An array of sibling JSON nodes — used where fragment
 *   content is passed without a wrapping `"doc"` node.
 * - `null`: Empty/uninitialized content — semantically distinct from an empty
 *   document (`{ type: "doc", content: [] }`); signals "no content set yet"
 *   from initial-state placeholders and lazy-load gates.
 *
 * Consumers: All editor component props in `@plane/editor`,
 * `apps/web/core/components/editor/*`, page and issue description state stores.
 */
export type Content = HTMLContent | JSONContent | JSONContent[] | null;
