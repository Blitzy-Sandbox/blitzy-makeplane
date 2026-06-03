/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Drag-handle and dropdown action handlers for ProseMirror table restructuring.
 *
 * Owns the table-restructuring operations triggered by drag-handle drops
 * (`moveSelectedColumns`, `moveSelectedRows`) and dropdown "duplicate" actions
 * (`duplicateRows`, `duplicateColumns`).
 *
 * Canonical strategy: every restructuring operation round-trips the table through a
 * sparse cell matrix (`tableToCells` → reorder/duplicate → `tableFromCells`) so
 * merged-cell structure (colspan/rowspan) is preserved automatically. Manipulating
 * ProseMirror table nodes in place would require hand-rolling colspan/rowspan
 * mutation, which is error-prone; the matrix round-trip instead lets the schema's
 * `tableRow.create` recompute the merged structure naturally from the surviving
 * cell node attrs.
 *
 * Consumers (siblings under the same `drag-handles/` folder):
 *  - `column/drag-handle.tsx` → `moveSelectedColumns`
 *  - `row/drag-handle.tsx`    → `moveSelectedRows`
 *  - `column/dropdown.tsx`    → `duplicateColumns`
 *  - `row/dropdown.tsx`       → `duplicateRows`
 *
 * All four exports accept and mutate a `tr: Transaction`; the caller is responsible
 * for dispatching the transaction on the editor view.
 */

import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import type { Node, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { CellSelection } from "@tiptap/pm/tables";
// extensions
import type { TableNodeLocation } from "@/extensions/table/table/utilities/helpers";

/**
 * Sparse row representation: one entry per logical column, with `null` filling
 * slots already covered by a merged cell from a previous column or row.
 *
 * `TableRows` is the matrix `TableRow[]`; this sparse matrix shape is what
 * enables merged-cell-safe reconstruction in `tableFromCells` (see module-level
 * JSDoc for the round-trip rationale).
 */
type TableRow = (ProseMirrorNode | null)[];
type TableRows = TableRow[];

/**
 * Move the contiguous range of selected columns to a new column index, preserving
 * merged-cell structure via the `tableToCells` → reorder → `tableFromCells`
 * round-trip.
 *
 * Validation (returns `tr` unchanged on rejection):
 *  - No `CellSelection` columns walked (columnStart/columnEnd remain `-1`).
 *  - `to` is out of range (`< 0` or `> tableMap.width`).
 *  - `to` falls within the source range `[columnStart, columnEnd)`.
 *
 * Algorithm:
 *  1. Walk `selection.forEachCell` and compute the contiguous column bounds
 *     `[columnStart, columnEnd)` via `TableMap.findCell(...)`.
 *  2. `tableToCells(table)` produces the sparse cell matrix.
 *  3. For each row, splice out the column range and re-insert at an offset
 *     adjusted for movement direction (rightward moves shift by the range width).
 *  4. `tableFromCells` rebuilds the table node and replaces it in `tr`.
 *
 * Preserves merged cells: colspan/rowspan reconstruction is delegated to the
 * schema via the matrix round-trip — no in-place colspan/rowspan math.
 *
 * @param {Editor} editor - The editor instance (used to read `editor.schema.nodes`).
 * @param {TableNodeLocation} table - The table node location (`pos`/`start`/`node`).
 * @param {CellSelection} selection - The active cell selection providing the column range.
 * @param {number} to - Destination column index (must be in `[0, tableMap.width]` and outside the source range).
 * @param {Transaction} tr - Transaction to mutate.
 * @returns {Transaction} The same `tr`, with the table replacement step appended (or unchanged on rejection).
 */
export const moveSelectedColumns = (
  editor: Editor,
  table: TableNodeLocation,
  selection: CellSelection,
  to: number,
  tr: Transaction
): Transaction => {
  const tableMap = TableMap.get(table.node);

  let columnStart = -1;
  let columnEnd = -1;

  selection.forEachCell((_node, pos) => {
    const cell = tableMap.findCell(pos - table.pos - 1);
    for (let i = cell.left; i < cell.right; i++) {
      columnStart = columnStart >= 0 ? Math.min(cell.left, columnStart) : cell.left;
      columnEnd = columnEnd >= 0 ? Math.max(cell.right, columnEnd) : cell.right;
    }
  });

  if (columnStart === -1 || columnEnd === -1) {
    console.warn("Invalid column selection");
    return tr;
  }

  if (to < 0 || to > tableMap.width || (to >= columnStart && to < columnEnd)) return tr;

  const rows = tableToCells(table);
  for (const row of rows) {
    const range = row.splice(columnStart, columnEnd - columnStart);
    const offset = to > columnStart ? to - (columnEnd - columnStart - 1) : to;
    row.splice(offset, 0, ...range);
  }

  tableFromCells(editor, table, rows, tr);
  return tr;
};

/**
 * Move the contiguous range of selected rows to a new row index, preserving
 * merged-cell structure via the `tableToCells` → reorder → `tableFromCells`
 * round-trip.
 *
 * Validation (returns `tr` unchanged on rejection):
 *  - No `CellSelection` rows walked (rowStart/rowEnd remain `-1`).
 *  - `to` is out of range (`< 0` or `> tableMap.height`).
 *  - `to` falls within the source range `[rowStart, rowEnd)`.
 *
 * Algorithm:
 *  1. Walk `selection.forEachCell` and compute the contiguous row bounds
 *     `[rowStart, rowEnd)` via `TableMap.findCell(...).top/bottom`.
 *  2. `tableToCells(table)` produces the sparse cell matrix.
 *  3. Splice the rows array directly (rows are first-class; no per-row loop
 *     needed) and re-insert at an offset adjusted for movement direction.
 *  4. `tableFromCells` rebuilds the table node and replaces it in `tr`.
 *
 * Preserves merged cells: colspan/rowspan reconstruction is delegated to the
 * schema via the matrix round-trip — no in-place colspan/rowspan math.
 *
 * @param {Editor} editor - The editor instance (used to read `editor.schema.nodes`).
 * @param {TableNodeLocation} table - The table node location (`pos`/`start`/`node`).
 * @param {CellSelection} selection - The active cell selection providing the row range.
 * @param {number} to - Destination row index (must be in `[0, tableMap.height]` and outside the source range).
 * @param {Transaction} tr - Transaction to mutate.
 * @returns {Transaction} The same `tr`, with the table replacement step appended (or unchanged on rejection).
 */
export const moveSelectedRows = (
  editor: Editor,
  table: TableNodeLocation,
  selection: CellSelection,
  to: number,
  tr: Transaction
): Transaction => {
  const tableMap = TableMap.get(table.node);

  let rowStart = -1;
  let rowEnd = -1;

  selection.forEachCell((_node, pos) => {
    const cell = tableMap.findCell(pos - table.pos - 1);
    for (let i = cell.top; i < cell.bottom; i++) {
      rowStart = rowStart >= 0 ? Math.min(cell.top, rowStart) : cell.top;
      rowEnd = rowEnd >= 0 ? Math.max(cell.bottom, rowEnd) : cell.bottom;
    }
  });

  if (rowStart === -1 || rowEnd === -1) {
    console.warn("Invalid row selection");
    return tr;
  }

  if (to < 0 || to > tableMap.height || (to >= rowStart && to < rowEnd)) return tr;

  const rows = tableToCells(table);
  const range = rows.splice(rowStart, rowEnd - rowStart);
  const offset = to > rowStart ? to - (rowEnd - rowStart - 1) : to;
  rows.splice(offset, 0, ...range);

  tableFromCells(editor, table, rows, tr);
  return tr;
};

/**
 * Duplicate one or more rows in place, inserting the copies immediately AFTER the
 * last index in `rowIndices`.
 *
 * Inputs: an explicit `rowIndices` array — duplication is NOT derived from the
 * current selection. The caller resolves selection to indices first (see
 * `row/dropdown.tsx`, which reads `TableMap` to produce indices).
 *
 * Validation (returns `tr` unchanged on rejection):
 *  - Any index `< 0` or `> maxRow` (where `maxRow = rows.length - 1`).
 *
 * Algorithm:
 *  1. `tableToCells(table)` produces the sparse cell matrix.
 *  2. Read `TableMap` for `map` (cell-position lookup) and `width`.
 *  3. Compute the post-last-row insert position (`lastRowPos + nodeSize + 1`) and
 *     map it through `tr.mapping` so subsequent mapping events stay aligned.
 *  4. Iterate `rowIndices` in REVERSE order and `tr.insert` each row at the same
 *     `insertPos`, filtering out `null` placeholders so the schema only receives
 *     real cell nodes.
 *
 * Why reverse iteration: each `tr.insert` shifts subsequent positions; iterating
 * in reverse keeps the precomputed `insertPos` valid for every iteration without
 * remapping per-iteration.
 *
 * @param {TableNodeLocation} table - The table node location.
 * @param {number[]} rowIndices - Row indices to duplicate (validated against `rows.length`).
 * @param {Transaction} tr - Transaction to mutate.
 * @returns {Transaction} The same `tr`, with insert steps appended (or unchanged on rejection).
 */
export const duplicateRows = (table: TableNodeLocation, rowIndices: number[], tr: Transaction): Transaction => {
  const rows = tableToCells(table);

  const { map, width } = TableMap.get(table.node);

  // Validate row indices
  const maxRow = rows.length - 1;
  if (rowIndices.some((idx) => idx < 0 || idx > maxRow)) {
    console.warn("Invalid row indices for duplication");
    return tr;
  }

  const mapStart = tr.mapping.maps.length;

  const lastRowPos = map[rowIndices[rowIndices.length - 1] * width + width - 1];
  const nextRowStart = lastRowPos + (table.node.nodeAt(lastRowPos)?.nodeSize ?? 0) + 1;
  const insertPos = tr.mapping.slice(mapStart).map(table.start + nextRowStart);

  for (let i = rowIndices.length - 1; i >= 0; i--) {
    tr.insert(
      insertPos,
      rows[rowIndices[i]].filter((r) => r !== null)
    );
  }

  return tr;
};

/**
 * Duplicate one or more columns in place; for each existing row, the duplicate
 * column cells are inserted immediately AFTER the source column position.
 *
 * Inputs: an explicit `columnIndices` array — duplication is NOT derived from
 * the current selection. The caller resolves selection to indices first (see
 * `column/dropdown.tsx`).
 *
 * Validation (returns `tr` unchanged on rejection):
 *  - Any index `< 0` or `>= width`.
 *
 * Algorithm:
 *  1. `tableToCells(table)` produces the sparse cell matrix.
 *  2. Read `TableMap` for `map`, `width`, `height`.
 *  3. For each row, compute the post-source-column insert position through
 *     `tr.mapping` (one `insertPos` per row, because columns sit at row-relative
 *     positions in the document).
 *  4. Insert column cells in REVERSE `columnIndices` order; skip `null` cells
 *     (merged-into slots) so no empty inserts are emitted.
 *
 * Why reverse iteration: identical rationale to `duplicateRows` — keeps the
 * per-row `insertPos` valid as inserts shift positions.
 *
 * @param {TableNodeLocation} table - The table node location.
 * @param {number[]} columnIndices - Column indices to duplicate (validated against `width`).
 * @param {Transaction} tr - Transaction to mutate.
 * @returns {Transaction} The same `tr`, with insert steps appended (or unchanged on rejection).
 */
export const duplicateColumns = (table: TableNodeLocation, columnIndices: number[], tr: Transaction): Transaction => {
  const rows = tableToCells(table);

  const { map, width, height } = TableMap.get(table.node);

  // Validate column indices
  if (columnIndices.some((idx) => idx < 0 || idx >= width)) {
    console.warn("Invalid column indices for duplication");
    return tr;
  }

  const mapStart = tr.mapping.maps.length;

  for (let row = 0; row < height; row++) {
    const lastColumnPos = map[row * width + columnIndices[columnIndices.length - 1]];
    const nextColumnStart = lastColumnPos + (table.node.nodeAt(lastColumnPos)?.nodeSize ?? 0);
    const insertPos = tr.mapping.slice(mapStart).map(table.start + nextColumnStart);

    for (let i = columnIndices.length - 1; i >= 0; i--) {
      const copiedNode = rows[row][columnIndices[i]];
      if (copiedNode !== null) {
        tr.insert(insertPos, copiedNode);
      }
    }
  }

  return tr;
};

/**
 * Walk the table node and produce a sparse 2D array (`TableRows`) where each
 * merged cell occupies its "primary" `(row, col)` slot and `null` fills the
 * merged-into slots.
 *
 * Why this representation: the sparse matrix is the architectural heart of
 * merged-cell-safe restructuring — row-splice / column-splice / insert
 * operations can manipulate the matrix without tracking colspan/rowspan, and
 * the inverse `tableFromCells` rebuilds a valid table from the schema using the
 * surviving cell node attrs. This round-trip is what enables `moveSelectedColumns`,
 * `moveSelectedRows`, `duplicateRows`, and `duplicateColumns` to handle merged
 * cells correctly.
 *
 * Implementation note: a `visitedCells` set keyed by absolute document position
 * guarantees the same physical cell node is emitted only once at its primary
 * `(row, col)` position; subsequent visits push `null` to mark the merged-into
 * slot.
 *
 * @param {TableNodeLocation} table - The table node location.
 * @returns {TableRows} The sparse cell matrix (one row per `height`, one slot per `width`).
 */
const tableToCells = (table: TableNodeLocation): TableRows => {
  const { map, width, height } = TableMap.get(table.node);

  const visitedCells = new Set<number>();
  const rows: TableRows = [];
  for (let row = 0; row < height; row++) {
    const cells: (ProseMirrorNode | null)[] = [];
    for (let col = 0; col < width; col++) {
      const pos = map[row * width + col];
      cells.push(!visitedCells.has(pos) ? table.node.nodeAt(pos) : null);
      visitedCells.add(pos);
    }
    rows.push(cells);
  }

  return rows;
};

/**
 * Inverse of `tableToCells`: reconstruct a table node from the sparse cell
 * matrix and replace the existing table in `tr`. Colspan/rowspan information
 * is recovered naturally from the surviving cell node attrs.
 *
 * Implementation:
 *  1. For each row, `schema.tableRow.create(null, row.filter(non-null))` produces
 *     a new row node containing only real cell nodes.
 *  2. The new rows are wrapped in a copy of the original table node
 *     (`table.node.copy(Fragment.from(newRowNodes))`) so table-level attributes
 *     are preserved.
 *  3. `tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTableNode)`
 *     swaps the table in place.
 *
 * Why filter nulls: sparse placeholders must not be passed to `tableRow.create`,
 * which expects real cell nodes. The colspan/rowspan information was already
 * baked into the surviving cell nodes by `tableToCells` (they carry their
 * original `attrs`), so no explicit reconstruction of the merged geometry is
 * needed — this is the closing half of the merged-cell-safe round-trip.
 *
 * @param {Editor} editor - The editor instance (used to read `editor.schema.nodes`).
 * @param {TableNodeLocation} table - The table node location to replace.
 * @param {TableRows} rows - The (possibly reordered/duplicated) sparse cell matrix.
 * @param {Transaction} tr - Transaction to mutate (a `replaceWith` step is appended).
 * @returns {void}
 */
const tableFromCells = (editor: Editor, table: TableNodeLocation, rows: TableRows, tr: Transaction): void => {
  const schema = editor.schema.nodes;
  const newRowNodes = rows.map((row) =>
    schema.tableRow.create(null, row.filter((cell) => cell !== null) as readonly Node[])
  );
  const newTableNode = table.node.copy(Fragment.from(newRowNodes));
  tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTableNode);
};
