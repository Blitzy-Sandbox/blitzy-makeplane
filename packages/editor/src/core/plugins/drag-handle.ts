/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Side-menu drag-handle plugin — the draggable ellipsis button rendered next
 * to block nodes that lets users grab, drag, and reorder document blocks via
 * mouse. The plugin manages handle DOM lifecycle, viewport-edge autoscroll
 * during a drag, and schema-safe normalization of nested list / task-item
 * drops.
 *
 * Also exports two foundational DOM helpers — `getScrollParent` and
 * `nodeDOMAtCoords` — that sibling plugins (e.g. `ai-handle.ts`) and the
 * `side-menu` extension reuse for shared block hit-testing and viewport-edge
 * scroll detection.
 */

import type { Node, Schema } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import type { SideMenuHandleOptions, SideMenuPluginProps } from "@/extensions";

/** Lucide `ellipsis-vertical` SVG markup; two stacked copies form the drag-handle visual. */
const verticalEllipsisIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ellipsis-vertical"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';

/**
 * CSS selectors matching the block-level DOM elements that the drag-handle
 * may grab. Order matters: more specific selectors (code-block, image
 * component, embed components) come before generic `li` / paragraph so
 * `nodeDOMAtCoords` resolves to the most specific block when both could
 * apply. Reordering would silently change drag-target resolution.
 */
const generalSelectors = [
  "li",
  "p.editor-paragraph-block:not(:first-child)",
  ".code-block",
  "blockquote",
  "h1.editor-heading-block, h2.editor-heading-block, h3.editor-heading-block, h4.editor-heading-block, h5.editor-heading-block, h6.editor-heading-block",
  "[data-type=horizontalRule]",
  "table:not(.table-drag-preview)",
  ".issue-embed",
  ".image-component",
  ".image-upload-component",
  ".editor-callout-component",
  ".editor-embed-component",
  ".editor-drawio-component",
].join(", ");

/** Cap on per-frame autoscroll velocity (pixels/frame) during viewport-edge drag. */
const maxScrollSpeed = 20;
/** Lerp factor toward the target scroll velocity; lower = smoother ramp. */
const acceleration = 0.5;

/**
 * WeakMap cache: DOM node → its first scrollable ancestor. Avoids re-walking
 * the DOM on every autoscroll frame during a drag.
 */
const scrollParentCache = new WeakMap();

/**
 * Quadratic ease-out (`t * (2 - t)`); used to ramp autoscroll velocity
 * smoothly as the drag pointer approaches a viewport edge so the user can
 * fine-tune scroll speed near the boundary.
 */
function easeOutQuadAnimation(t: number) {
  return t * (2 - t);
}

/**
 * Build the drag-handle DOM `<button>` with two stacked vertical-ellipsis
 * icons. Called once per editor view when the side menu mounts; the returned
 * element is appended to the supplied side-menu container.
 */
const createDragHandleElement = (): HTMLElement => {
  const dragHandleElement = document.createElement("button");
  dragHandleElement.type = "button";
  dragHandleElement.id = "drag-handle";
  dragHandleElement.draggable = true;
  dragHandleElement.dataset.dragHandle = "";
  dragHandleElement.classList.value =
    "hidden sm:flex items-center size-5 aspect-square rounded-xs cursor-grab outline-none hover:bg-layer-1-hover active:bg-layer-1 active:cursor-grabbing transition-[background-color,_opacity] duration-200 ease-linear";

  const iconElement1 = document.createElement("span");
  iconElement1.classList.value = "pointer-events-none text-tertiary";
  iconElement1.innerHTML = verticalEllipsisIcon;
  const iconElement2 = document.createElement("span");
  iconElement2.classList.value = "pointer-events-none text-tertiary -ml-2.5";
  iconElement2.innerHTML = verticalEllipsisIcon;

  dragHandleElement.appendChild(iconElement1);
  dragHandleElement.appendChild(iconElement2);

  return dragHandleElement;
};

/** Return true if a DOM node's computed `overflow` or `overflow-y` is `auto` or `scroll`. */
const isScrollable = (node: HTMLElement | SVGElement) => {
  if (!(node instanceof HTMLElement || node instanceof SVGElement)) {
    return false;
  }
  const style = getComputedStyle(node);
  return ["overflow", "overflow-y"].some((propertyName) => {
    const value = style.getPropertyValue(propertyName);
    return value === "auto" || value === "scroll";
  });
};

/**
 * Walk the parent chain of `node` and return the first ancestor whose
 * computed style has `overflow` or `overflow-y` set to `auto` / `scroll`,
 * falling back to `document.scrollingElement` (or `document.documentElement`)
 * when no scrollable ancestor exists.
 *
 * Results are memoized in `scrollParentCache` (WeakMap) so subsequent
 * autoscroll frames during a drag do not re-walk the DOM. Exported as part
 * of the plugins' shared DOM-helper surface alongside `nodeDOMAtCoords` so
 * sibling plugins that need viewport-edge scroll detection can reuse it
 * without duplicating the walk logic.
 */
export const getScrollParent = (node: HTMLElement | SVGElement) => {
  if (scrollParentCache.has(node)) {
    return scrollParentCache.get(node);
  }

  let currentParent = node.parentElement;

  while (currentParent) {
    if (isScrollable(currentParent)) {
      scrollParentCache.set(node, currentParent);
      return currentParent;
    }
    currentParent = currentParent.parentElement;
  }

  const result = document.scrollingElement || document.documentElement;
  scrollParentCache.set(node, result);
  return result;
};

/**
 * Hit-test the DOM at the given viewport coordinates and return the first
 * element matching `generalSelectors` (block-level draggable elements).
 *
 * Special cases handled in selector order:
 *   - Tables (`table:not(.table-drag-preview)`) match first so cell-level
 *     hits do not resolve to a `<p>` inside the cell.
 *   - The very first paragraph of the editor (`p:first-child` whose parent
 *     is `.ProseMirror`) is matched explicitly so the leading block can be
 *     dragged even though `generalSelectors` excludes `p:first-child`.
 *   - Table cells are skipped so a hit inside a table never resolves to an
 *     inner block; the table itself was already matched earlier.
 *   - Elements inside `.editor-embed-component` are skipped unless the
 *     element IS the embed-component root — the embed renders its own inner
 *     DOM that should not be individually draggable.
 *
 * Consumed by `ai-handle.ts` and `core/extensions/side-menu.ts` for shared
 * block hit-testing.
 */
export const nodeDOMAtCoords = (coords: { x: number; y: number }) => {
  const elements = document.elementsFromPoint(coords.x, coords.y);

  for (const elem of elements) {
    // Check for table wrapper first
    if (elem.matches("table:not(.table-drag-preview)")) {
      return elem;
    }

    if (elem.matches("p:first-child") && elem.parentElement?.matches(".ProseMirror")) {
      return elem;
    }

    // Skip table cells
    if (elem.closest("table")) {
      continue;
    }

    // Skip elements inside .editor-embed-component
    if (elem.closest(".editor-embed-component") && !elem.matches(".editor-embed-component")) {
      continue;
    }

    // apply general selector
    if (elem.matches(generalSelectors)) {
      return elem;
    }
  }
  return null;
};

/**
 * Resolve a DOM node to its ProseMirror document position by probing the
 * point 50px + `dragHandleWidth` right of the node's left edge — this avoids
 * landing in the gutter where the drag handle itself is rendered.
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
 * paragraph) by probing the leftmost pixel. `nodePosAtDOM`'s 50px offset
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
 * Factory returning the `SideMenuHandleOptions` (`{ view, domEvents }`) that
 * the side-menu extension mounts. The plugin renders the draggable handle,
 * tracks per-drag state, performs viewport-edge autoscroll, and normalizes
 * drop positions so nested list / task-item slices remain schema-valid.
 *
 * State read:
 *   - Current selection (`view.state.selection`) on drop to identify the
 *     dragged node.
 *   - Rendered DOM via `nodeDOMAtCoords` to locate the block under the
 *     pointer at click / dragstart time.
 *   - Resolved-position depth + parent node type (`view.state.doc.resolve`)
 *     to detect whether the drop target is inside a list and at what depth.
 *
 * State write:
 *   - Plugin-local closure state: `isDragging`, `lastClientY`,
 *     `isDraggedOutsideWindow`, `isMouseInsideWhileDragging`, `listType`,
 *     `currentScrollSpeed`, `scrollAnimationFrame`, `dragHandleElement`.
 *   - Dispatches `NodeSelection` transactions through `handleNodeSelection`
 *     on click / dragstart so the dragged block is selected before the
 *     browser begins the drag operation.
 *   - On drop, may rewrite `view.dragging.slice` (a ProseMirror EditorView
 *     property consumed by the built-in drop handler) to normalize nested
 *     list / task-item structure — see WHY below.
 *
 * DOM side effects:
 *   - Creates the drag-handle `<button>` via `createDragHandleElement` and
 *     appends it to the supplied side-menu container.
 *   - Installs four handle-level listeners (`dragstart`, `dragend`, `click`,
 *     `contextmenu`) and four global listeners (`window.dragleave`,
 *     `window.dragenter`, `document.dragover`, `document.mousemove`). The
 *     global listeners are required because once a drag starts the pointer
 *     can leave the editor's DOM subtree; the plugin still needs to track
 *     viewport-edge crossings for autoscroll and detect a stuck drag-state
 *     when the browser does not fire a clean `dragend`.
 *   - Toggles `view.dom.classList` "dragging" on dragenter / drop / dragend
 *     to enable drop-target CSS styling.
 *   - Runs a `requestAnimationFrame` autoscroll loop (`scroll`) with eased
 *     velocity via `easeOutQuadAnimation` whenever the pointer approaches a
 *     viewport edge during a drag.
 *   - On `destroy`, every installed listener AND the handle element are
 *     removed and `scrollAnimationFrame` is cancelled. Cleanup symmetry is
 *     critical: missing any teardown would leak listeners across editor
 *     re-mounts.
 *
 * WHY nested-list / task-item normalization:
 *   Dropping a bare `listItem` (or `taskItem`) at an arbitrary position can
 *   produce a schema-invalid document. The drop handler resolves the target
 *   depth and applies two corrections: (1) when the drop is OUTSIDE any
 *   list, the slice is rewrapped in `orderedList` or `bulletList` matching
 *   the original `listType` captured at dragstart; (2) when the drop is at
 *   a DIFFERENT depth than the source, the slice is flattened via
 *   `flattenListStructure` so stale nesting does not get carried into the
 *   target. The handler then assigns the normalized result to
 *   `view.dragging.slice` so ProseMirror's default drop machinery commits
 *   the corrected structure instead of the raw slice.
 *
 * WHY viewport-edge autoscroll:
 *   Pointer events stop firing past the viewport edge, so the plugin runs
 *   an rAF loop that scrolls the nearest scrollable ancestor
 *   (`getScrollParent(dragHandleElement)`) toward the pointer. Inside the
 *   viewport, velocity is computed from `easeOutQuadAnimation` ramping
 *   smoothly. Outside the viewport (`isDraggedOutsideWindow`), velocity is
 *   pinned at ±`maxScrollSpeed * 5` because no further pointer position
 *   updates will arrive until `dragenter` re-fires.
 *
 * WHY a `mousemove` listener ends the drag:
 *   If the pointer LEFT the viewport and the user released the mouse
 *   outside (so the browser never fired a clean `dragend`),
 *   `isMouseInsideWhileDragging` becomes true and the mousemove handler
 *   calls `handleDragEnd` to clear the stuck "dragging" CSS state.
 */
export const DragHandlePlugin = (options: SideMenuPluginProps): SideMenuHandleOptions => {
  let listType = "";
  let isDragging = false;
  let lastClientY = 0;
  let scrollAnimationFrame: number | null = null;
  let isDraggedOutsideWindow: "top" | "bottom" | boolean = false;
  let isMouseInsideWhileDragging = false;
  let currentScrollSpeed = 0;
  let dragHandleElement: HTMLElement | null = null;

  function scroll() {
    if (!isDragging) {
      currentScrollSpeed = 0;
      return;
    }

    const scrollableParent = getScrollParent(dragHandleElement!);
    if (!scrollableParent) return;

    const scrollRegionUp = options.scrollThreshold.up;
    const scrollRegionDown = window.innerHeight - options.scrollThreshold.down;

    let targetScrollAmount = 0;

    if (isDraggedOutsideWindow === "top") {
      targetScrollAmount = -maxScrollSpeed * 5;
    } else if (isDraggedOutsideWindow === "bottom") {
      targetScrollAmount = maxScrollSpeed * 5;
    } else if (lastClientY < scrollRegionUp) {
      const ratio = easeOutQuadAnimation((scrollRegionUp - lastClientY) / options.scrollThreshold.up);
      targetScrollAmount = -maxScrollSpeed * ratio;
    } else if (lastClientY > scrollRegionDown) {
      const ratio = easeOutQuadAnimation((lastClientY - scrollRegionDown) / options.scrollThreshold.down);
      targetScrollAmount = maxScrollSpeed * ratio;
    }

    currentScrollSpeed += (targetScrollAmount - currentScrollSpeed) * acceleration;

    if (Math.abs(currentScrollSpeed) > 0.1) {
      scrollableParent.scrollBy({ top: currentScrollSpeed });
    }

    scrollAnimationFrame = requestAnimationFrame(scroll) as unknown as null;
  }

  const handleClick = (event: MouseEvent, view: EditorView) => {
    handleNodeSelection(event, view, false, options);
  };

  const handleDragStart = (event: DragEvent, view: EditorView) => {
    const { listType: listTypeFromDragStart } = handleNodeSelection(event, view, true, options) ?? {};
    if (listTypeFromDragStart) {
      listType = listTypeFromDragStart;
    }
    isDragging = true;
    lastClientY = event.clientY;
    scroll();
  };

  const handleDragEnd = <TEvent extends DragEvent | FocusEvent>(event: TEvent, view?: EditorView) => {
    event.preventDefault();
    isDragging = false;
    isMouseInsideWhileDragging = false;
    if (scrollAnimationFrame) {
      cancelAnimationFrame(scrollAnimationFrame);
      scrollAnimationFrame = null;
    }

    view?.dom.classList.remove("dragging");
  };

  // drag handle view actions
  const showDragHandle = () => dragHandleElement?.classList.remove("drag-handle-hidden");
  const hideDragHandle = () => {
    if (!dragHandleElement?.classList.contains("drag-handle-hidden"))
      dragHandleElement?.classList.add("drag-handle-hidden");
  };

  const view = (view: EditorView, sideMenu: HTMLDivElement | null) => {
    dragHandleElement = createDragHandleElement();
    dragHandleElement.addEventListener("dragstart", (e) => handleDragStart(e, view));
    dragHandleElement.addEventListener("dragend", (e) => handleDragEnd(e, view));
    dragHandleElement.addEventListener("click", (e) => handleClick(e, view));
    dragHandleElement.addEventListener("contextmenu", (e) => handleClick(e, view));

    const dragOverHandler = (e: DragEvent) => {
      e.preventDefault();
      if (isDragging) {
        lastClientY = e.clientY;
      }
    };

    const mouseMoveHandler = (e: MouseEvent) => {
      if (isMouseInsideWhileDragging) {
        handleDragEnd(e, view);
      }
    };

    const dragLeaveHandler = (e: DragEvent) => {
      if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        isMouseInsideWhileDragging = true;

        const windowMiddleY = window.innerHeight / 2;

        if (lastClientY < windowMiddleY) {
          isDraggedOutsideWindow = "top";
        } else {
          isDraggedOutsideWindow = "bottom";
        }
      }
    };

    const dragEnterHandler = () => {
      isDraggedOutsideWindow = false;
    };

    window.addEventListener("dragleave", dragLeaveHandler);
    window.addEventListener("dragenter", dragEnterHandler);

    document.addEventListener("dragover", dragOverHandler);
    document.addEventListener("mousemove", mouseMoveHandler);

    hideDragHandle();

    sideMenu?.appendChild(dragHandleElement);

    return {
      destroy: () => {
        dragHandleElement?.remove?.();
        dragHandleElement = null;
        isDragging = false;
        if (scrollAnimationFrame) {
          cancelAnimationFrame(scrollAnimationFrame);
          scrollAnimationFrame = null;
        }
        window.removeEventListener("dragleave", dragLeaveHandler);
        window.removeEventListener("dragenter", dragEnterHandler);
        document.removeEventListener("dragover", dragOverHandler);
        document.removeEventListener("mousemove", mouseMoveHandler);
      },
    };
  };
  const domEvents = {
    mousemove: () => showDragHandle(),
    dragenter: (view: EditorView) => {
      view.dom.classList.add("dragging");
      hideDragHandle();
    },
    drop: (view: EditorView, event: DragEvent) => {
      view.dom.classList.remove("dragging");
      hideDragHandle();
      let droppedNode: Node | null = null;
      const dropPos = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });

      if (!dropPos) return;

      if (view.state.selection instanceof NodeSelection) {
        droppedNode = view.state.selection.node;
      }

      if (!droppedNode) return;

      const resolvedPos = view.state.doc.resolve(dropPos.pos);
      let isDroppedInsideList = false;
      let dropDepth = 0;

      // Traverse up the document tree to find if we're inside a list item
      for (let i = resolvedPos.depth; i > 0; i--) {
        if (resolvedPos.node(i).type.name === CORE_EXTENSIONS.LIST_ITEM) {
          isDroppedInsideList = true;
          dropDepth = i;
          break;
        }
      }

      // Handle nested list items and task items
      if (droppedNode.type.name === CORE_EXTENSIONS.LIST_ITEM) {
        let slice = view.state.selection.content();
        let newFragment = slice.content;

        // If dropping outside a list or at a different depth, adjust the structure
        if (!isDroppedInsideList || dropDepth !== resolvedPos.depth) {
          // Flatten the structure if needed
          newFragment = flattenListStructure(newFragment, view.state.schema);
        }

        // Wrap in appropriate list type if dropped outside a list
        if (!isDroppedInsideList) {
          const listNodeType =
            listType === "OL" ? view.state.schema.nodes.orderedList : view.state.schema.nodes.bulletList;
          newFragment = Fragment.from(listNodeType.create(null, newFragment));
        }

        slice = new Slice(newFragment, slice.openStart, slice.openEnd);
        view.dragging = { slice, move: event.ctrlKey };
      }
    },
    dragend: (view: EditorView) => {
      view.dom.classList.remove("dragging");
    },
  };

  return {
    view,
    domEvents,
  };
};

/**
 * Flatten a nested list / task-list Fragment to a single-level Fragment of
 * `listItem` / `taskItem` nodes. Used by `DragHandlePlugin`'s drop handler
 * when the dropped slice has a different depth than the drop target so the
 * insertion does not carry stale nesting (e.g., dropping a deeply nested
 * item into a top-level list lands flat at the target depth).
 */
// Helper function to flatten nested list structure
function flattenListStructure(fragment: Fragment, schema: Schema): Fragment {
  const result: Node[] = [];
  fragment.forEach((node) => {
    if (node.type === schema.nodes.listItem || node.type === schema.nodes.taskItem) {
      result.push(node);
      if (
        node.content.firstChild &&
        (node.content.firstChild.type === schema.nodes.bulletList ||
          node.content.firstChild.type === schema.nodes.orderedList)
      ) {
        const subList = node.content.firstChild;
        const flattened = flattenListStructure(subList.content, schema);
        flattened.forEach((subNode) => result.push(subNode));
      }
    }
  });
  return Fragment.from(result);
}

/**
 * Resolve the block under a click / dragstart event and dispatch a
 * `NodeSelection` for it.
 *
 * Adjusts the resolved position when the target is a table (the
 * `posAtCoords` result lands inside a cell — subtract 2 to land on the
 * table node) or a blockquote (probe the leftmost pixel via
 * `nodePosAtDOMForBlockQuotes` so the selection wraps the blockquote, not
 * its inner paragraph). For nested list / task items, walks to the LI / TI
 * boundary via `$pos.before($pos.depth)` so the selection wraps the item
 * rather than its inline child.
 *
 * On drag start (`isDragStart === true`): also captures the parent
 * `<ol>` / `<ul>` tag name as `listType` (used later by the drop handler to
 * choose the rewrap list type when the drop falls outside any list) and
 * writes the serialized selection HTML / text to `event.dataTransfer`. The
 * defensive `!event.dataTransfer` early-return guards against the nullable
 * `DragEvent.dataTransfer` type even though it is always populated during a
 * real dragstart.
 */
const handleNodeSelection = (
  event: MouseEvent | DragEvent,
  view: EditorView,
  isDragStart: boolean,
  options: SideMenuPluginProps
) => {
  let listType = "";
  view.focus();

  const node = nodeDOMAtCoords({
    x: event.clientX + 50 + options.dragHandleWidth,
    y: event.clientY,
  });

  if (!(node instanceof Element)) return;

  let draggedNodePos = nodePosAtDOM(node, view, options);
  if (draggedNodePos == null || draggedNodePos < 0) return;

  if (node.matches("table")) {
    draggedNodePos = draggedNodePos - 2;
  } else if (node.matches("blockquote")) {
    draggedNodePos = nodePosAtDOMForBlockQuotes(node, view);
    if (draggedNodePos === null || draggedNodePos === undefined) return;
  } else {
    // Resolve the position to get the parent node
    const $pos = view.state.doc.resolve(draggedNodePos);

    // If it's a nested list item or task item, move up to the item level
    if (
      [CORE_EXTENSIONS.LIST_ITEM, CORE_EXTENSIONS.TASK_ITEM].includes($pos.parent.type.name as CORE_EXTENSIONS) &&
      $pos.depth > 1
    ) {
      draggedNodePos = $pos.before($pos.depth);
    }
  }

  const docSize = view.state.doc.content.size;
  draggedNodePos = Math.max(0, Math.min(draggedNodePos, docSize));

  // Use NodeSelection to select the node at the calculated position
  const nodeSelection = NodeSelection.create(view.state.doc, draggedNodePos);

  // Dispatch the transaction to update the selection
  view.dispatch(view.state.tr.setSelection(nodeSelection));

  if (isDragStart) {
    // Additional logic for drag start
    if (event instanceof DragEvent && !event.dataTransfer) return;

    if (
      [CORE_EXTENSIONS.LIST_ITEM, CORE_EXTENSIONS.TASK_ITEM].includes(nodeSelection.node.type.name as CORE_EXTENSIONS)
    ) {
      listType = node.closest("ol, ul")?.tagName || "";
    }

    const slice = view.state.selection.content();
    const { dom, text } = view.serializeForClipboard(slice);

    if (event instanceof DragEvent && event.dataTransfer) {
      event.dataTransfer.clearData();
      event.dataTransfer.setData("text/html", dom.innerHTML);
      event.dataTransfer.setData("text/plain", text);
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setDragImage(node, 0, 0);
    }

    view.dragging = { slice, move: event.ctrlKey };
  }

  return { listType };
};
