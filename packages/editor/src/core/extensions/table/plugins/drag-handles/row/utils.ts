/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Row-axis (Y-axis) geometry and drag-preview helpers used exclusively by the
 * row drag-handle component (`./drag-handle.tsx`) in this folder.
 *
 * Cross-axis-shared helpers (cell cloning, the detached drag-preview `<table>`
 * wrapper, and cell-content hide/show via the drag-state plugin) live in
 * `../utils.ts` (parent folder); this module extends those with row-specific
 * pixel geometry measurement and preview construction. It is a deliberate
 * near-mirror of the column counterpart `../column/utils.ts`: keeping per-axis
 * math in symmetric subfolders makes it visible at a glance. To translate
 * between the two, substitute `top`/`height` for `left`/`width` and
 * `tableMap.map[row * tableMap.width]` for `tableMap.map[col]`.
 *
 * Public surface:
 * - {@link getTableRowNodesInfo} — per-row pixel geometry (offset-top + height).
 * - {@link calculateRowDropIndex} — pointer-position → drop-target row index.
 * - {@link constructRowDragPreview} — detached `<table>` shown beside the
 *   pointer during a row drag, built from the active cell selection.
 */

import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
// extensions
import { getSelectedRect, isCellSelection } from "@/extensions/table/table/utilities/helpers";
import type { TableNodeLocation } from "@/extensions/table/table/utilities/helpers";
// local imports
import { cloneTableCell, constructDragPreviewTable, getSelectedCellPositions, hideCellContent } from "../utils";

/**
 * Per-row pixel geometry returned by {@link getTableRowNodesInfo}.
 *
 * `top` is the pixel offset of the row from the table's top edge; `height`
 * is the row's rendered pixel height. Consumed by {@link calculateRowDropIndex}
 * for Y-axis pointer math and by the row drag-handle component for drag/drop
 * marker placement.
 */
type TableRow = {
  top: number;
  height: number;
};

/**
 * Convert a dragged row's pointer-derived top position into a stable insertion
 * index suitable for `moveSelectedRows(..., to)`.
 *
 * Edge-case behavior:
 * - First row dragging up — returns `row` unchanged (no-op).
 * - Last row dragging down — returns `row` unchanged (no-op).
 * - Dragging up past the first row's top edge — drops at index `0`.
 * - Dragging down past the last row's bottom edge — drops at `rows.length - 1`.
 * - Otherwise the hovered row is selected by comparing the dragged row's edge
 *   against the centers of neighboring rows. The half-row hysteresis is
 *   deliberate: it prevents flicker when the pointer sits exactly between two
 *   rows.
 *
 * @param row Source row index — the row currently being dragged.
 * @param rows Measured row geometry from {@link getTableRowNodesInfo}.
 * @param top Current pointer-derived top position of the dragged row, in pixels.
 * @returns Integer index in `[0, rows.length)` for the drop target.
 */
export const calculateRowDropIndex = (row: number, rows: TableRow[], top: number): number => {
  const currentRowTop = rows[row].top;
  const currentRowBottom = currentRowTop + rows[row].height;

  const draggedRowTop = top;
  const draggedRowBottom = draggedRowTop + rows[row].height;

  const isDraggingUp = draggedRowTop < currentRowTop;
  const isDraggingDown = draggedRowBottom > currentRowBottom;

  const isFirstRow = row === 0;
  const isLastRow = row === rows.length - 1;

  if ((isFirstRow && isDraggingUp) || (isLastRow && isDraggingDown)) {
    return row;
  }

  const firstRow = rows[0];
  if (isDraggingUp && draggedRowTop <= firstRow.top) {
    return 0;
  }

  const lastRow = rows[rows.length - 1];
  if (isDraggingDown && draggedRowBottom >= lastRow.top + lastRow.height) {
    return rows.length - 1;
  }

  let dropRowIndex = row;
  if (isDraggingDown) {
    const findHoveredRow = rows.find((p, index) => {
      if (index === row) return false;
      const currentRowCenter = p.top + p.height / 2;
      const currentRowEdge = p.top + p.height;
      const nextRow = rows[index + 1] as TableRow | undefined;
      const nextRowCenter = nextRow ? nextRow.height / 2 : 0;

      return draggedRowBottom >= currentRowCenter && draggedRowBottom < currentRowEdge + nextRowCenter;
    });
    if (findHoveredRow) {
      dropRowIndex = rows.indexOf(findHoveredRow);
    }
  }

  if (isDraggingUp) {
    const findHoveredRow = rows.find((p, index) => {
      if (index === row) return false;
      const currentRowCenter = p.top + p.height / 2;
      const prevRow = rows[index - 1] as TableRow | undefined;
      const prevRowTop = prevRow ? prevRow.top : 0;
      const prevRowCenter = prevRow ? prevRow.height / 2 : 0;

      return draggedRowTop <= currentRowCenter && draggedRowTop > prevRowTop + prevRowCenter;
    });
    if (findHoveredRow) {
      dropRowIndex = rows.indexOf(findHoveredRow);
    }
  }

  return dropRowIndex;
};

/**
 * Measure each row's DOM offset-top and height in pixels for drag calculations.
 *
 * Walks the table via `TableMap.get(table.node)` and resolves the FIRST cell
 * of each row (`tableMap.map[row * tableMap.width]`) through
 * `editor.view.domAtPos(...)`, reading `offsetHeight` directly off that
 * `<td>`/`<th>`. The first cell's height is a safe proxy for the whole row's
 * height because cells within a single HTML table row share the same rendered
 * height. Returns an empty array when the table map is missing or has zero
 * rows/columns, and skips any row whose first cell position resolves to
 * `undefined`.
 *
 * @param table Active table node location resolved from the current selection.
 * @param editor Tiptap editor instance (used for `view.domAtPos`).
 * @returns Per-row pixel geometry, in row order, consumed by
 * {@link calculateRowDropIndex} and drag-marker placement.
 */
export const getTableRowNodesInfo = (table: TableNodeLocation, editor: Editor): TableRow[] => {
  const result: TableRow[] = [];
  let topPx = 0;

  const tableMap = TableMap.get(table.node);
  if (!tableMap || tableMap.height === 0 || tableMap.width === 0) {
    return result;
  }

  for (let row = 0; row < tableMap.height; row++) {
    const cellPos = tableMap.map[row * tableMap.width];
    if (cellPos === undefined) continue;
    const dom = editor.view.domAtPos(table.start + cellPos);
    if (dom.node instanceof HTMLElement) {
      const heightPx = dom.node.offsetHeight;
      result.push({
        top: topPx,
        height: heightPx,
      });
      topPx += heightPx;
    }
  }
  return result;
};

/**
 * Build the detached preview `<table>` shown beside the pointer during a row
 * drag — a pseudo row constructed from the active selected row's cells.
 *
 * Returns `undefined` early when `selection` is not a `CellSelection`.
 * Otherwise uses `TableMap.get(table.node)` + `getSelectedRect(...)` +
 * `tableMap.cellsInRect(...)` to enumerate the selected cells, wraps them in
 * a detached `<table><tbody>` produced by `constructDragPreviewTable()` (from
 * `../utils.ts`), and for each cell clones the source `<td>` via
 * `cloneTableCell(...)` (forces visibility and strips ProseMirror widget
 * nodes), applying the source cell's measured width so the preview visually
 * matches the source.
 *
 * Cleanup contract: this call also invokes `hideCellContent(editor, ...)`
 * (from `../utils.ts`) to mark the source cells as hidden via the drag-state
 * plugin so the editor view does not show duplicate visuals. The caller is
 * responsible for mounting the returned element to the DOM and MUST call
 * `showCellContent(editor)` at drag end to restore the source cells —
 * forgetting this leaves the cells visually hidden.
 *
 * @param editor Tiptap editor instance.
 * @param selection Current selection (must be a `CellSelection` to produce output).
 * @param table Active table node location.
 * @returns Detached preview `<table>` element, or `undefined` when the
 * selection is not a cell selection.
 */
export const constructRowDragPreview = (
  editor: Editor,
  selection: Selection,
  table: TableNodeLocation
): HTMLElement | undefined => {
  if (!isCellSelection(selection)) return;

  const tableMap = TableMap.get(table.node);
  const selectedRowRect = getSelectedRect(selection, tableMap);
  const activeRowCells = tableMap.cellsInRect(selectedRowRect);

  const { tableElement, tableBodyElement } = constructDragPreviewTable();

  const tableRowElement = document.createElement("tr");
  tableBodyElement.appendChild(tableRowElement);

  activeRowCells.forEach((cellPos) => {
    const resolvedCellPos = table.start + cellPos + 1;
    const cellElement = editor.view.domAtPos(resolvedCellPos).node;
    if (cellElement instanceof HTMLElement) {
      const { clonedCellElement } = cloneTableCell(cellElement);
      clonedCellElement.style.width = cellElement.getBoundingClientRect().width + "px";
      tableRowElement.appendChild(clonedCellElement);
    }
  });

  // Hide the selected cells using decorations (local only, not persisted)
  const cellPositions = getSelectedCellPositions(selection, table);
  hideCellContent(editor, cellPositions);

  return tableElement;
};
