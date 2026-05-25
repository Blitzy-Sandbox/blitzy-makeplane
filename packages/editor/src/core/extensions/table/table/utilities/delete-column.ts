/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane-specific column-deletion command for the `Table` extension.
 *
 * MUTATES editor state via dispatch — delegates to either
 * `deleteColumn` (when more than one column remains) or `deleteTable`
 * (when only one column remains) from `@tiptap/pm/tables`.
 *
 * Bound to the `deleteColumn` command in `../table.ts` (line 153).
 */

import type { Command } from "@tiptap/core";
import { deleteColumn, deleteTable } from "@tiptap/pm/tables";
// local imports
import { isCellSelection } from "./helpers";

/**
 * Delete the currently-selected column, or the entire table when only
 * one column would remain.
 *
 * Input (via the returned `Command`'s `(state, dispatch)` call):
 *   - `state.selection` MUST be a `CellSelection` (returns `false`
 *     otherwise so the next handler in the chain can run).
 *
 * Output:
 *   - `true` on successful column or table deletion.
 *   - `false` when the selection isn't a `CellSelection`, when no table
 *     can be resolved at the selection's anchor, or when the table's
 *     first row is empty (defensive guards).
 *
 * WHY a custom utility (vs the upstream `deleteColumn` alone):
 *   Upstream's `deleteColumn` leaves a zero-column table behind when the
 *   last column is removed — semantically empty but visually present.
 *   This wrapper counts the columns in the table's first row (summing
 *   `colspan` to handle merged cells), and when `totalColumns === 1`
 *   delegates to `deleteTable` instead so the user-visible result
 *   matches the user's intent: "delete the only column" means "delete
 *   the table."
 */
export const deleteColumnOrTable: () => Command =
  () =>
  ({ state, dispatch }) => {
    const { selection } = state;

    // Check if we're in a table and have a cell selection
    if (!isCellSelection(selection)) {
      return false;
    }

    // Get the ProseMirrorTable and calculate total columns
    const tableStart = selection.$anchorCell.start(-1);
    const selectedTable = state.doc.nodeAt(tableStart - 1);

    if (!selectedTable) return false;

    // Count total columns by examining the first row
    const firstRow = selectedTable.firstChild;
    if (!firstRow) return false;

    let totalColumns = 0;
    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      totalColumns += cell.attrs.colspan || 1;
    }

    // If only one column exists, delete the entire ProseMirrorTable
    if (totalColumns === 1) {
      return deleteTable(state, dispatch);
    }

    // Otherwise, proceed with normal column deletion
    return deleteColumn(state, dispatch);
  };
