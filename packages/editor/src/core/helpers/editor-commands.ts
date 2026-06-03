/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central toolbar-action command layer wrapping TipTap commands for headings, marks, lists, blockquotes, links, color, alignment, horizontal rules, callouts, tables, images, and emoji triggers.
 *
 * Every command accepts an optional `range` so the toolbar (which captures a saved range before its UI opens) and slash-command menu (which captures the range of the slash trigger) can apply formatting to a previously selected span; when `range` is omitted, the editor's current selection is used.
 *
 * Consumed by the menus surface (`components/menus`), the slash-command extension, and `editor-ref.ts:executeMenuItemCommand`. Each wrapper is intentionally thin — it exists so the consumer surface has one canonical entry point per command instead of duplicating `editor.chain().focus()...run()` patterns.
 */
import type { Editor, Range } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import { replaceCodeWithText } from "@/extensions/code/utils/replace-code-block-with-text";
import type { InsertImageComponentProps } from "@/extensions/custom-image/types";
// helpers
import type { ExtendedEmojiStorage } from "@/extensions/emoji/emoji";
import { findTableAncestor } from "@/helpers/common";

/**
 * Sets the active node to a paragraph (resetting headings / code blocks back to plain text) over `range` when provided, or the current selection otherwise.
 */
export const setText = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setNode(CORE_EXTENSIONS.PARAGRAPH).run();
  else editor.chain().focus().setNode(CORE_EXTENSIONS.PARAGRAPH).run();
};

/**
 * Sets a heading of the given level (1–6) over `range` when provided; otherwise toggles the heading at the current selection (toggling off returns to paragraph).
 */
export const toggleHeading = (editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setNode(CORE_EXTENSIONS.HEADING, { level }).run();
  else editor.chain().focus().toggleHeading({ level }).run();
};

/** Toggles the bold mark on `range` when provided, or the current selection otherwise. */
export const toggleBold = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBold().run();
  else editor.chain().focus().toggleBold().run();
};

/** Toggles the italic mark on `range` when provided, or the current selection otherwise. */
export const toggleItalic = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleItalic().run();
  else editor.chain().focus().toggleItalic().run();
};

/** Toggles the underline mark on `range` when provided, or the current selection otherwise. */
export const toggleUnderline = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleUnderline().run();
  else editor.chain().focus().toggleUnderline().run();
};

/**
 * Toggles between code-block, inline-code, and plain-text representations based on the current selection.
 *
 * - When the cursor is already inside a code block, calls `replaceCodeWithText` to restore the code's content as paragraphs (this is the only path that delegates outside this file, because re-emitting a code block as paragraphs requires walking the child text nodes).
 * - When the selection is empty, toggles a code block at the cursor.
 * - When the selection contains multiple lines, replaces the selection with a fenced code block whose body is the selected text.
 * - When the selection is a single line, toggles `inline code` (not a block) because a block would otherwise force a paragraph split for a single token.
 *
 * Errors thrown by any underlying chain are caught and logged so a malformed selection does not crash the toolbar.
 */
export const toggleCodeBlock = (editor: Editor, range?: Range) => {
  try {
    // if it's a code block, replace it with the code with paragraphs
    if (editor.isActive(CORE_EXTENSIONS.CODE_BLOCK)) {
      replaceCodeWithText(editor);
      return;
    }

    const { from, to } = range || editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    const isMultiline = text.includes("\n");

    // if the selection is not a range i.e. empty, then simply convert it into a codeBlock
    if (editor.state.selection.empty) {
      editor.chain().focus().toggleCodeBlock().run();
    } else if (isMultiline) {
      // if the selection is multiline, then also replace the text content with
      // a codeBlock
      editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, `\`\`\`\n${text}\n\`\`\``).run();
    } else {
      // if the selection is single line, then simply convert it into inline
      // code
      editor.chain().focus().toggleCode().run();
    }
  } catch (error) {
    console.error("An error occurred while toggling code block:", error);
  }
};

/** Toggles an ordered list on `range` when provided, or the current selection otherwise. */
export const toggleOrderedList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleOrderedList().run();
  else editor.chain().focus().toggleOrderedList().run();
};

/** Toggles a bullet list on `range` when provided, or the current selection otherwise. */
export const toggleBulletList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBulletList().run();
  else editor.chain().focus().toggleBulletList().run();
};

/** Toggles a task (checkbox) list on `range` when provided, or the current selection otherwise. */
export const toggleTaskList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleTaskList().run();
  else editor.chain().focus().toggleTaskList().run();
};

/** Toggles the strike-through mark on `range` when provided, or the current selection otherwise. */
export const toggleStrike = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleStrike().run();
  else editor.chain().focus().toggleStrike().run();
};

/** Toggles a blockquote on `range` when provided, or the current selection otherwise. */
export const toggleBlockquote = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBlockquote().run();
  else editor.chain().focus().toggleBlockquote().run();
};

/**
 * Inserts a 3×3 table at `range` (or the current selection), guarding against nested tables by consulting `findTableAncestor` on the live DOM selection (early-returns when the cursor is already inside a `<table>`).
 */
export const insertTableCommand = (editor: Editor, range?: Range) => {
  if (typeof window !== "undefined") {
    const selection = window.getSelection();
    if (selection) {
      if (selection.rangeCount !== 0) {
        const range = selection.getRangeAt(0);
        if (findTableAncestor(range.startContainer)) {
          return;
        }
      }
    }
  }
  if (range) editor.chain().focus().deleteRange(range).clearNodes().insertTable({ rows: 3, cols: 3 }).run();
  else editor.chain().focus().clearNodes().insertTable({ rows: 3, cols: 3 }).run();
};

/**
 * Inserts the custom image component at `range` (or the current selection), forwarding `event` (`"insert"` vs `"drop"`), `pos`, and `file` to the image-component's `insertImageComponent` chain so the same code path serves toolbar insertion, paste, and drag-drop.
 */
export const insertImage = ({
  editor,
  event,
  pos,
  file,
  range,
}: {
  editor: Editor;
  event: "insert" | "drop";
  pos?: number | null;
  file?: File;
  range?: Range;
}) => {
  if (range) editor.chain().focus().deleteRange(range).run();

  const imageOptions: InsertImageComponentProps = { event };
  if (pos) imageOptions.pos = pos;
  if (file) imageOptions.file = file;
  return editor?.chain().focus().insertImageComponent(imageOptions).run();
};

/** Removes the link mark from the current selection. */
export const unsetLinkEditor = (editor: Editor) => {
  editor.chain().focus().unsetLink().run();
};

/**
 * Sets a link mark with `url` at the current selection; when `text` is provided, also replaces the selection's contents with `text` before linking, so the link's anchor text matches.
 */
export const setLinkEditor = (editor: Editor, url: string, text?: string) => {
  const { selection } = editor.state;
  const previousSelection = { from: selection.from, to: selection.to };
  if (text) {
    editor
      .chain()
      .focus()
      .deleteRange({ from: selection.from, to: selection.to })
      .insertContentAt(previousSelection.from, text)
      .run();
    // Extracting the new selection start point.
    const previousFrom = previousSelection.from;

    editor.commands.setTextSelection({ from: previousFrom, to: previousFrom + text.length });
  }
  editor.chain().focus().setLink({ href: url }).run();
};

/**
 * Applies `color` as the text color on `range` (or the current selection); when `color` is `undefined`, clears the text-color mark instead.
 */
export const toggleTextColor = (color: string | undefined, editor: Editor, range?: Range) => {
  if (color) {
    if (range) editor.chain().focus().deleteRange(range).setTextColor(color).run();
    else editor.chain().focus().setTextColor(color).run();
  } else {
    if (range) editor.chain().focus().deleteRange(range).unsetTextColor().run();
    else editor.chain().focus().unsetTextColor().run();
  }
};

/**
 * Applies `color` as the text background color on `range` (or the current selection); when `color` is `undefined`, clears the background-color mark instead.
 */
export const toggleBackgroundColor = (color: string | undefined, editor: Editor, range?: Range) => {
  if (color) {
    if (range) {
      editor.chain().focus().deleteRange(range).setBackgroundColor(color).run();
    } else {
      editor.chain().focus().setBackgroundColor(color).run();
    }
  } else {
    if (range) {
      editor.chain().focus().deleteRange(range).unsetBackgroundColor().run();
    } else {
      editor.chain().focus().unsetBackgroundColor().run();
    }
  }
};

/** Sets paragraph text alignment (`"left"`, `"center"`, `"right"`, `"justify"`) at the current selection. */
export const setTextAlign = (alignment: string, editor: Editor) => {
  editor.chain().focus().setTextAlign(alignment).run();
};

/** Inserts a horizontal rule (`<hr>`) at `range` (or the current selection). */
export const insertHorizontalRule = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setHorizontalRule().run();
  else editor.chain().focus().setHorizontalRule().run();
};

/** Inserts a callout block at `range` (or the current selection). */
export const insertCallout = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).insertCallout().run();
  else editor.chain().focus().insertCallout().run();
};

/**
 * Triggers the emoji picker by setting `forceOpen: true` on the emoji extension storage and inserting `:` at the cursor, simulating the user-typed trigger character so the popover is anchored to the resulting node.
 */
export const openEmojiPicker = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).run();
  const emojiStorage = editor.storage.emoji as ExtendedEmojiStorage;
  emojiStorage.forceOpen = true;
  editor.chain().focus().insertContent(":").run();
};
