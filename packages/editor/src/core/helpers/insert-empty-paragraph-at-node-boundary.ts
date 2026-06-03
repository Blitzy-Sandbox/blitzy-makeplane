/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyboard-shortcut command factory that places the cursor in a paragraph immediately before or after a given node type, inserting an empty paragraph when one does not already exist at that boundary.
 *
 * Necessary because certain block node types (callouts, code blocks, tables, custom embeds) have no inherent way for the cursor to escape via arrow keys — this helper backs the `ArrowUp` / `ArrowDown` shortcut bindings those extensions register.
 */

import type { KeyboardShortcutCommand } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

type Direction = "up" | "down";

/**
 * Returns a `KeyboardShortcutCommand` that places the cursor on the paragraph adjacent to the nearest enclosing node of `nodeType`, inserting a new empty paragraph there when none exists; direction `"up"` targets the slot before the node, `"down"` targets after.
 *
 * Used by block-node extensions (callouts, code blocks, embeds) to register arrow-key shortcuts that let users escape an otherwise cursor-trapping block.
 *
 * @param direction - `"up"` (insert/move to paragraph before the node) or `"down"` (after).
 * @param nodeType - ProseMirror node type name to anchor on (e.g., `CORE_EXTENSIONS.CALLOUT`, `CORE_EXTENSIONS.CODE_BLOCK`).
 * @returns A TipTap `KeyboardShortcutCommand` that returns `true` when it handled the keystroke (cursor moved / paragraph inserted) and `false` otherwise so TipTap falls through to the next shortcut.
 */
export const insertEmptyParagraphAtNodeBoundaries: (direction: Direction, nodeType: string) => KeyboardShortcutCommand =
  (direction, nodeType) =>
  ({ editor }) => {
    try {
      const { selection, doc } = editor.state;
      const { $from, $to } = selection;

      let targetNode: ProseMirrorNode | null = null;
      let targetNodePos: number | null = null;

      // Check if the selection itself is the target node
      doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.type.name === nodeType) {
          targetNode = node;
          targetNodePos = pos;
          return false; // Stop iterating once the target node is found
        }
        return true;
      });

      if (targetNode === null || targetNodePos === null) return false;

      const docSize = doc.content.size; // Get the size of the document

      switch (direction) {
        case "up": {
          const insertPosUp = targetNodePos;

          // Ensure the insert position is within the document boundaries
          if (insertPosUp < 0 || insertPosUp > docSize) return false;

          if (insertPosUp === 0) {
            // If at the very start of the document, insert a new paragraph at the start
            editor.chain().insertContentAt(insertPosUp, { type: CORE_EXTENSIONS.PARAGRAPH }).run();
            editor.chain().setTextSelection(insertPosUp).run(); // Set the cursor to the new paragraph
          } else {
            // Otherwise, check the node immediately before the target node
            const prevNode = doc.nodeAt(insertPosUp - 1);

            if (prevNode && prevNode.type.name === CORE_EXTENSIONS.PARAGRAPH) {
              // If the previous node is a paragraph, move the cursor there
              editor
                .chain()
                .setTextSelection(insertPosUp - 1)
                .run();
            } else {
              return false; // If the previous node is not a paragraph, do not proceed
            }
          }
          break;
        }

        case "down": {
          const insertPosDown = targetNodePos + (targetNode as ProseMirrorNode).nodeSize;

          // Ensure the insert position is within the document boundaries
          if (insertPosDown < 0 || insertPosDown > docSize) return false;

          // Check the node immediately after the target node
          const nextNode = doc.nodeAt(insertPosDown);

          if (nextNode && nextNode.type.name === CORE_EXTENSIONS.PARAGRAPH) {
            // If the next node is a paragraph, move the cursor to the end of it
            const endOfParagraphPos = insertPosDown + nextNode.nodeSize - 1;
            editor.chain().setTextSelection(endOfParagraphPos).run();
          } else if (!nextNode) {
            // If there is no next node (end of document), insert a new paragraph
            editor.chain().insertContentAt(insertPosDown, { type: CORE_EXTENSIONS.PARAGRAPH }).run();
            editor
              .chain()
              .setTextSelection(insertPosDown + 1)
              .run(); // Set the cursor to the new paragraph
          } else {
            return false; // If the next node is not a paragraph, do not proceed
          }
          break;
        }

        default:
          return false; // If the direction is not recognized, do not proceed
      }

      return true; // Return true if the operation was successful
    } catch (error) {
      console.error(`An error occurred while inserting a line ${direction} the ${nodeType}:`, error);
      return false; // Return false if an error occurred
    }
  };
