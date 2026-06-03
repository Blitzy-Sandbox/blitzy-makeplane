/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyed ProseMirror plugin module that computes and renders the visible perimeter
 * outline around the cells of a `CellSelection`.
 *
 * OWNS the `selectedCell-border-{right|left|top|bottom}` decoration classes
 * applied to selected table cells. No other plugin in this subtree emits these
 * classes — outline rendering lives here and nowhere else.
 *
 * Plugin ownership across the table subtree (single-responsibility split):
 *   - `drag-state.ts`                        owns `content-hidden` decorations on cells during drag.
 *   - `insert-handlers/plugin.ts`            owns "+" buttons on row/column edges + the drag-marker container.
 *   - `drag-handles/column/plugin.ts`        owns the column drag-handle widget at the top of each column.
 *   - `drag-handles/row/plugin.ts`           owns the row drag-handle widget at the left of each row.
 *   - `selection-outline/plugin.ts` (HERE)   owns `selectedCell-border-*` decorations on the cell perimeter.
 */

import { findParentNode } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
// local imports
import { isCellSelection } from "../../table/utilities/helpers";
import { getCellBorderClasses } from "./utils";

type TableCellSelectionOutlinePluginState = {
  decorations?: DecorationSet;
};

const TABLE_SELECTION_OUTLINE_PLUGIN_KEY = new PluginKey("table-cell-selection-outline");

/**
 * Builds the keyed ProseMirror `Plugin` that emits node decorations for the cells
 * inside the current `CellSelection`, so the editor view paints the outline via
 * the `selectedCell-border-{right|left|top|bottom}` CSS classes.
 *
 * PluginKey: `"table-cell-selection-outline"` — the stable string identifier
 * shared with the editor for plugin lookup (grep this name to find callers of
 * `getState`).
 *
 * State shape: `TableCellSelectionOutlinePluginState`, holding an optional
 * `DecorationSet` recomputed per transaction. `state.init` returns `{}` so the
 * `decorations` field starts `undefined`; `Plugin.props.decorations` accepts
 * `undefined` and renders nothing in that case — intentional, no harm.
 *
 * `state.apply` lifecycle:
 *   - **Read-only short-circuit:** when `editor.isEditable` is `false`, returns
 *     `{}` immediately. Read-only surfaces (comments, embedded previews) still
 *     allow cell selections so users can copy table content, but those
 *     selections MUST NOT be outlined — outlining would imply interactivity
 *     that is not available. This `editor.isEditable` check is the architectural
 *     boundary between read-only and editable rendering of cell selections; it
 *     must not be assumed redundant by future refactors.
 *   - Otherwise: `findParentNode` locates the active table from the current
 *     selection, `selection.forEachCell` collects every selected cell's start
 *     position, and each cell receives a `Decoration.node` whose `class`
 *     attribute is the space-joined `getCellBorderClasses(cellStart,
 *     selectedCells, tableMap)` from `./utils.ts`. The helper suppresses
 *     internal borders between adjacent selected cells so only the exterior
 *     perimeter of the selection is styled.
 *
 * `props.decorations(state)` returns the current `DecorationSet` (or `undefined`
 * before the first apply produces one) so the editor view renders the outline.
 *
 * @param editor - TipTap `Editor` instance whose `isEditable` flag gates outline
 *   computation; the plugin reads no other editor state.
 * @returns A keyed `Plugin<TableCellSelectionOutlinePluginState>` ready to be
 *   registered on a table-aware TipTap editor.
 */
export const TableCellSelectionOutlinePlugin = (editor: Editor): Plugin<TableCellSelectionOutlinePluginState> =>
  new Plugin<TableCellSelectionOutlinePluginState>({
    key: TABLE_SELECTION_OUTLINE_PLUGIN_KEY,
    state: {
      init: () => ({}),
      apply(tr, prev, oldState, newState) {
        if (!editor.isEditable) return {};
        const table = findParentNode((node) => node.type.spec.tableRole === "table")(newState.selection);
        const hasDocChanged = tr.docChanged || !newState.selection.eq(oldState.selection);
        if (!table || !hasDocChanged) {
          return table === undefined ? {} : prev;
        }

        const { selection } = newState;
        if (!isCellSelection(selection)) return {};

        const decorations: Decoration[] = [];
        const tableMap = TableMap.get(table.node);
        const selectedCells: number[] = [];

        // First, collect all selected cell positions
        selection.forEachCell((_node, pos) => {
          const start = pos - table.pos - 1;
          selectedCells.push(start);
        });

        // Then, add decorations with appropriate border classes
        selection.forEachCell((node, pos) => {
          const start = pos - table.pos - 1;
          const classes = getCellBorderClasses(start, selectedCells, tableMap);

          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes.join(" ") }));
        });

        return {
          decorations: DecorationSet.create(newState.doc, decorations),
        };
      },
    },
    props: {
      decorations(state) {
        return TABLE_SELECTION_OUTLINE_PLUGIN_KEY.getState(state).decorations;
      },
    },
  });
