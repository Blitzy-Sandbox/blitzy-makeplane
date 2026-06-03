/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `TableCell` Node extension — the regular (non-header) cell of the editor's
 * table schema.
 *
 * Defines a ProseMirror block-content cell with row/column span attributes,
 * a per-cell column-width attribute (default `[DEFAULT_COLUMN_WIDTH]`), and
 * the `background` / `textColor` attributes consumed by the cell-coloring
 * UI (`./plugins/drag-handles/color-selector.tsx`). Wires the
 * `TableCellSelectionOutlinePlugin` so a visible border decoration renders
 * around the currently-selected cell or cell range, and registers a single
 * `Backspace` keyboard shortcut that converts Backspace into a cell
 * selection when the table has exactly one cell — preventing the cell from
 * being deleted as if it were normal text.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { findParentNodeOfType } from "@/helpers/common";
// local imports
import { TableCellSelectionOutlinePlugin } from "./plugins/selection-outline/plugin";
import { DEFAULT_COLUMN_WIDTH } from "./table";
import { isCellSelection } from "./table/utilities/helpers";

/**
 * Options accepted by the `TableCell` extension; `HTMLAttributes` are
 * merged into the rendered `<td>` tag on every cell.
 */
type TableCellOptions = {
  HTMLAttributes: Record<string, unknown>;
};

/**
 * Plane editor's `TableCell` Node extension.
 *
 * First-party note (AAP §0.2.2):
 *   Although this extension parallels `@tiptap/extension-table-cell`, it is
 *   built from scratch via `Node.create<>()` from `@tiptap/core` and depends
 *   on the ProseMirror table primitives from `@tiptap/pm/tables` (notably
 *   `TableMap`). Treat as owned code; the triplet below documents the
 *   conceptual relationship with the upstream package, not a runtime
 *   import dependency.
 *
 * Exposes (parity with `@tiptap/extension-table-cell`):
 *   - Schema node named `CORE_EXTENSIONS.TABLE_CELL` (`"tableCell"`)
 *   - `content: "block+"` — cells contain block content (paragraphs, lists,
 *     code-blocks, etc.) just like the upstream extension
 *   - `tableRole: "cell"` — wires this node into ProseMirror's table
 *     primitives in `@tiptap/pm/tables` so `addRowAfter`, `deleteColumn`,
 *     `mergeCells`, etc. recognize it
 *   - `isolating: true` — selection cannot cross the cell boundary, matching
 *     upstream behavior
 *   - `colspan` / `rowspan` attributes (default `1` / `1`)
 *   - `<td>` parse/render via `parseHTML` / `renderHTML`
 *
 * Overrides (vs `@tiptap/extension-table-cell`):
 *   - `colwidth` attribute default is `[DEFAULT_COLUMN_WIDTH]` (single-column
 *     array seeded with `150` per `./table/index.ts`), not `null` as in
 *     upstream — so freshly-created cells render with a deterministic width
 *     before the column-resizing plugin assigns one.
 *   - Adds `background` and `textColor` attributes (default `null`), rendered
 *     as inline `style="background-color: ...; color: ...;"` in
 *     `renderHTML`. These attributes are mutated by the
 *     `TableDragHandleDropdownColorSelector` UI in
 *     `./plugins/drag-handles/color-selector.tsx`.
 *   - Registers `TableCellSelectionOutlinePlugin` via `addProseMirrorPlugins`
 *     (see `./plugins/selection-outline/plugin.ts`) so the editor renders a
 *     decoration outlining the selected cell(s).
 *   - Registers a `Backspace` shortcut: when the table has exactly one cell
 *     (`TableMap.width === 1 && height === 1`) AND the caret is at the
 *     cell's first offset AND the selection is collapsed AND not already
 *     a `CellSelection`, Backspace converts the caret into a
 *     `setCellSelection({ anchorCell, headCell })` rather than deleting
 *     the cell's enclosing structure. WHY: in a single-cell table, the
 *     default Backspace would otherwise unwind the cell as if it were a
 *     normal text node, destroying the table; the override gives users an
 *     intuitive "press Backspace to select the cell, press again to clear"
 *     UX.
 *
 * Hides (vs `@tiptap/extension-table-cell`):
 *   - Upstream's plain `<td>` rendering without color attributes — Plane
 *     always emits the `background-color` / `color` inline styles even when
 *     the attributes are `null` (renders as `background-color: null;
 *     color: null;` which browsers ignore). No upstream attribute is
 *     removed; only the rendering is enriched.
 *
 * Consumers: `./table/table.ts` (composes this with `Table`, `TableHeader`,
 * `TableRow` to form the table schema), the column/row drag-handle
 * dropdowns in `./plugins/drag-handles/{column,row}/dropdown.tsx`
 * (mutate `background` / `textColor`), and the selection-outline utility
 * in `./plugins/selection-outline/utils.ts` (reads cell positions from
 * `TableMap` to compute border decorations).
 *
 * Cross-reference: `CORE_EXTENSIONS.TABLE_CELL` enum member is defined in
 * `packages/editor/src/core/constants/extension.ts`.
 */
export const TableCell = Node.create<TableCellOptions>({
  name: CORE_EXTENSIONS.TABLE_CELL,

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
        default: null,
      },
      textColor: {
        default: null,
      },
    };
  },

  tableRole: "cell",

  isolating: true,

  addProseMirrorPlugins() {
    return [TableCellSelectionOutlinePlugin(this.editor)];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor.view;
        const { selection } = state;

        if (isCellSelection(selection)) return false;

        // Check if we're at the start of the cell
        if (selection.from !== selection.to || selection.$head.parentOffset !== 0) return false;

        // Find table and current cell
        const tableNode = findParentNodeOfType(selection, [CORE_EXTENSIONS.TABLE])?.node;
        const currentCellInfo = findParentNodeOfType(selection, [
          CORE_EXTENSIONS.TABLE_CELL,
          CORE_EXTENSIONS.TABLE_HEADER,
        ]);
        const currentCellNode = currentCellInfo?.node;
        const cellPos = currentCellInfo?.pos;
        const cellDepth = currentCellInfo?.depth;

        if (!tableNode || !currentCellNode || cellPos === null || cellDepth === null) return false;

        // Check if this is the only cell in the TableMap (1 row, 1 column)
        const tableMap = TableMap.get(tableNode);
        const isOnlyCell = tableMap.width === 1 && tableMap.height === 1;
        if (!isOnlyCell) return false;

        // Cell has content, select the entire cell
        // Use the position that points to the cell node itself, not its content
        const cellNodePos = selection.$head.before(cellDepth);

        editor.commands.setCellSelection({
          anchorCell: cellNodePos,
          headCell: cellNodePos,
        });
        return true;
      },
    };
  },

  parseHTML() {
    return [{ tag: "td" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style: `background-color: ${node.attrs.background}; color: ${node.attrs.textColor};`,
      }),
      0,
    ];
  },
});
