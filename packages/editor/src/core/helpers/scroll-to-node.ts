/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Editor viewport-scrolling helpers for table-of-contents navigation and programmatic cursor scrolling.
 *
 * `scrollSummary` jumps to the Nth heading of a given level (used by the headings outline panel); `scrollToNodeViaDOMCoordinates` centers an arbitrary document position in the viewport (used by ref-driven navigation and selection focus).
 */

import type { Editor } from "@tiptap/react";
// types
import type { IMarking } from "@/types";

function findNthH1(editor: Editor, n: number, level: number): number {
  let count = 0;
  let pos = 0;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "heading" && node.attrs.level === level) {
      count++;
      if (count === n) {
        pos = position;
        return false;
      }
    }
  });
  return pos;
}

function scrollToNode(editor: Editor, pos: number): void {
  const headingNode = editor.state.doc.nodeAt(pos);
  if (headingNode) {
    const headingDOM = editor.view.nodeDOM(pos);
    if (headingDOM instanceof HTMLElement) {
      headingDOM.scrollIntoView({ behavior: "smooth" });
    }
  }
}

/**
 * Centers a document position in the viewport by reading its DOM coordinates via `view.coordsAtPos` and scrolling the window so the position sits halfway down the viewport.
 *
 * Consumed by `editor-ref.ts:scrollToNodeViaDOMCoordinates` (exposed on `EditorRefApi`) for programmatic navigation to a cursor position or referenced node.
 *
 * @param editor - TipTap editor instance.
 * @param pos - ProseMirror document position to scroll to.
 * @param behavior - `ScrollBehavior` ("smooth" | "instant" | "auto"); passed through to `window.scrollTo`.
 */
export function scrollToNodeViaDOMCoordinates(editor: Editor, pos: number, behavior?: ScrollBehavior): void {
  const view = editor.view;

  // Get the coordinates of the position
  const coords = view.coordsAtPos(pos);

  if (coords) {
    // Scroll to the coordinates
    window.scrollTo({
      top: coords.top + window.scrollY - window.innerHeight / 2,
      behavior: behavior,
    });

    // Optionally, you can also focus the editor
    view.focus();
  } else {
    console.warn("Unable to find coordinates for the given position");
  }
}

/**
 * Scrolls the editor viewport to the Nth heading of the given level using `findNthH1` to locate the position and `scrollIntoView` for the smooth-scroll behavior.
 *
 * Consumed by `editor-ref.ts:scrollSummary` (exposed on `EditorRefApi`) so the outline/table-of-contents UI can navigate by `IMarking.sequence` and `IMarking.level`.
 */
export function scrollSummary(editor: Editor, marking: IMarking) {
  if (editor) {
    const pos = findNthH1(editor, marking.sequence, marking.level);
    scrollToNode(editor, pos);
  }
}
