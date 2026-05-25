/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyboard handler that lets the user escape downward from a table's last
 * row — symmetric to `./insert-line-above-table-action.ts`.
 *
 * MUTATES editor state via `editor.chain().insertContentAt(...)` /
 * `editor.chain().setTextSelection(...)` dispatches.
 *
 * Bound to the `ArrowDown` keyboard shortcut in `../table.ts` (line 265).
 */

import type { KeyboardShortcutCommand } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { findParentNodeOfType } from "@/helpers/common";

/**
 * Insert (or move into) a paragraph immediately below the active table —
 * symmetric to `insertLineAboveTableAction`.
 *
 * Decision tree:
 *   1. If the caret isn't inside a table → return `false`.
 *   2. If no enclosing table can be resolved → return `false`.
 *   3. If the selection isn't in the table's last row (checked by
 *      testing whether the selection's `$anchor.path` array includes the
 *      last-row node reference) → return `false`.
 *   4. If a `paragraph` node immediately follows the table → move the
 *      caret to the end of that paragraph.
 *   5. Otherwise, if NO node exists after the table (we're at the end
 *      of the document) → insert a fresh paragraph at `tablePos +
 *      table.nodeSize` and move the caret into it.
 *   6. Otherwise (a non-paragraph node follows the table) → return
 *      `false` (let the default ArrowDown handler run).
 *
 * Input / Output / Side effects / Error handling:
 *   Same shape as `insertLineAboveTableAction`. The `console.error`
 *   message in this file reads `"failed to insert line above table"` —
 *   a pre-existing copy-paste error from the above-counterpart.
 *   Preserved verbatim per the AAP "Preserve all existing comments
 *   verbatim" / "No refactoring" rules.
 *
 * WHY this affordance:
 *   Symmetric to the above-table case — without this handler, a user in
 *   the last cell of a bottom-of-document table couldn't add a paragraph
 *   below. Pressing ArrowDown creates the paragraph transparently.
 */
export const insertLineBelowTableAction: KeyboardShortcutCommand = ({ editor }) => {
  // Check if the current selection or the closest node is a table
  if (!editor.isActive(CORE_EXTENSIONS.TABLE)) return false;

  try {
    // Get the current selection
    const { selection } = editor.state;

    // Find the table node and its position
    const tableNode = findParentNodeOfType(selection, [CORE_EXTENSIONS.TABLE]);
    if (!tableNode) return false;

    const tablePos = tableNode.pos;
    const table = tableNode.node;

    // Determine if the selection is in the last row of the table
    const rowCount = table.childCount;
    const lastRow = table.child(rowCount - 1);
    const selectionPath = (selection.$anchor as any).path;
    const selectionInLastRow = selectionPath.includes(lastRow);

    if (!selectionInLastRow) return false;

    // Calculate the position immediately after the table
    const nextNodePos = tablePos + table.nodeSize;

    // Check for an existing node immediately after the table
    const nextNode = editor.state.doc.nodeAt(nextNodePos);

    if (nextNode && nextNode.type.name === CORE_EXTENSIONS.PARAGRAPH) {
      // If the next node is an paragraph, move the cursor there
      const endOfParagraphPos = nextNodePos + nextNode.nodeSize - 1;
      editor.chain().setTextSelection(endOfParagraphPos).run();
    } else if (!nextNode) {
      // If the next node doesn't exist i.e. we're at the end of the document, create and insert a new empty node there
      editor.chain().insertContentAt(nextNodePos, { type: CORE_EXTENSIONS.PARAGRAPH }).run();
      editor
        .chain()
        .setTextSelection(nextNodePos + 1)
        .run();
    } else {
      return false;
    }

    return true;
  } catch (e) {
    console.error("failed to insert line above table", e);
    return false;
  }
};
