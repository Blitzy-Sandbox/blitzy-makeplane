/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyed ProseMirror plugin lifecycle manager for the ROW drag handles.
 *
 * OWNS the row drag-handle widget rendered at the LEFT of each table row.
 *
 * Plugin ownership across the table subtree (single-responsibility split):
 *   - `drag-state.ts`                        owns `content-hidden` decorations on cells during drag.
 *   - `insert-handlers/plugin.ts`            owns "+" buttons on row/column edges + the drag-marker container.
 *   - `drag-handles/column/plugin.ts`        owns the column drag-handle widget at the top of each column.
 *   - `drag-handles/row/plugin.ts` (HERE)    owns the row drag-handle widget at the left of each row.
 *   - `selection-outline/plugin.ts`          owns `selectedCell-border-*` decorations on the cell perimeter.
 *
 * Column and row drag-handle plugins are deliberate near-mirrors of each
 * other; keeping them in separate subfolders with symmetric structure makes
 * the axis-specific math visible at a glance. Do NOT merge them "for DRY" —
 * the symmetric split keeps the row-vs-column logic review tractable.
 *
 * Cross-reference: `../column/plugin.ts` is the column-axis counterpart with
 * identical structure (substitute `tableHeight`/`row * tableMap.width` for
 * `tableWidth`/`col` to map between the two). Keep both in sync when modifying
 * the lifecycle algorithm.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
// extensions
import {
  findTable,
  getTableCellWidgetDecorationPos,
  haveTableRelatedChanges,
} from "@/extensions/table/table/utilities/helpers";
// local imports
import type { RowDragHandleProps } from "./drag-handle";
import { RowDragHandle } from "./drag-handle";

/**
 * State shape persisted by the row drag-handle plugin under
 * `TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY`.
 *
 * @property decorations Current `DecorationSet` of row-handle widget decorations
 *   (one per row, positioned at each row's first cell).
 * @property tableHeight Last-known row count — compared to the current
 *   `TableMap.height` to detect structural changes (rows added/removed).
 * @property tableNodePos Last-known table node position — used to detect when
 *   the active table changed (e.g., the selection moved to a different table).
 *   Position-based detection is required because ProseMirror does not provide
 *   node identity that survives across transactions.
 * @property renderers Active `ReactRenderer` instances mounting each
 *   `RowDragHandle`; tracked so they can be destroyed before being replaced
 *   on rebuild (prevents leaked React roots).
 */
type TableRowDragHandlePluginState = {
  decorations?: DecorationSet;
  // track table structure to detect changes
  tableHeight?: number;
  tableNodePos?: number;
  // track renderers for cleanup
  renderers?: ReactRenderer[];
};

/**
 * Plugin key used by ProseMirror to store and look up the row drag-handle
 * plugin's state in the editor state tree. Consumers (including this plugin's
 * own `props.decorations` accessor and any external debugging/devtools) read
 * the current decoration set via `KEY.getState(state)?.decorations`.
 */
const TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY = new PluginKey("tableRowDragHandlePlugin");

/**
 * Build the row drag-handle ProseMirror `Plugin` for the given editor.
 *
 * Manages one `RowDragHandle` React widget per table row, positioned via a
 * widget decoration at the first cell of each row.
 *
 * @param editor Tiptap editor the plugin is bound to (passed to each widget's
 *   React props so the handle can dispatch transactions on the right editor).
 * @returns A keyed `Plugin<TableRowDragHandlePluginState>`.
 *
 * Activation: any selection or document change touching a table. When
 * `findTable(newState.selection)` returns `undefined`, decorations stay empty
 * (no-op) and the state resets to `{}`.
 *
 * `state.apply` behavior:
 *   - Skips if `haveTableRelatedChanges(...)` reports the transaction is
 *     unrelated to table state; preserves `prev` if a table is still selected,
 *     else resets to `{}`.
 *   - Computes the current `TableMap` from the active table node.
 *   - Stale detection:
 *       * Structure change (`tableHeight` or `tableNodePos` differs from the
 *         current `tableMap.height` / `table.pos`) → stale.
 *       * Position drift: for each row, the expected widget position is
 *         computed via `getTableCellWidgetDecorationPos(table, tableMap,
 *         row * tableMap.width)`; the prior decoration set (mapped forward
 *         through `tr.mapping`) must contain exactly one decoration at that
 *         position, else stale.
 *   - REMAP path (not stale): maps existing decorations through `tr.mapping`
 *     and reuses the existing `ReactRenderer` instances — no React remount.
 *     This is the performance-critical fast path that avoids unmounting and
 *     remounting every row handle on each keystroke inside a table cell.
 *   - REBUILD path (stale): destroys all existing renderers, then mounts a
 *     fresh `ReactRenderer<RowDragHandle>` per row with `props: { editor, row }`
 *     and creates a new `Decoration.widget` set keyed at each row's first-cell
 *     position.
 *
 * `props.decorations`: exposes the current `DecorationSet` to the editor view
 * via `TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY.getState(state)?.decorations`.
 *
 * `destroy()`: cleans up all active renderers on editor teardown. Both the
 * REBUILD-path cleanup and the plugin's own `destroy()` wrap each
 * `renderer.destroy()` in a try/catch — React renderer destruction can throw
 * during HMR or when the editor DOM is already detached, and the loop MUST
 * continue tearing down remaining renderers to avoid leaks. The try/catch is
 * a load-bearing part of the cleanup contract, not defensive boilerplate.
 */
export const TableRowDragHandlePlugin = (editor: Editor): Plugin<TableRowDragHandlePluginState> =>
  new Plugin<TableRowDragHandlePluginState>({
    key: TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY,
    state: {
      init: () => ({}),
      apply(tr, prev, oldState, newState) {
        const table = findTable(newState.selection);
        if (!haveTableRelatedChanges(editor, table, oldState, newState, tr)) {
          return table !== undefined ? prev : {};
        }

        const tableMap = TableMap.get(table.node);

        // Check if table structure changed (height or position)
        const tableStructureChanged = prev.tableHeight !== tableMap.height || prev.tableNodePos !== table.pos;

        let isStale = tableStructureChanged;

        // Only do position-based stale check if structure hasn't changed
        if (!isStale) {
          const mapped = prev.decorations?.map(tr.mapping, tr.doc);
          for (let row = 0; row < tableMap.height; row++) {
            const pos = getTableCellWidgetDecorationPos(table, tableMap, row * tableMap.width);
            if (mapped?.find(pos, pos + 1)?.length !== 1) {
              isStale = true;
              break;
            }
          }
        }

        if (!isStale) {
          const mapped = prev.decorations?.map(tr.mapping, tr.doc);
          return {
            decorations: mapped,
            tableHeight: tableMap.height,
            tableNodePos: table.pos,
            renderers: prev.renderers,
          };
        }

        // Clean up old renderers before creating new ones
        prev.renderers?.forEach((renderer) => {
          try {
            renderer.destroy();
          } catch (error) {
            console.error("Error destroying renderer:", error);
          }
        });

        // recreate all decorations
        const decorations: Decoration[] = [];
        const renderers: ReactRenderer[] = [];

        for (let row = 0; row < tableMap.height; row++) {
          const pos = getTableCellWidgetDecorationPos(table, tableMap, row * tableMap.width);

          const dragHandleComponent = new ReactRenderer(RowDragHandle, {
            props: {
              editor,
              row,
            } satisfies RowDragHandleProps,
            editor,
          });

          renderers.push(dragHandleComponent);
          decorations.push(Decoration.widget(pos, () => dragHandleComponent.element));
        }

        return {
          decorations: DecorationSet.create(newState.doc, decorations),
          tableHeight: tableMap.height,
          tableNodePos: table.pos,
          renderers,
        };
      },
    },
    props: {
      decorations(state) {
        return (TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY.getState(state) as TableRowDragHandlePluginState | undefined)
          ?.decorations;
      },
    },
    destroy() {
      // Clean up all renderers when plugin is destroyed
      const state =
        editor.state &&
        (TABLE_ROW_DRAG_HANDLE_PLUGIN_KEY.getState(editor.state) as TableRowDragHandlePluginState | undefined);
      state?.renderers?.forEach((renderer: ReactRenderer) => {
        try {
          renderer.destroy();
        } catch (error) {
          console.error("Error destroying renderer:", error);
        }
      });
    },
  });
