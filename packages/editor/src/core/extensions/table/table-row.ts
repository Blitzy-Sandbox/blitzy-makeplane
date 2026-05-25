/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `TableRow` Node extension — the row container of the editor's table
 * schema.
 *
 * Defines a ProseMirror node whose content is `(tableCell | tableHeader)*`
 * (zero or more cell or header nodes) with `tableRole: "row"`. Carries
 * row-level `background` and `textColor` attributes (default `null`) so
 * the row-drag-handle dropdown in
 * `./plugins/drag-handles/row/dropdown.tsx` can apply a single color to
 * every cell in the row via a row-level `<tr style="...">` rather than
 * mutating every individual cell.
 */

import { mergeAttributes, Node } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Options accepted by the `TableRow` extension; `HTMLAttributes` are
 * merged into the rendered `<tr>` tag on every row.
 */
type TableRowOptions = {
  HTMLAttributes: Record<string, unknown>;
};

/**
 * Plane editor's `TableRow` Node extension.
 *
 * First-party note (AAP §0.2.2):
 *   Although this extension parallels `@tiptap/extension-table-row`, it is
 *   built from scratch via `Node.create<>()` from `@tiptap/core`. Treat as
 *   owned code; the triplet below documents the conceptual relationship
 *   with the upstream package, not a runtime import dependency.
 *
 * Exposes (parity with `@tiptap/extension-table-row`):
 *   - Schema node named `CORE_EXTENSIONS.TABLE_ROW` (`"tableRow"`)
 *   - `content: "(tableCell | tableHeader)*"` — rows contain zero or more
 *     `TableCell` or `TableHeader` children, matching the upstream content
 *     expression
 *   - `tableRole: "row"` — wires this node into ProseMirror's table
 *     primitives in `@tiptap/pm/tables` so `addRowAfter`, `addRowBefore`,
 *     `deleteRow` recognize it as the row variant
 *   - `<tr>` parse/render via `parseHTML` / `renderHTML`
 *
 * Overrides (vs `@tiptap/extension-table-row`):
 *   - Adds row-level `background` and `textColor` attributes (default
 *     `null`). `renderHTML` emits an inline
 *     `style="background-color: <bg>; color: <textColor>"` only when
 *     `background` is truthy — the conditional is intentional: a `null`
 *     background should render as an attribute-free `<tr>` so cell-level
 *     backgrounds (from `TableCell.background`) remain visible. WHY at
 *     row level: the row-drag-handle dropdown in
 *     `./plugins/drag-handles/row/dropdown.tsx` writes color attributes
 *     once at the row level rather than mutating every individual cell;
 *     this is significantly cheaper for ProseMirror transactions on wide
 *     tables.
 *
 * Hides (vs `@tiptap/extension-table-row`):
 *   - Nothing — upstream `@tiptap/extension-table-row` has no behavior
 *     that this extension intentionally suppresses. The override above is
 *     additive (adds the two color attributes), not subtractive.
 *
 * Consumers: `./table/table.ts` (composes this with `Table`, `TableCell`,
 * `TableHeader` to form the table schema), `./table/utilities/create-table.ts`
 * (creates rows during table construction), and the row-drag-handle
 * dropdown in `./plugins/drag-handles/row/dropdown.tsx` (mutates
 * `background` / `textColor` via `updateAttributes`).
 *
 * Cross-reference: `CORE_EXTENSIONS.TABLE_ROW` enum member is defined in
 * `packages/editor/src/core/constants/extension.ts`.
 */
export const TableRow = Node.create<TableRowOptions>({
  name: CORE_EXTENSIONS.TABLE_ROW,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      background: {
        default: null,
      },
      textColor: {
        default: null,
      },
    };
  },

  content: "(tableCell | tableHeader)*",

  tableRole: "row",

  parseHTML() {
    return [{ tag: "tr" }];
  },

  renderHTML({ HTMLAttributes }) {
    const style = HTMLAttributes.background
      ? `background-color: ${HTMLAttributes.background}; color: ${HTMLAttributes.textColor}`
      : "";

    const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style });

    return ["tr", attributes, 0];
  },
});
