/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-aware table constructor for the Plane editor.
 *
 * PURE — no editor state mutation, no transaction dispatch. Returns a
 * detached ProseMirror table node ready to be inserted via
 * `tr.replaceSelectionWith(node)` or any other transaction primitive.
 *
 * Called by the `insertTable` command in `../table.ts` (line 128) with
 * `columnWidth: DEFAULT_COLUMN_WIDTH` so freshly-inserted tables have
 * deterministic column widths from the moment they land in the document.
 */

import type { Fragment, Node as ProsemirrorNode, Schema } from "@tiptap/pm/model";
// extensions
import { createCell } from "@/extensions/table/table/utilities/create-cell";
import { getTableNodeTypes } from "@/extensions/table/table/utilities/get-table-node-types";

type Props = {
  schema: Schema;
  rowsCount: number;
  colsCount: number;
  withHeaderRow: boolean;
  cellContent?: Fragment | ProsemirrorNode | Array<ProsemirrorNode>;
  columnWidth: number;
};

/**
 * Build a fresh table node with the given dimensions and optional header
 * row.
 *
 * Input (`Props`):
 *   - `schema` (`Schema`): the active document schema — used to resolve
 *     `tableRole`-tagged node types via `getTableNodeTypes(schema)`.
 *   - `rowsCount` / `colsCount` (`number`): table dimensions.
 *   - `withHeaderRow` (`boolean`): when `true`, the first row uses
 *     `header_cell` nodes instead of `cell` nodes.
 *   - `cellContent` (optional): content for each cell. If omitted, every
 *     cell is filled with the schema's default (typically a single empty
 *     paragraph).
 *   - `columnWidth` (`number`): the `colwidth` value seeded into every
 *     cell's `colwidth: [columnWidth]` attribute array. Callers in
 *     `../table.ts` pass `DEFAULT_COLUMN_WIDTH` (150).
 *
 * Output:
 *   - A schema-validated `ProsemirrorNode` (the new `tableRole: "table"`
 *     node). `createChecked` throws if the assembled rows don't satisfy
 *     the table's content expression.
 *
 * WHY a local utility (vs the upstream `createTable` from
 * `@tiptap/pm/tables`):
 *   The upstream helper exists but hardcodes its own schema's node names.
 *   This version routes node resolution through
 *   `getTableNodeTypes(schema)`, which scans the schema for `tableRole`-
 *   tagged nodes — keeping the utility schema-agnostic so it works with
 *   any schema that registers Plane's table primitives, not just the
 *   default Plane schema.
 */
export const createTable = (props: Props): ProsemirrorNode => {
  const { schema, rowsCount, colsCount, withHeaderRow, cellContent, columnWidth } = props;

  const types = getTableNodeTypes(schema);
  const headerCells: ProsemirrorNode[] = [];
  const cells: ProsemirrorNode[] = [];

  for (let index = 0; index < colsCount; index += 1) {
    const cell = createCell(types.cell, cellContent, { colwidth: [columnWidth] });

    if (cell) {
      cells.push(cell);
    }

    if (withHeaderRow) {
      const headerCell = createCell(types.header_cell, cellContent, { colwidth: [columnWidth] });

      if (headerCell) {
        headerCells.push(headerCell);
      }
    }
  }

  const rows: ProsemirrorNode[] = [];

  for (let index = 0; index < rowsCount; index += 1) {
    rows.push(types.row.createChecked(null, withHeaderRow && index === 0 ? headerCells : cells));
  }

  return types.table.createChecked(null, rows);
};
