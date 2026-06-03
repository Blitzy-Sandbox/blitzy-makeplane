/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * One-off transformation utility that converts a `codeBlock` node back
 * into ordinary paragraph content, preserving the inner text.
 *
 * NOT part of the editor's runtime extension chain — this utility is
 * NOT registered via `addProseMirrorPlugins()` on any extension and
 * does not participate in editor bootstrap. It is invoked on demand by
 * toolbar / command code (e.g., a "convert to text" UI affordance, or
 * programmatically when a code block's `language` attribute is set to
 * a sentinel like `"none"` / `null` and the consumer wants to drop the
 * code-block container entirely).
 *
 * Lives in `utils/` precisely BECAUSE it is discretionary. The runtime
 * code-block behavior is provided by sibling files:
 *   - `../code-block.ts`         — base TipTap node + commands + paste handler
 *   - `../code-block-lowlight.ts` — composition with syntax highlighting
 *
 * WHY a standalone utility rather than a TipTap `addCommands()` entry:
 *   This function operates directly on `editor.state` and dispatches
 *   its own transaction. Modeling it as an extension command would
 *   require call sites to invoke `editor.commands.replaceCodeWithText(...)`,
 *   which in turn requires the command to be registered on the
 *   extension. Keeping it as a standalone helper lets external React
 *   toolbar components (or any code holding an `Editor` reference)
 *   call it without coupling to the extension's command surface. The
 *   `Editor` parameter — rather than the lighter `EditorState` — is
 *   the deliberate API choice that enables `editor.view.dispatch(tr)`
 *   from inside the helper.
 *
 * Naming clarity: "Code" here refers to the code-BLOCK node, NOT the
 * inline code mark. The companion sibling folder `../code-inline/`
 * handles the inline code mark; this utility does not touch it.
 */

import type { Editor } from "@tiptap/core";
import { findParentNode } from "@tiptap/core";

/**
 * Parameter shape for {@link transformCodeBlockToParagraphs}.
 *
 * `from` / `to` mark the document range occupied by the targeted
 * `codeBlock` node (inclusive boundaries in ProseMirror position
 * arithmetic). `cursorPosInsideCodeblock` is the absolute document
 * position of the original cursor BEFORE the transformation — used to
 * compute the refocus position after the replacement.
 */
type ReplaceCodeBlockParams = {
  editor: Editor;
  from: number;
  to: number;
  textContent: string;
  cursorPosInsideCodeblock: number;
};

/**
 * Replaces the first `codeBlock` node intersecting the current
 * selection with ordinary paragraph content.
 *
 * Input:
 *   - `editor`: a TipTap `Editor` instance. The function reads
 *     `editor.state.selection` to locate the target code block (the
 *     code-block position is NOT passed by the caller — it is derived
 *     from the current selection). The full `Editor` instance is
 *     required (not just `EditorState`) so the function can dispatch
 *     its own transaction via `editor.view.dispatch(tr)`.
 *
 * Behavior:
 *   - Walks the document range `[from, to]` of the current selection
 *     using `doc.nodesBetween(...)` and stops at the FIRST matching
 *     `codeBlock` node (handles one block per invocation).
 *   - Empty code block (`textContent.length === 0`): defers to TipTap's
 *     built-in `editor.chain().focus().toggleCodeBlock().run()` — the
 *     standard toggle removes the empty block and inserts a paragraph
 *     in its place. WHY: an empty code block has no text to preserve,
 *     so the simpler toggle path is sufficient and gives consistent
 *     UX with the standard Mod-Alt-c toggle keybinding.
 *   - Non-empty code block: delegates to
 *     {@link transformCodeBlockToParagraphs}, which dispatches a
 *     SINGLE transaction that deletes the code-block range and inserts
 *     one paragraph per line of the original text content (splitting
 *     on `\r?\n` to support Windows and Unix line endings). A single
 *     transaction preserves undo history as one undo unit — the user
 *     sees "convert to text" as a single undoable action.
 *   - No match found in the selection: logs "No code block to replace."
 *     and returns. The function is a no-op in this case (does not throw).
 *   - Unexpected errors: caught by the outer `try/catch` and logged via
 *     `console.error`; the editor is left in its prior state.
 *
 * Side effects: dispatches a ProseMirror transaction (mutates the
 * document) and writes to `console.log` / `console.error`. Returns
 * `void`.
 *
 * Use case:
 *   - Invoked when the user explicitly converts a code block to plain
 *     text via a toolbar button or external command (e.g., when the
 *     language selector is set to a sentinel value such as `"none"`).
 *   - NOT invoked automatically by the editor lifecycle — this is a
 *     discretionary tool called by UI / command surfaces holding an
 *     `Editor` reference.
 */
export function replaceCodeWithText(editor: Editor): void {
  try {
    const { from, to } = editor.state.selection;
    const cursorPosInsideCodeblock = from;
    let replaced = false;

    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === editor.state.schema.nodes.codeBlock) {
        const startPos = pos;
        const endPos = pos + node.nodeSize;
        const textContent = node.textContent;

        if (textContent.length === 0) {
          editor.chain().focus().toggleCodeBlock().run();
        } else {
          transformCodeBlockToParagraphs({
            editor,
            from: startPos,
            to: endPos,
            textContent,
            cursorPosInsideCodeblock,
          });
        }

        replaced = true;
        return false;
      }
    });

    if (!replaced) {
      console.log("No code block to replace.");
    }
  } catch (error) {
    console.error("An error occurred while replacing code block content:", error);
  }
}

/**
 * Performs the code-block → multi-paragraph rewrite in a single
 * ProseMirror transaction.
 *
 * Algorithm:
 *   1. Validate the range `[from, to]` against the document size; bail
 *      with a `console.error` if invalid (defensive — prevents unsafe
 *      mutations on stale positions).
 *   2. Split `textContent` by `\r?\n` to produce one entry per line
 *      (preserving empty lines as empty strings — required so an empty
 *      line in the code block produces an empty paragraph, not a
 *      collapsed blank).
 *   3. Build a transaction: delete the code-block range, then iterate
 *      `lines` and insert one paragraph per line at the advancing
 *      `insertPos` cursor. Empty lines become `paragraph.create({})`
 *      with NO inline content (renders as an empty paragraph — NOT a
 *      `<br>` and NOT an invalid empty text node).
 *   4. Compute the post-mutation cursor position:
 *        - `findParentNode(...)` recovers the code-block's start
 *          position from the PRE-dispatch selection (the codeBlock
 *          still exists at this point because `tr` has not been
 *          dispatched yet).
 *        - {@link getLineNumber} returns the 1-based line index where
 *          the original cursor sat inside the code block.
 *        - `cursorPosOutsideCodeblock = cursorPosInsideCodeblock + (lineNumber - 1)`
 *          — each split paragraph adds +1 to position arithmetic
 *          (ProseMirror counts each block's opening boundary as one
 *          position), so the cursor position grows by `(N - 1)` where
 *          `N` is the line the cursor was on.
 *   5. Dispatch the transaction via `editor.view.dispatch(tr)` and
 *      restore focus at the computed position via `editor.chain().focus(...)`.
 *
 * Transaction atomicity: all `tr.delete` + `tr.insert` operations are
 * accumulated on a single `tr` and dispatched once. The user's undo
 * stack records ONE entry for the whole conversion.
 */
function transformCodeBlockToParagraphs({
  editor,
  from,
  to,
  textContent,
  cursorPosInsideCodeblock,
}: ReplaceCodeBlockParams): void {
  const { schema } = editor.state;
  const { paragraph } = schema.nodes;
  const docSize = editor.state.doc.content.size;

  if (from < 0 || to > docSize || from > to) {
    console.error("Invalid range for replacement: ", from, to, "in a document of size", docSize);
    return;
  }

  // Split the textContent by new lines to handle each line as a separate paragraph for Windows (\r\n) and Unix (\n)
  const lines = textContent.split(/\r?\n/);
  const tr = editor.state.tr;
  let insertPos = from;

  // Remove the code block first
  tr.delete(from, to);

  // For each line, create a paragraph node and insert it
  lines.forEach((line) => {
    // if the line is empty, create a paragraph node with no content
    const paragraphNode = line.length === 0 ? paragraph.create({}) : paragraph.create({}, schema.text(line));
    tr.insert(insertPos, paragraphNode);
    insertPos += paragraphNode.nodeSize;
  });

  // Now persist the focus to the converted paragraph
  const parentNodeOffset = findParentNode((node) => node.type === schema.nodes.codeBlock)(editor.state.selection)?.pos;

  if (parentNodeOffset === undefined) throw new Error("Invalid code block offset");

  const lineNumber = getLineNumber(textContent, cursorPosInsideCodeblock, parentNodeOffset);
  const cursorPosOutsideCodeblock = cursorPosInsideCodeblock + (lineNumber - 1);

  editor.view.dispatch(tr);
  editor.chain().focus(cursorPosOutsideCodeblock).run();
}

/**
 * Calculates the line number where the cursor is located inside the code block.
 * Assumes the indexing of the content inside the code block is like ProseMirror's indexing.
 *
 * @param {string} textContent - The content of the code block.
 * @param {number} cursorPosition - The absolute cursor position in the document.
 * @param {number} codeBlockNodePos - The starting position of the code block node in the document.
 * @returns {number} The 1-based line number where the cursor is located.
 */
function getLineNumber(textContent: string, cursorPosition: number, codeBlockNodePos: number): number {
  // Split the text content into lines, handling both Unix and Windows newlines
  const lines = textContent.split(/\r?\n/);
  const cursorPosInsideCodeblockRelative = cursorPosition - codeBlockNodePos;

  let startPosition = 0;
  let lineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    // Calculate the end position of the current line
    const endPosition = startPosition + lines[i].length + 1; // +1 for the newline character

    // Check if the cursor position is within the current line
    if (cursorPosInsideCodeblockRelative >= startPosition && cursorPosInsideCodeblockRelative <= endPosition) {
      lineNumber = i + 1; // Line numbers are 1-based
      break;
    }

    // Update the start position for the next line
    startPosition = endPosition;
  }

  return lineNumber;
}
