/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `TableHeader` Node extension — the header-cell variant of the editor's
 * table schema.
 *
 * Defines a ProseMirror block-content cell with the `tableRole:
 * "header_cell"` indicator that distinguishes it from regular `TableCell`
 * (`tableRole: "cell"`). Header cells render as `<th>` rather than `<td>`
 * and carry the same span/width/background attributes as regular cells,
 * but DO NOT include the `textColor` attribute or the selection-outline
 * plugin — those are concerns owned by `TableCell` (see `./table-cell.ts`)
 * because header cells already have distinct styling from the
 * `data-table-header` / `<th>` selector chain in the project stylesheet.
 */

import { mergeAttributes, Node } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// local imports
import { DEFAULT_COLUMN_WIDTH } from "./table";

/**
 * Options accepted by the `TableHeader` extension; `HTMLAttributes` are
 * merged into the rendered `<th>` tag on every header cell.
 */
type TableHeaderOptions = {
  HTMLAttributes: Record<string, unknown>;
};

/**
 * Plane editor's `TableHeader` Node extension.
 *
 * First-party note (AAP §0.2.2):
 *   Although this extension parallels `@tiptap/extension-table-header`, it
 *   is built from scratch via `Node.create<>()` from `@tiptap/core`. Treat
 *   as owned code; the triplet below documents the conceptual relationship
 *   with the upstream package, not a runtime import dependency.
 *
 * Exposes (parity with `@tiptap/extension-table-header`):
 *   - Schema node named `CORE_EXTENSIONS.TABLE_HEADER` (`"tableHeader"`)
 *   - `content: "block+"` — header cells contain block content (typically
 *     a single paragraph but lists, code blocks, etc. are permitted) just
 *     like the upstream extension
 *   - `tableRole: "header_cell"` — the "header indicator" called out in the
 *     AAP folder requirements; wires this node into ProseMirror's table
 *     primitives in `@tiptap/pm/tables` so `toggleHeaderRow`,
 *     `toggleHeaderColumn`, `toggleHeaderCell` recognize it as the
 *     header variant
 *   - `isolating: true` — selection cannot cross the header-cell boundary,
 *     matching upstream behavior
 *   - `colspan` / `rowspan` attributes (default `1` / `1`)
 *   - `<th>` parse/render via `parseHTML` / `renderHTML`
 *
 * Overrides (vs `@tiptap/extension-table-header`):
 *   - `colwidth` attribute default is `[DEFAULT_COLUMN_WIDTH]` (single-column
 *     array seeded with `150` per `./table/index.ts`), not `null` as in
 *     upstream — so freshly-created header cells render with a deterministic
 *     width matching their `TableCell` siblings in the same column before
 *     the column-resizing plugin assigns one.
 *   - Adds `background` attribute (default `"none"`), rendered as inline
 *     `style="background-color: <value>;"` in `renderHTML`. The default
 *     value `"none"` differs from `TableCell`'s `null` default — WHY:
 *     header cells often need a distinct visual fill (Plane stylesheet
 *     supplies a default header background via the `<th>` selector),
 *     so the wrapper sets `"none"` as an explicit override to make
 *     "no background" a deliberate value rather than an absent attribute.
 *
 * Hides (vs `@tiptap/extension-table-header`):
 *   - The `textColor` attribute owned by `TableCell` is intentionally
 *     omitted here — header text color is managed by the project stylesheet
 *     via the `<th>` selector, not via per-cell inline color attributes.
 *   - The `TableCellSelectionOutlinePlugin` wired by `TableCell` is NOT
 *     registered here. Header-cell selection outline visualization is
 *     handled by the same plugin operating on the parent table; the plugin
 *     doesn't need to be registered twice.
 *
 * Consumers: `./table/table.ts` (composes this with `Table`, `TableCell`,
 * `TableRow` to form the table schema), `./table/utilities/create-table.ts`
 * (creates header cells when the `withHeaderRow` flag is `true`), and the
 * header-toggle commands in `./table/table.ts` (`toggleHeaderRow`,
 * `toggleHeaderColumn`, `toggleHeaderCell`) which use the `tableRole`
 * indicator to convert between header and regular cells.
 *
 * Cross-reference: `CORE_EXTENSIONS.TABLE_HEADER` enum member is defined in
 * `packages/editor/src/core/constants/extension.ts`.
 */
export const TableHeader = Node.create<TableHeaderOptions>({
  name: CORE_EXTENSIONS.TABLE_HEADER,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  content: "block+",

  addAttributes() {
    return {
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
      colwidth: {
        default: [DEFAULT_COLUMN_WIDTH],
        parseHTML: (element) => {
          const colwidth = element.getAttribute("colwidth");
          const value = colwidth ? [parseInt(colwidth, 10)] : null;

          return value;
        },
      },
      background: {
        default: "none",
      },
    };
  },

  tableRole: "header_cell",

  isolating: true,

  parseHTML() {
    return [{ tag: "th" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style: `background-color: ${node.attrs.background};`,
      }),
      0,
    ];
  },
});
