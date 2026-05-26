/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Split-editor keyboard navigation bridges between the title editor and the main body editor.
 *
 * The title and body editors are created independently in the collaborative document surface,
 * so this module captures each instance in a `useRef` (mutable across renders) and feeds those
 * refs into the extension keyboard handlers via stable getter callbacks. Capturing the refs
 * rather than the editor values directly guarantees that the handlers always observe the
 * latest editor instance even though TipTap's `Extension` factories run exactly once when the
 * extension is registered.
 *
 * Consumed by `use-collaborative-editor.ts`, which wires the returned `mainNavigationExtension`
 * into the body editor's extension list and the `titleNavigationExtension` into the title
 * editor's extension list, then calls `setMainEditor` / `setTitleEditor` from a `useEffect`
 * once both TipTap editor instances are constructed.
 */

import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { useCallback, useRef } from "react";

/**
 * Creates a title editor extension that enables keyboard navigation from the title editor
 * into the main body editor.
 *
 * Exposed shortcuts (added via `addKeyboardShortcuts` with `priority: 10`, chosen to win over
 * default key handlers when this extension is wired into the editor):
 * - `ArrowDown` (anywhere in the title): focuses the main editor at start.
 * - `ArrowRight` (only when the selection cursor is at the very end of the title): focuses
 *   the main editor at start. Otherwise returns `false` so TipTap's default ArrowRight runs.
 * - `Enter`: inserts an empty paragraph at position 0 of the main editor and focuses it.
 *
 * TipTap behaviors — Exposed: the three shortcuts above. Overridden: none — the extension only
 * ADDS shortcuts; default text input behaviors are untouched. Intentionally hidden: none.
 *
 * @param getMainEditor Stable getter callback that returns the current main-editor instance,
 *   or `null` if it has not yet been registered.
 * @returns A TipTap `Extension` with the three navigation keyboard shortcuts above.
 */
export const createTitleNavigationExtension = (getMainEditor: () => Editor | null) =>
  Extension.create({
    name: "titleEditorNavigation",
    priority: 10,

    addKeyboardShortcuts() {
      return {
        // Arrow down at end of title - Move to main editor
        ArrowDown: () => {
          const mainEditor = getMainEditor();
          if (!mainEditor) return false;

          // If cursor is at the end of the title
          mainEditor.commands.focus("start");
          return true;
        },

        // Right arrow at end of title - Move to main editor
        ArrowRight: ({ editor: titleEditor }) => {
          const mainEditor = getMainEditor();
          if (!mainEditor) return false;

          const { from, to } = titleEditor.state.selection;
          const documentLength = titleEditor.state.doc.content.size;

          // If cursor is at the end of the title
          if (from === to && to === documentLength - 1) {
            mainEditor.commands.focus("start");
            return true;
          }
          return false;
        },

        // Enter - Create new line in main editor and focus
        Enter: () => {
          const mainEditor = getMainEditor();
          if (!mainEditor) return false;

          // Focus at the start of the main editor
          mainEditor.chain().focus().insertContentAt(0, { type: "paragraph" }).run();
          return true;
        },
      };
    },
  });

/**
 * Creates a main editor extension that enables keyboard navigation from the body editor back
 * into the title editor.
 *
 * Exposed shortcuts (added via `addKeyboardShortcuts` with `priority: 10`, chosen to win over
 * default key handlers when this extension is wired into the editor):
 * - `ArrowUp` (only when the cursor is at position 1 with an empty selection): focuses the
 *   title editor at end. Otherwise returns `false`.
 * - `ArrowLeft` (only when the cursor is at position 1 with an empty selection): focuses the
 *   title editor at end. Otherwise returns `false`.
 * - `Backspace` (only when the cursor is at position 1 with an empty selection AND the first
 *   node is a paragraph): if that first paragraph is empty, deletes it AND focuses the title
 *   editor on the next tick — the `setTimeout(..., 0)` lets the deletion settle before focus
 *   moves. If the paragraph is non-empty, just moves focus to the title editor (does NOT
 *   delete content). WHY: a Backspace at the absolute start of the body would otherwise
 *   no-op; capturing it lets users use Backspace to navigate back into the title naturally.
 *
 * TipTap behaviors — Exposed: the three shortcuts above. Overridden: none — the extension only
 * ADDS shortcuts; default text input behaviors are untouched. Intentionally hidden: none.
 *
 * @param getTitleEditor Stable getter callback that returns the current title-editor instance,
 *   or `null` if it has not yet been registered.
 * @returns A TipTap `Extension` with the three navigation keyboard shortcuts above.
 */
export const createMainNavigationExtension = (getTitleEditor: () => Editor | null) =>
  Extension.create({
    name: "mainEditorNavigation",
    priority: 10,

    addKeyboardShortcuts() {
      return {
        // Arrow up at start of main editor - Move to title editor
        ArrowUp: ({ editor: mainEditor }) => {
          const titleEditor = getTitleEditor();
          if (!titleEditor) return false;

          const { from, to } = mainEditor.state.selection;

          // If cursor is at the start of the main editor
          if (from === 1 && to === 1) {
            titleEditor.commands.focus("end");
            return true;
          }
          return false;
        },

        // Left arrow at start of main editor - Move to title editor
        ArrowLeft: ({ editor: mainEditor }) => {
          const titleEditor = getTitleEditor();
          if (!titleEditor) return false;

          const { from, to } = mainEditor.state.selection;

          // If cursor is at the absolute start of the main editor
          if (from === 1 && to === 1) {
            titleEditor.commands.focus("end");
            return true;
          }
          return false;
        },

        // Backspace - Special handling for first paragraph
        Backspace: ({ editor }) => {
          const titleEditor = getTitleEditor();
          if (!titleEditor) return false;

          const { from, to, empty } = editor.state.selection;

          // Only handle when cursor is at position 1 with empty selection
          if (from === 1 && to === 1 && empty) {
            const firstNode = editor.state.doc.firstChild;

            // If first node is a paragraph
            if (firstNode && firstNode.type.name === "paragraph") {
              // If paragraph is already empty, delete it and focus title editor
              if (firstNode.content.size === 0) {
                editor.commands.deleteNode("paragraph");
                // Use setTimeout to ensure the node is deleted before changing focus
                setTimeout(() => titleEditor.commands.focus("end"), 0);
                return true;
              }
              // If paragraph is not empty, just move focus to title editor
              else {
                titleEditor.commands.focus("end");
                return true;
              }
            }
          }
          return false;
        },
      };
    },
  });

/**
 * Hook that produces the bridging keyboard-navigation layer for the split title + body editors.
 *
 * Internally allocates a `useRef` for each editor instance and exposes two stable
 * `useCallback` setters that callers invoke once the TipTap editors are constructed; the two
 * getter callbacks (`getTitleEditor`, `getMainEditor`) are internal — passed to the extension
 * factories — and are NOT part of the returned API. Consumed by `use-collaborative-editor.ts`,
 * which invokes `setMainEditor(editor)` and `setTitleEditor(titleEditor)` from a `useEffect`
 * once both editors are available.
 *
 * @returns An object with four members:
 * - `setTitleEditor(editor)`: stable callback (created via `useCallback`) that mutates the
 *   internal title-editor ref. Does NOT call `setState`, so invoking it never causes a rerender.
 * - `setMainEditor(editor)`: stable callback (created via `useCallback`) that mutates the
 *   internal main-editor ref. Does NOT call `setState`, so invoking it never causes a rerender.
 * - `titleNavigationExtension`: an `Extension` ready to be added to the title editor's
 *   extension list.
 * - `mainNavigationExtension`: an `Extension` ready to be added to the main (body) editor's
 *   extension list.
 */
export const useEditorNavigation = () => {
  // Create refs to store editor instances
  const titleEditorRef = useRef<Editor | null>(null);
  const mainEditorRef = useRef<Editor | null>(null);

  // Create stable getter functions
  const getTitleEditor = useCallback(() => titleEditorRef.current, []);
  const getMainEditor = useCallback(() => mainEditorRef.current, []);

  // Create stable setter functions
  const setTitleEditor = useCallback((editor: Editor | null) => {
    titleEditorRef.current = editor;
  }, []);

  const setMainEditor = useCallback((editor: Editor | null) => {
    mainEditorRef.current = editor;
  }, []);

  // Create extension factories that access editor refs
  const titleNavigationExtension = createTitleNavigationExtension(getMainEditor);
  const mainNavigationExtension = createMainNavigationExtension(getTitleEditor);

  return {
    setTitleEditor,
    setMainEditor,
    titleNavigationExtension,
    mainNavigationExtension,
  };
};
