/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pure geometry layer for the table-cell selection-outline plugin (`./plugin.ts`).
 *
 * Answers a single question: given a cell's start position, the set of currently-selected
 * cells, and the parent table's `TableMap`, which CSS border classes —
 * `selectedCell-border-{right|left|top|bottom}` — should be applied so that ONLY the
 * exterior perimeter of the multi-cell selection is outlined? Internal borders between
 * adjacent selected cells are deliberately suppressed so the rendered outline reads as
 * one contiguous shape rather than a grid drawn over every selected cell.
 *
 * Purity contract: no side effects and no editor / ProseMirror state coupling — the
 * helpers depend only on their arguments and are therefore unit-testable in isolation.
 *
 * Consumer: this file is consumed exclusively by `./plugin.ts`; no other plugin reads
 * these helpers.
 *
 * Styling contract: the `selectedCell-border-{top|left|bottom|right}` class names are a
 * styling contract owned by this folder (see `packages/editor/src/styles/table.css` for
 * the corresponding `::after` rules). A stylesheet author tracing where these classes
 * are emitted can grep for them in this module.
 */

import type { TableMap } from "@tiptap/pm/tables";

/**
 * Translates a cell's document start position into the start positions of its four
 * neighbors — `top`, `bottom`, `left`, `right` — within the same table.
 *
 * Algorithm: locates `cellStart` inside the row-major `tableMap.map` array, converts the
 * linear index into `(row, col)` coordinates using `tableMap.width`, then resolves each
 * neighbor by stepping one row or column away and bounds-checking against
 * `tableMap.width` / `tableMap.height`. Step-by-step mechanics live in the inline
 * comments below.
 *
 * Edge cases:
 *   - At a table edge (column 0 → no `left`, row 0 → no `top`, final column → no
 *     `right`, final row → no `bottom`), the corresponding field is `undefined`.
 *   - If `cellStart` is not found anywhere in `tableMap.map` (caller passed a stale or
 *     invalid position), the function returns an empty object `{}`. Every field is then
 *     `undefined` by absence, which lets `getCellBorderClasses` fall through to its
 *     "outline all four sides" default without throwing — this is a deliberate
 *     defensive guard, not dead code.
 *
 * Purity: no mutations; depends only on the supplied arguments.
 *
 * @param cellStart - The cell's document start position (the relative offset used as a
 *   key into `tableMap.map`, computed by the consumer as `pos - table.pos - 1`).
 * @param tableMap - The parent table's `TableMap` from `@tiptap/pm/tables`, providing
 *   the row-major adjacency grid.
 * @returns Neighbor start positions; each field is `undefined` at the corresponding
 *   table edge, and the object is empty when `cellStart` is not present in
 *   `tableMap.map`.
 */
const getAdjacentCellPositions = (
  cellStart: number,
  tableMap: TableMap
): { top?: number; bottom?: number; left?: number; right?: number } => {
  // Extract table dimensions
  // width -> number of columns in the table
  // height -> number of rows in the table
  const { width, height } = tableMap;

  // Find the index of our cell in the flat tableMap.map array
  // tableMap.map contains start positions of all cells in row-by-row order
  const cellIndex = tableMap.map.indexOf(cellStart);

  // Safety check: if cell position not found in table map, return empty object
  if (cellIndex === -1) return {};

  // Convert flat array index to 2D grid coordinates
  // row = which row the cell is in (0-based from top)
  // col = which column the cell is in (0-based from left)
  const row = Math.floor(cellIndex / width); // Integer division gives row number
  const col = cellIndex % width; // Remainder gives column number

  return {
    // Top cell: same column, one row up
    // Check if we're not in the first row (row > 0) before calculating
    top: row > 0 ? tableMap.map[(row - 1) * width + col] : undefined,

    // Bottom cell: same column, one row down
    // Check if we're not in the last row (row < height - 1) before calculating
    bottom: row < height - 1 ? tableMap.map[(row + 1) * width + col] : undefined,

    // Left cell: same row, one column left
    // Check if we're not in the first column (col > 0) before calculating
    left: col > 0 ? tableMap.map[row * width + (col - 1)] : undefined,

    // Right cell: same row, one column right
    // Check if we're not in the last column (col < width - 1) before calculating
    right: col < width - 1 ? tableMap.map[row * width + (col + 1)] : undefined,
  };
};

/**
 * Computes the CSS border-class names to apply to a single selected table cell so that
 * only the exterior perimeter of the multi-cell selection is outlined.
 *
 * Rule (the WHY): each of `selectedCell-border-right`, `selectedCell-border-left`,
 * `selectedCell-border-top`, `selectedCell-border-bottom` is emitted ONLY when the
 * neighbor on that side is either (a) missing because this cell is at a table edge or
 * (b) not present in `selectedCells`. This is what suppresses internal borders between
 * adjacent selected cells — the rendered outline reads as one contiguous selection
 * rather than a grid drawn over every selected cell.
 *
 * @param cellStart - The cell's document start position (relative offset, as keyed into
 *   `tableMap.map`).
 * @param selectedCells - Start positions of every currently-selected cell; membership
 *   is checked via `Array.prototype.includes` to decide whether to suppress an internal
 *   border on the corresponding side.
 * @param tableMap - The parent table's `TableMap` from `@tiptap/pm/tables`, used to
 *   resolve neighbor positions through `getAdjacentCellPositions`.
 * @returns The LIST of border-class names (not a joined string). The consumer
 *   (`./plugin.ts`) calls `classes.join(" ")` to populate the `class` attribute of a
 *   `Decoration.node(...)`; keep this helper returning the array so the joining stays
 *   on the consumer side.
 */
export const getCellBorderClasses = (cellStart: number, selectedCells: number[], tableMap: TableMap): string[] => {
  const adjacent = getAdjacentCellPositions(cellStart, tableMap);
  const classes: string[] = [];

  // Add border-right if right cell is not selected or doesn't exist
  if (adjacent.right === undefined || !selectedCells.includes(adjacent.right)) {
    classes.push("selectedCell-border-right");
  }

  // Add border-left if left cell is not selected or doesn't exist
  if (adjacent.left === undefined || !selectedCells.includes(adjacent.left)) {
    classes.push("selectedCell-border-left");
  }

  // Add border-top if top cell is not selected or doesn't exist
  if (adjacent.top === undefined || !selectedCells.includes(adjacent.top)) {
    classes.push("selectedCell-border-top");
  }

  // Add border-bottom if bottom cell is not selected or doesn't exist
  if (adjacent.bottom === undefined || !selectedCells.includes(adjacent.bottom)) {
    classes.push("selectedCell-border-bottom");
  }

  return classes;
};
