/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Side-menu plugin that renders a sparkles-icon button next to block nodes,
 * letting users select a block as the target of an AI action (e.g., rewrite,
 * summarize) via the editor's floating side menu.
 *
 * Shares the DOM hit-testing helper `nodeDOMAtCoords` with `drag-handle.ts`
 * so both handles resolve the same block under a given pointer position.
 */

import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
// extensions
import type { SideMenuHandleOptions, SideMenuPluginProps } from "@/extensions";
// plugins
import { nodeDOMAtCoords } from "@/plugins/drag-handle";

/** Lucide `sparkles` SVG markup used as the visual indicator on the AI handle button. */
const sparklesIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';

/**
 * Resolve a DOM node to its ProseMirror document position by probing the
 * point 50px + `dragHandleWidth` right of the node's left edge — avoiding
 * the gutter where handles are rendered. Mirrors the equivalent helper in
 * `drag-handle.ts` so both handles agree on block-position resolution.
 */
const nodePosAtDOM = (node: Element, view: EditorView, options: SideMenuPluginProps) => {
  const boundingRect = node.getBoundingClientRect();

  return view.posAtCoords({
    left: boundingRect.left + 50 + options.dragHandleWidth,
    top: boundingRect.top + 1,
  })?.inside;
};

/**
 * Resolve a blockquote DOM node to the blockquote itself (not its inner
 * paragraph) by probing the leftmost pixel; `nodePosAtDOM`'s 50px offset
 * would land inside the blockquote's child `<p>`, selecting the inner block
 * instead of the blockquote wrapper.
 */
const nodePosAtDOMForBlockQuotes = (node: Element, view: EditorView) => {
  const boundingRect = node.getBoundingClientRect();

  return view.posAtCoords({
    left: boundingRect.left + 1,
    top: boundingRect.top + 1,
  })?.inside;
};

/**
 * Normalize a resolved position to the start of the enclosing nested LI when
 * applicable, so a `NodeSelection` wraps the full list-item node rather than
 * its first inline child. Returns the input position clamped to
 * `[0, doc.content.size]` when no nested-list adjustment applies.
 */
const calcNodePos = (pos: number, view: EditorView, node: Element) => {
  const maxPos = view.state.doc.content.size;
  const safePos = Math.max(0, Math.min(pos, maxPos));
  const $pos = view.state.doc.resolve(safePos);

  if ($pos.depth > 1) {
    if (node.matches("ul li, ol li")) {
      // only for nested lists
      const newPos = $pos.before($pos.depth);
      return Math.max(0, Math.min(newPos, maxPos));
    }
  }

  return safePos;
};

/**
 * Factory returning the `SideMenuHandleOptions` (`{ view, domEvents }`) that
 * the side-menu extension mounts to render the AI-action handle (sparkles
 * button) for block-level selection. The `options` argument supplies
 * `dragHandleWidth` and other side-menu geometry used for DOM hit-testing.
 *
 * State read:
 *   - Pointer coordinates (`event.clientX`, `event.clientY`) from the click
 *     event.
 *   - Rendered DOM via the shared `nodeDOMAtCoords` hit-test (imported from
 *     `drag-handle.ts`) to locate the block under the pointer.
 *   - Resolved-position depth (`$pos.depth`) used by `calcNodePos` to detect
 *     nested list items.
 *
 * State write:
 *   - Dispatches a `NodeSelection` transaction for the block under the
 *     clicked handle (`view.dispatch(view.state.tr.setSelection(...))`). No
 *     other editor state is mutated.
 *
 * DOM side effects:
 *   - Creates a `<button id="ai-handle">` inside the supplied side-menu
 *     container, wires a `click` listener for selection dispatch, and
 *     removes the element on `destroy()`. Cleanup is symmetric — every
 *     appended node is removed.
 *
 * WHY blockquote and nested-list special-casing:
 *   - A click on a blockquote handle must select the blockquote itself, not
 *     its inner paragraph. `nodePosAtDOMForBlockQuotes` probes the
 *     blockquote's left edge so the resolved position lands on the
 *     blockquote boundary rather than inside its first child.
 *   - For nested list items / task items, the natural pointer position
 *     would resolve inside the inner LI. `calcNodePos` walks back to the
 *     start of the LI node via `$pos.before($pos.depth)` so the
 *     `NodeSelection` wraps the top-level list-item rather than its first
 *     inline child.
 *
 * Side-menu contract:
 *   - Returns `{ view, domEvents }` where `view(view, sideMenu)` mounts the
 *     handle DOM and returns `{ destroy }` for cleanup. `domEvents` is empty
 *     ({}) because the AI handle is click-only and does not need to react
 *     to mousemove / dragenter / drop / dragend events.
 */
export const AIHandlePlugin = (options: SideMenuPluginProps): SideMenuHandleOptions => {
  let aiHandleElement: HTMLButtonElement | null = null;

  const handleClick = (event: MouseEvent, view: EditorView) => {
    view.focus();

    const node = nodeDOMAtCoords({
      x: event.clientX + 50 + options.dragHandleWidth,
      y: event.clientY,
    });

    if (!(node instanceof Element)) return;

    if (node.matches("blockquote")) {
      let nodePosForBlockQuotes = nodePosAtDOMForBlockQuotes(node, view);
      if (nodePosForBlockQuotes === null || nodePosForBlockQuotes === undefined) return;

      const docSize = view.state.doc.content.size;
      nodePosForBlockQuotes = Math.max(0, Math.min(nodePosForBlockQuotes, docSize));

      if (nodePosForBlockQuotes >= 0 && nodePosForBlockQuotes <= docSize) {
        // TODO FIX ERROR
        const nodeSelection = NodeSelection.create(view.state.doc, nodePosForBlockQuotes);
        view.dispatch(view.state.tr.setSelection(nodeSelection));
      }
      return;
    }

    let nodePos = nodePosAtDOM(node, view, options);

    if (nodePos === null || nodePos === undefined) return;

    // Adjust the nodePos to point to the start of the node, ensuring NodeSelection can be applied
    nodePos = calcNodePos(nodePos, view, node);

    // TODO FIX ERROR
    // Use NodeSelection to select the node at the calculated position
    const nodeSelection = NodeSelection.create(view.state.doc, nodePos);

    // Dispatch the transaction to update the selection
    view.dispatch(view.state.tr.setSelection(nodeSelection));
  };

  const view = (view: EditorView, sideMenu: HTMLDivElement | null) => {
    // create handle element
    const className =
      "grid place-items-center font-medium size-5 aspect-square text-11 text-tertiary hover:bg-layer-1 rounded-xs opacity-100 !outline-none z-[5] transition-[background-color,_opacity] duration-200 ease-linear";
    aiHandleElement = document.createElement("button");
    aiHandleElement.type = "button";
    aiHandleElement.id = "ai-handle";
    aiHandleElement.classList.value = className;
    const iconElement = document.createElement("span");
    iconElement.classList.value = "pointer-events-none";
    iconElement.innerHTML = sparklesIcon;
    aiHandleElement.appendChild(iconElement);
    // bind events
    aiHandleElement.addEventListener("click", (e) => handleClick(e, view));

    sideMenu?.appendChild(aiHandleElement);

    return {
      // destroy the handle element on un-initialize
      destroy: () => {
        aiHandleElement?.remove();
        aiHandleElement = null;
      },
    };
  };

  const domEvents = {};

  return {
    view,
    domEvents,
  };
};
