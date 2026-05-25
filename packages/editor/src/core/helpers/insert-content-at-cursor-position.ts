/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Safe insertion helper that clamps the saved cursor position to the document bounds before delegating to TipTap's `insertContentAt`.
 *
 * Exists as a wrapper around `editor.commands.insertContentAt` because callers (AI features, comment paste, programmatic content injection) may hold a cursor position captured before a previous edit shortened the document — without the clamp, `insertContentAt` throws when the position is out of range.
 */

import type { Editor } from "@tiptap/react";

/**
 * Inserts arbitrary content at the editor's current selection anchor, clamping the anchor to `[0, doc.content.size]` so a stale saved selection cannot throw a ProseMirror range error.
 *
 * Consumed by `editor-ref.ts:setEditorValueAtCursorPosition` to wire arbitrary content insertion into the imperative editor ref API.
 *
 * @param editor - TipTap editor instance; an early-return logs an error if the editor is destroyed.
 * @param content - HTML string (or any value TipTap's `insertContentAt` accepts) to insert at the clamped anchor.
 */
export const insertContentAtSavedSelection = (editor: Editor, content: string) => {
  if (!editor || editor.isDestroyed) {
    console.error("Editor reference is not available or has been destroyed.");
    return;
  }

  if (!editor.state.selection) {
    console.error("Saved selection is invalid.");
    return;
  }

  const docSize = editor.state.doc.content.size;
  const safePosition = Math.max(0, Math.min(editor.state.selection.anchor, docSize));

  try {
    editor.chain().focus().insertContentAt(safePosition, content).run();
  } catch (error) {
    console.error("An error occurred while inserting content at saved selection:", error);
  }
};
