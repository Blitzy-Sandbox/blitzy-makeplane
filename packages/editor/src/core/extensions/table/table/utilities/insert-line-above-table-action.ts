/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyboard handler that lets the user escape upward from a table's first
 * row — either by inserting a fresh paragraph immediately above the
 * table (when the table is the first node in the document) or by moving
 * the caret into the existing paragraph above the table.
 *
 * MUTATES editor state via `editor.chain().insertContentAt(...)` /
 * `editor.chain().setTextSelection(...)` dispatches.
 *
 * Bound to the `ArrowUp` keyboard shortcut in `../table.ts` (line 266).
 */

import type { KeyboardShortcutCommand } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { findParentNodeOfType } from "@/helpers/common";

/**
 * Insert (or move into) a paragraph immediately above the active table.
 *
 * Decision tree:
 *   1. If the caret isn't inside a table → return `false`.
 *   2. If no enclosing table can be found via `findParentNodeOfType` →
 *      return `false`.
 *   3. If the selection isn't in the table's first row (checked by
 *      testing whether the selection's `$anchor.path` array includes the
 *      first-row node reference) → return `false`.
 *   4. If the table sits at document position `0` (it's the first node)
 *      → insert a fresh `{ type: "paragraph" }` at position `0` and
 *      move the caret into it.
 *   5. Otherwise, if a `paragraph` node immediately precedes the table
 *      → move the caret to the end of that paragraph.
 *   6. Otherwise (a non-paragraph node precedes the table, e.g.,
 *      another table) → return `false` (let the default ArrowUp behavior
 *      run).
 *
 * Input:
 *   - `props.editor` — used to read `state.selection`, to test
 *     `isActive(CORE_EXTENSIONS.TABLE)`, and to dispatch
 *     `insertContentAt` / `setTextSelection` chains.
 *
 * Output:
 *   - `true` when a paragraph was inserted or the caret was moved.
 *   - `false` for every other case (the default ArrowUp handler runs).
 *
 * Side effects:
 *   - `editor.chain().insertContentAt(...)` ADDS a new paragraph node
 *     when no upstream paragraph exists.
 *   - `editor.chain().setTextSelection(...)` moves the caret.
 *
 * Error handling:
 *   - Wrapped in try/catch with `console.error("failed to insert line
 *     above table", e)` — preserves the editor against unexpected
 *     ProseMirror state shapes; returns `false` to let the default
 *     handler run.
 *
 * WHY this affordance:
 *   ProseMirror doesn't allow caret placement immediately before a table
 *   at the start of a document (the table is `isolating: true` and the
 *   editor disables `allowGapCursor`). Without this handler, a user
 *   typing in the first cell of a top-of-document table would have no
 *   way to add a paragraph above the table. This handler creates the
 *   paragraph transparently when the user presses ArrowUp from the
 *   first row.
 *
 * Note on the `(selection.$anchor as any).path` cast (line 29): the
 * `path` field is a ProseMirror internal that isn't exposed on the
 * `ResolvedPos` public type. The cast is intentional and preserved
 * exactly per the AAP "Preserve all existing comments verbatim" rule.
 */
export const insertLineAboveTableAction: KeyboardShortcutCommand = ({ editor }) => {
  // Check if the current selection or the closest node is a table
  if (!editor.isActive(CORE_EXTENSIONS.TABLE)) return false;

  try {
    // Get the current selection
    const { selection } = editor.state;

    // Find the table node and its position
    const tableNode = findParentNodeOfType(selection, [CORE_EXTENSIONS.TABLE]);
    if (!tableNode) return false;

    const tablePos = tableNode.pos;

    // Determine if the selection is in the first row of the table
    const firstRow = tableNode.node.child(0);
    const selectionPath = (selection.$anchor as any).path;
    const selectionInFirstRow = selectionPath.includes(firstRow);

    if (!selectionInFirstRow) return false;

    // Check if the table is at the very start of the document or its parent node
    if (tablePos === 0) {
      // The table is at the start, so just insert a paragraph at the current position
      editor.chain().insertContentAt(tablePos, { type: "paragraph" }).run();
      editor
        .chain()
        .setTextSelection(tablePos + 1)
        .run();
    } else {
      // The table is not at the start, check for the node immediately before the table
      const prevNodePos = tablePos - 1;

      if (prevNodePos <= 0) return false;

      const prevNode = editor.state.doc.nodeAt(prevNodePos - 1);

      if (prevNode && prevNode.type.name === CORE_EXTENSIONS.PARAGRAPH) {
        // If there's a paragraph before the table, move the cursor to the end of that paragraph
        const endOfParagraphPos = tablePos - prevNode.nodeSize;
        editor.chain().setTextSelection(endOfParagraphPos).run();
      } else {
        return false;
      }
    }

    return true;
  } catch (e) {
    console.error("failed to insert line above table", e);
    return false;
  }
};
