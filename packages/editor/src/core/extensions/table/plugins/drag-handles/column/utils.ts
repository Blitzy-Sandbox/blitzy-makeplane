/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Column-axis (X-axis) geometry and drag-preview helpers used exclusively by
 * the column drag-handle component (`./drag-handle.tsx`) in this folder.
 *
 * Cross-axis-shared helpers (cell cloning, the detached drag-preview `<table>`
 * wrapper, and cell-content hide/show via the drag-state plugin) live in
 * `../utils.ts` (parent folder); this module extends those with column-specific
 * pixel geometry measurement and preview construction. It is a deliberate
 * near-mirror of the row counterpart `../row/utils.ts`: keeping per-axis math
 * in symmetric subfolders makes it visible at a glance. To translate between
 * the two, substitute `left`/`width` for `top`/`height` and `tableMap.map[col]`
 * for `tableMap.map[row * tableMap.width]`.
 *
 * Public surface:
 * - {@link getTableColumnNodesInfo} — per-column pixel geometry (offset-left + width).
 * - {@link calculateColumnDropIndex} — pointer-position → drop-target column index.
 * - {@link constructColumnDragPreview} — detached `<table>` shown beside the
 *   pointer during a column drag, built from the active cell selection.
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
 * Per-column pixel geometry returned by {@link getTableColumnNodesInfo}.
 *
 * `left` is the pixel offset of the column from the table's left edge; `width`
 * is the column's rendered pixel width. Consumed by {@link calculateColumnDropIndex}
 * for X-axis pointer math and by the column drag-handle component for drag/drop
 * marker placement.
 */
type TableColumn = {
  left: number;
  width: number;
};

/**
 * Convert a dragged column's pointer-derived left position into a stable
 * insertion index suitable for `moveSelectedColumns(..., to)`.
 *
 * Edge-case behavior:
 * - First column dragging left — returns `col` unchanged (no-op).
 * - Last column dragging right — returns `col` unchanged (no-op).
 * - Dragging left past the first column's left edge — drops at index `0`.
 * - Dragging right past the last column's right edge — drops at `columns.length - 1`.
 * - Otherwise the hovered column is selected by comparing the dragged column's
 *   edge against the centers of neighboring columns. The half-column hysteresis
 *   is deliberate: it prevents flicker when the pointer sits exactly between
 *   two columns.
 *
 * @param col Source column index — the column currently being dragged.
 * @param columns Measured column geometry from {@link getTableColumnNodesInfo}.
 * @param left Current pointer-derived left position of the dragged column, in pixels.
 * @returns Integer index in `[0, columns.length)` for the drop target.
 */
export const calculateColumnDropIndex = (col: number, columns: TableColumn[], left: number): number => {
  const currentColumnLeft = columns[col].left;
  const currentColumnRight = currentColumnLeft + columns[col].width;

  const draggedColumnLeft = left;
  const draggedColumnRight = draggedColumnLeft + columns[col].width;

  const isDraggingToLeft = draggedColumnLeft < currentColumnLeft;
  const isDraggingToRight = draggedColumnRight > currentColumnRight;

  const isFirstColumn = col === 0;
  const isLastColumn = col === columns.length - 1;

  if ((isFirstColumn && isDraggingToLeft) || (isLastColumn && isDraggingToRight)) {
    return col;
  }

  const firstColumn = columns[0];
  if (isDraggingToLeft && draggedColumnLeft <= firstColumn.left) {
    return 0;
  }

  const lastColumn = columns[columns.length - 1];
  if (isDraggingToRight && draggedColumnRight >= lastColumn.left + lastColumn.width) {
    return columns.length - 1;
  }

  let dropColumnIndex = col;
  if (isDraggingToRight) {
    const findHoveredColumn = columns.find((p, index) => {
      if (index === col) return false;
      const currentColumnCenter = p.left + p.width / 2;
      const currentColumnEdge = p.left + p.width;
      const nextColumn = columns[index + 1] as TableColumn | undefined;
      const nextColumnCenter = nextColumn ? nextColumn.width / 2 : 0;

      return draggedColumnRight >= currentColumnCenter && draggedColumnRight < currentColumnEdge + nextColumnCenter;
    });
    if (findHoveredColumn) {
      dropColumnIndex = columns.indexOf(findHoveredColumn);
    }
  }

  if (isDraggingToLeft) {
    const findHoveredColumn = columns.find((p, index) => {
      if (index === col) return false;
      const currentColumnCenter = p.left + p.width / 2;
      const prevColumn = columns[index - 1] as TableColumn | undefined;
      const prevColumnLeft = prevColumn ? prevColumn.left : 0;
      const prevColumnCenter = prevColumn ? prevColumn.width / 2 : 0;

      return draggedColumnLeft <= currentColumnCenter && draggedColumnLeft > prevColumnLeft + prevColumnCenter;
    });
    if (findHoveredColumn) {
      dropColumnIndex = columns.indexOf(findHoveredColumn);
    }
  }

  return dropColumnIndex;
};

/**
 * Measure each column's DOM offset-left and width in pixels for drag calculations.
 *
 * Walks the table via `TableMap.get(table.node)` and resolves the FIRST cell
 * of each column (`tableMap.map[col]`) through `editor.view.domAtPos(...)`,
 * reading `offsetLeft` and `offsetWidth` directly off that `<td>`/`<th>`. The
 * first cell's width is a safe proxy for the whole column's width because
 * cells within a single HTML table column share the same rendered width.
 * The first column's `offsetLeft` is subtracted from subsequent columns so
 * the returned coordinates are relative to the table's left edge, not the
 * document — without this subtraction, drag math would be polluted by
 * document-level offsets (page scroll, container padding). Returns an empty
 * array when the table map is missing or has zero rows/columns, and skips
 * any column whose first cell position resolves to `undefined`.
 *
 * @param table Active table node location resolved from the current selection.
 * @param editor Tiptap editor instance (used for `view.domAtPos`).
 * @returns Per-column pixel geometry, in column order, consumed by
 * {@link calculateColumnDropIndex} and drag-marker placement.
 */
export const getTableColumnNodesInfo = (table: TableNodeLocation, editor: Editor): TableColumn[] => {
  const result: TableColumn[] = [];
  let leftPx = 0;

  const tableMap = TableMap.get(table.node);
  if (!tableMap || tableMap.height === 0 || tableMap.width === 0) {
    return result;
  }

  for (let col = 0; col < tableMap.width; col++) {
    const cellPos = tableMap.map[col];
    if (cellPos === undefined) continue;

    const dom = editor.view.domAtPos(table.start + cellPos + 1);
    if (dom.node instanceof HTMLElement) {
      if (col === 0) {
        leftPx = dom.node.offsetLeft;
      }
      result.push({
        left: dom.node.offsetLeft - leftPx,
        width: dom.node.offsetWidth,
      });
    }
  }
  return result;
};

/**
 * Build the detached preview `<table>` shown beside the pointer during a
 * column drag — a pseudo column constructed from the active selected column's
 * cells.
 *
 * Returns `undefined` early when `selection` is not a `CellSelection`.
 * Otherwise uses `TableMap.get(table.node)` + `getSelectedRect(...)` +
 * `tableMap.cellsInRect(...)` to enumerate the selected cells, wraps them in
 * a detached `<table><tbody>` produced by `constructDragPreviewTable()` (from
 * `../utils.ts`), and for each cell clones the source `<td>` via
 * `cloneTableCell(...)` (forces visibility and strips ProseMirror widget
 * nodes), applying the source cell's measured height so the preview visually
 * matches the source. Each clone is wrapped in its own fresh `<tr>` because
 * the column preview stacks cells vertically — one cell per row of the
 * preview — which is the axis-specific difference from the row preview that
 * places all cloned cells inside a single shared `<tr>`.
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
export const constructColumnDragPreview = (
  editor: Editor,
  selection: Selection,
  table: TableNodeLocation
): HTMLElement | undefined => {
  if (!isCellSelection(selection)) return;

  const tableMap = TableMap.get(table.node);
  const selectedColRect = getSelectedRect(selection, tableMap);
  const activeColCells = tableMap.cellsInRect(selectedColRect);

  const { tableElement, tableBodyElement } = constructDragPreviewTable();

  activeColCells.forEach((cellPos) => {
    const resolvedCellPos = table.start + cellPos + 1;
    const cellElement = editor.view.domAtPos(resolvedCellPos).node;
    if (cellElement instanceof HTMLElement) {
      const { clonedCellElement } = cloneTableCell(cellElement);
      clonedCellElement.style.height = cellElement.getBoundingClientRect().height + "px";
      const tableRowElement = document.createElement("tr");
      tableRowElement.appendChild(clonedCellElement);
      tableBodyElement.appendChild(tableRowElement);
    }
  });

  // Hide the selected cells using decorations (local only, not persisted)
  const cellPositions = getSelectedCellPositions(selection, table);
  hideCellContent(editor, cellPositions);

  return tableElement;
};
