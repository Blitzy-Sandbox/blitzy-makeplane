/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane-specific row-deletion command for the `Table` extension —
 * symmetric to `./delete-column.ts`.
 *
 * MUTATES editor state via dispatch — delegates to either `deleteRow`
 * (when more than one row remains) or `deleteTable` (when only one row
 * remains) from `@tiptap/pm/tables`.
 *
 * Bound to the `deleteRow` command in `../table.ts` (line 162).
 */

import type { Command } from "@tiptap/core";
import { deleteRow, deleteTable } from "@tiptap/pm/tables";
// local imports
import { isCellSelection } from "./helpers";

/**
 * Delete the currently-selected row, or the entire table when only one
 * row would remain.
 *
 * Input (via the returned `Command`'s `(state, dispatch)` call):
 *   - `state.selection` MUST be a `CellSelection` (returns `false`
 *     otherwise).
 *
 * Output:
 *   - `true` on successful row or table deletion.
 *   - `false` when the selection isn't a `CellSelection` or when no
 *     table can be resolved at the selection's anchor.
 *
 * WHY a custom utility (symmetric to `./delete-column.ts`):
 *   Upstream's `deleteRow` leaves a zero-row table behind. This wrapper
 *   counts rows via `selectedTable.childCount` and delegates to
 *   `deleteTable` when `totalRows === 1` so the user-visible result
 *   matches user intent.
 */
export const deleteRowOrTable: () => Command =
  () =>
  ({ state, dispatch }) => {
    const { selection } = state;

    // Check if we're in a ProseMirrorTable and have a cell selection
    if (!isCellSelection(selection)) {
      return false;
    }

    // Get the ProseMirrorTable and calculate total rows
    const tableStart = selection.$anchorCell.start(-1);
    const selectedTable = state.doc.nodeAt(tableStart - 1);

    if (!selectedTable) return false;

    // Count total rows by examining the table's children
    const totalRows = selectedTable.childCount;

    // If only one row exists, delete the entire ProseMirrorTable
    if (totalRows === 1) {
      return deleteTable(state, dispatch);
    }

    // Otherwise, proceed with normal row deletion
    return deleteRow(state, dispatch);
  };
