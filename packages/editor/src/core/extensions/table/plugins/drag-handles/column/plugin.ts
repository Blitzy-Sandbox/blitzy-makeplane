/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyed ProseMirror plugin lifecycle manager for the COLUMN drag handles.
 *
 * OWNS the column drag-handle widget rendered at the TOP of each table column.
 *
 * Plugin ownership across the table subtree (single-responsibility split):
 *   - `drag-state.ts`                        owns `content-hidden` decorations on cells during drag.
 *   - `insert-handlers/plugin.ts`            owns "+" buttons on row/column edges + the drag-marker container.
 *   - `drag-handles/column/plugin.ts` (HERE) owns the column drag-handle widget at the top of each column.
 *   - `drag-handles/row/plugin.ts`           owns the row drag-handle widget at the left of each row.
 *   - `selection-outline/plugin.ts`          owns `selectedCell-border-*` decorations on the cell perimeter.
 *
 * The column and row drag-handle plugins are deliberate near-mirrors of each
 * other; keeping them in separate subfolders with symmetric structure makes
 * the axis-specific math visible at a glance. Do NOT merge them "for DRY" —
 * the symmetric split keeps the column-vs-row logic review tractable.
 *
 * Cross-reference: `../row/plugin.ts` is the row-axis counterpart with
 * identical structure (substitute `tableWidth`/`col` for `tableHeight`/
 * `row * tableMap.width` to map between the two).
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
import type { ColumnDragHandleProps } from "./drag-handle";
import { ColumnDragHandle } from "./drag-handle";

/**
 * State shape persisted by the column drag-handle plugin under
 * `TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY`.
 *
 * @property decorations Current `DecorationSet` of column-handle widget decorations
 *   (one per column).
 * @property tableWidth Last-known column count — compared against the current
 *   `TableMap.width` to detect table-structure changes.
 * @property tableNodePos Last-known table node position in the document — used to
 *   detect when the active table changed (e.g., user moved selection to a
 *   different table); position is the canonical structural-change signal because
 *   ProseMirror node identity does not survive across transactions.
 * @property renderers Active `ReactRenderer` instances mounting each
 *   `ColumnDragHandle` component; tracked so they can be destroyed before being
 *   replaced (memory cleanup).
 */
type TableColumnDragHandlePluginState = {
  decorations?: DecorationSet;
  // track table structure to detect changes
  tableWidth?: number;
  tableNodePos?: number;
  // track renderers for cleanup
  renderers?: ReactRenderer[];
};

/**
 * Plugin key used by ProseMirror to store and look up the column drag-handle
 * plugin's state in the editor state tree. Read via `KEY.getState(state)` from
 * `props.decorations` and from external consumers (debugging, devtools).
 *
 * The underlying string identifier (`"tableColumnHandlerDecorationPlugin"`) is
 * intentionally preserved verbatim — renaming it would change the plugin's
 * identity in the ProseMirror state tree and break any external code that
 * looks up plugin state by string key.
 */
const TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY = new PluginKey("tableColumnHandlerDecorationPlugin");

/**
 * Build the column drag-handle ProseMirror `Plugin` for the given editor.
 *
 * Manages one `ColumnDragHandle` React widget per table column, positioned via
 * a widget decoration at the first cell of each column.
 *
 * @param editor Tiptap editor the plugin is bound to (passed to each widget's
 *   React props so the handle can dispatch transactions on the right editor).
 * @returns A keyed `Plugin<TableColumnDragHandlePluginState>`.
 *
 * Activation: any selection or document change touching a table. When
 * `findTable(newState.selection)` returns `undefined`, decorations stay empty
 * (no-op) and the state resets to `{}`.
 *
 * `state.apply` behavior:
 *   - Skips if `haveTableRelatedChanges(...)` reports the transaction is
 *     unrelated to table state; preserves `prev` if a table is currently
 *     selected, else returns `{}`.
 *   - Computes the current `TableMap` from the table node.
 *   - Stale detection:
 *       * Structure change — `prev.tableWidth !== tableMap.width` OR
 *         `prev.tableNodePos !== table.pos` → stale.
 *       * Position drift — for each column, the expected widget position is
 *         computed via `getTableCellWidgetDecorationPos(table, tableMap, col)`;
 *         the prior decoration set (mapped through `tr.mapping`) must contain
 *         exactly one decoration at that position, else stale.
 *   - REMAP path (not stale): maps existing decorations through `tr.mapping`
 *     and reuses the existing `ReactRenderer` instances — no React unmount /
 *     remount. This is the performance-critical fast path; without it every
 *     keystroke inside a table would tear down and rebuild every column handle.
 *   - REBUILD path (stale): destroys all existing renderers (guarded — see
 *     "Error handling" below), then for each column mounts a fresh
 *     `ReactRenderer<ColumnDragHandle>` with `props: { col, editor }` and a
 *     corresponding `Decoration.widget` at the column's first-cell position.
 *
 * `props.decorations`: exposes the current `DecorationSet` to the editor view
 * via `TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY.getState(state)?.decorations`.
 *
 * `destroy()`: cleans up all active renderers on plugin/editor teardown.
 *
 * Error handling: both the REBUILD-path cleanup and the plugin's own
 * `destroy()` wrap each `renderer.destroy()` in a try/catch + `console.error`.
 * This is deliberate — `ReactRenderer.destroy()` can throw during HMR or when
 * the editor's host DOM has already been detached, and the loop MUST continue
 * tearing down remaining renderers to prevent memory leaks.
 */
export const TableColumnDragHandlePlugin = (editor: Editor): Plugin<TableColumnDragHandlePluginState> =>
  new Plugin<TableColumnDragHandlePluginState>({
    key: TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY,
    state: {
      init: () => ({}),
      apply(tr, prev, oldState, newState) {
        const table = findTable(newState.selection);
        if (!haveTableRelatedChanges(editor, table, oldState, newState, tr)) {
          return table !== undefined ? prev : {};
        }

        const tableMap = TableMap.get(table.node);

        // Check if table structure changed (width or position)
        const tableStructureChanged = prev.tableWidth !== tableMap.width || prev.tableNodePos !== table.pos;

        let isStale = tableStructureChanged;

        // Only do position-based stale check if structure hasn't changed
        if (!isStale) {
          const mapped = prev.decorations?.map(tr.mapping, tr.doc);
          for (let col = 0; col < tableMap.width; col++) {
            const pos = getTableCellWidgetDecorationPos(table, tableMap, col);
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
            tableWidth: tableMap.width,
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

        for (let col = 0; col < tableMap.width; col++) {
          const pos = getTableCellWidgetDecorationPos(table, tableMap, col);

          const dragHandleComponent = new ReactRenderer(ColumnDragHandle, {
            props: {
              col,
              editor,
            } satisfies ColumnDragHandleProps,
            editor,
          });

          renderers.push(dragHandleComponent);
          decorations.push(Decoration.widget(pos, () => dragHandleComponent.element));
        }

        return {
          decorations: DecorationSet.create(newState.doc, decorations),
          tableWidth: tableMap.width,
          tableNodePos: table.pos,
          renderers,
        };
      },
    },
    props: {
      decorations(state) {
        return (TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY.getState(state) as TableColumnDragHandlePluginState | undefined)
          ?.decorations;
      },
    },
    destroy() {
      // Clean up all renderers when plugin is destroyed
      const state =
        editor.state &&
        (TABLE_COLUMN_DRAG_HANDLE_PLUGIN_KEY.getState(editor.state) as TableColumnDragHandlePluginState | undefined);
      state?.renderers?.forEach((renderer: ReactRenderer) => {
        try {
          renderer.destroy();
        } catch (error) {
          console.error("Error destroying renderer:", error);
        }
      });
    },
  });
