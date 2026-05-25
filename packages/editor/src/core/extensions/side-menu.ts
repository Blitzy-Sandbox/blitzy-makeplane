/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating side-menu extension for the Plane editor.
 *
 * Mounts an absolutely-positioned `<div id="editor-side-menu">` adjacent to
 * the editor DOM and repositions it on `mousemove` to align with the block
 * node under the cursor. The drag-handle (`@/plugins/drag-handle`) and
 * AI-handle (`@/plugins/ai-handle`) attach their interactive elements to
 * this shared container, which is created as a closure-scoped singleton per
 * editor instance inside the plugin's `view()` initializer.
 *
 * Public API:
 *   - {@link SideMenuExtension} — the TipTap extension factory consumed by
 *     the editor extensions registry.
 *   - {@link SideMenuPluginProps} — configuration shape passed to the
 *     underlying ProseMirror plugin.
 *   - {@link SideMenuHandleOptions} — return shape implemented by handle
 *     plugin factories (`AIHandlePlugin`, `DragHandlePlugin`).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// plugins
import { AIHandlePlugin } from "@/plugins/ai-handle";
import { DragHandlePlugin, nodeDOMAtCoords } from "@/plugins/drag-handle";

type Props = {
  aiEnabled: boolean;
  dragDropEnabled: boolean;
};

/**
 * Configuration for the side-menu ProseMirror plugin.
 *
 * - `dragHandleWidth`: horizontal pixel width reserved for the drag-handle UI.
 *   Also used as the horizontal probe offset (`+50 + dragHandleWidth`) when
 *   resolving the block node under the cursor.
 * - `handlesConfig.ai`: whether to mount the AI handle inside the side-menu
 *   container.
 * - `handlesConfig.dragDrop`: whether to mount the drag-and-drop handle inside
 *   the side-menu container.
 * - `scrollThreshold.up` / `.down`: pixel distance from the viewport edge at
 *   which auto-scroll engages during an in-progress drag operation; consumed
 *   by `DragHandlePlugin`.
 */
export type SideMenuPluginProps = {
  dragHandleWidth: number;
  handlesConfig: {
    ai: boolean;
    dragDrop: boolean;
  };
  scrollThreshold: {
    up: number;
    down: number;
  };
};

/**
 * Shape returned by handle plugin factories (`DragHandlePlugin`,
 * `AIHandlePlugin`) — supplies a `view` initializer that mounts the handle's
 * DOM element into the shared `editor-side-menu` container, plus an optional
 * `domEvents` map used by `SideMenu` to forward mouse/drag events from the
 * editor surface to each handle.
 */
export type SideMenuHandleOptions = {
  view: (view: EditorView, sideMenu: HTMLDivElement | null) => void;
  domEvents?: {
    [key: string]: (...args: any) => void;
  };
};

/**
 * Builds the floating side-menu TipTap extension that hosts drag and AI
 * handles next to every block node in the editor.
 *
 * The extension registers a single ProseMirror plugin (via
 * `addProseMirrorPlugins`) keyed under {@link CORE_EXTENSIONS.SIDE_MENU} and
 * hard-codes the side-menu geometry: `dragHandleWidth = 24` and
 * `scrollThreshold = { up: 200, down: 150 }`. The `aiEnabled` and
 * `dragDropEnabled` props from `Props` toggle the AI and drag-drop handle
 * mounts respectively.
 *
 * Behavior contract enforced by the underlying plugin:
 *   - Mounts a `<div id="editor-side-menu">` next to `view.dom.parentElement`.
 *   - On `mousemove`, repositions to align with the block under the cursor
 *     (offset by `+50 + dragHandleWidth` so the cursor never has to hover on
 *     the side menu itself); hides if the resolved node is a list container
 *     (`ul`, `ol`) because list MARKERS do not get their own handle.
 *   - Vertically centers on the first line of the block via the
 *     `(lineHeight - 20) / 2` plus `paddingTop` adjustment.
 *   - Horizontally subtracts 20px when AI is enabled (room for the AI
 *     button) and an additional 18px (or 5px inside table cells) for
 *     `ul:not([data-type=taskList]) li, ol li` so the menu aligns with the
 *     visual left edge of the list item rather than its marker.
 *   - Inside table cells (`td`/`th`), applies the smaller (5px) list-item
 *     adjustment because table-cell list-items render with different
 *     padding than document-level list-items.
 *   - On `table` nodes, nudges 8px down and 8px left to clear the table border.
 *   - On `mousewheel`, hides (the user is scrolling, not editing).
 *   - On plugin destroy, hides the menu.
 *
 * Drag and AI handles are wired by `core/plugins/drag-handle.ts` and
 * `core/plugins/ai-handle.ts`; each receives the mounted container reference
 * directly via `dragHandleView(view, editorSideMenu)` and
 * `aiHandleView(view, editorSideMenu)` — the extension does NOT register
 * `editor.storage` for the container.
 */
export const SideMenuExtension = (props: Props) => {
  const { aiEnabled, dragDropEnabled } = props;

  return Extension.create({
    name: CORE_EXTENSIONS.SIDE_MENU,
    addProseMirrorPlugins() {
      return [
        SideMenu({
          dragHandleWidth: 24,
          handlesConfig: {
            ai: aiEnabled,
            dragDrop: dragDropEnabled,
          },
          scrollThreshold: { up: 200, down: 150 },
        }),
      ];
    },
  });
};

/**
 * Captures absolute viewport coordinates of an element as `{ top, left, width }`.
 *
 * Wraps `getBoundingClientRect()` so callers can mutate `top`/`left`/`width`
 * during positioning math without affecting the source element's layout.
 */
const absoluteRect = (node: Element) => {
  const data = node.getBoundingClientRect();

  return {
    top: data.top,
    left: data.left,
    width: data.width,
  };
};

/**
 * Constructs the ProseMirror plugin that mounts and repositions the
 * `#editor-side-menu` container.
 *
 * Internal singleton-per-editor: the `editorSideMenu` div is created once at
 * factory invocation and appended to `view.dom.parentElement` inside the
 * plugin's `view()` callback. The drag-handle and AI-handle plugins
 * (`DragHandlePlugin`, `AIHandlePlugin`) are instantiated at factory time so
 * their `domEvents` maps can be forwarded from this plugin's
 * `handleDOMEvents` (mousemove, dragenter, drop, dragend).
 *
 * Hide/show triggers:
 *   - `mousemove` over a non-list block — show and reposition.
 *   - `mousemove` over a `ul`/`ol` container — hide (markers don't need
 *     their own handle).
 *   - `mousewheel` — hide (user is scrolling, not editing).
 *   - Plugin destroy — hide.
 *
 * Registered only by {@link SideMenuExtension}, which supplies a fixed
 * `dragHandleWidth = 24`, AI/dragDrop flags from `Props`, and scroll
 * thresholds `{ up: 200, down: 150 }`.
 */
const SideMenu = (options: SideMenuPluginProps) => {
  const { handlesConfig } = options;
  const editorSideMenu: HTMLDivElement | null = document.createElement("div");
  editorSideMenu.id = "editor-side-menu";
  // side menu view actions
  const hideSideMenu = () => {
    if (!editorSideMenu?.classList.contains("side-menu-hidden")) editorSideMenu?.classList.add("side-menu-hidden");
  };
  const showSideMenu = () => editorSideMenu?.classList.remove("side-menu-hidden");
  // side menu elements
  const { view: dragHandleView, domEvents: dragHandleDOMEvents } = DragHandlePlugin(options);
  const { view: aiHandleView, domEvents: aiHandleDOMEvents } = AIHandlePlugin(options);

  return new Plugin({
    key: new PluginKey("sideMenu"),
    view: (view) => {
      hideSideMenu();
      view?.dom.parentElement?.appendChild(editorSideMenu);
      // side menu elements' initialization
      if (handlesConfig.ai && !editorSideMenu.querySelector("#ai-handle")) {
        aiHandleView(view, editorSideMenu);
      }

      if (handlesConfig.dragDrop && !editorSideMenu.querySelector("#drag-handle")) {
        dragHandleView(view, editorSideMenu);
      }

      return {
        destroy: () => hideSideMenu(),
      };
    },
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) return;

          const node = nodeDOMAtCoords({
            x: event.clientX + 50 + options.dragHandleWidth,
            y: event.clientY,
          });

          if (!(node instanceof Element) || node.matches("ul, ol")) {
            hideSideMenu();
            return;
          }

          const compStyle = window.getComputedStyle(node);
          const lineHeight = parseInt(compStyle.lineHeight, 10);
          const paddingTop = parseInt(compStyle.paddingTop, 10);

          const rect = absoluteRect(node);

          rect.top += (lineHeight - 20) / 2;
          rect.top += paddingTop;

          if (handlesConfig.ai) {
            rect.left -= 20;
          }

          if (node.parentElement?.parentElement?.matches("td") || node.parentElement?.parentElement?.matches("th")) {
            if (node.matches("ul:not([data-type=taskList]) li, ol li")) {
              rect.left -= 5;
            }
          } else {
            // Li markers
            if (node.matches("ul:not([data-type=taskList]) li, ol li")) {
              rect.left -= 18;
            }
          }

          if (node.matches("table")) {
            rect.top += 8;
            rect.left -= 8;
          }

          rect.width = options.dragHandleWidth;

          if (!editorSideMenu) return;

          editorSideMenu.style.left = `${rect.left - rect.width}px`;
          editorSideMenu.style.top = `${rect.top}px`;
          showSideMenu();
          if (handlesConfig.dragDrop) {
            dragHandleDOMEvents?.mousemove();
          }
          if (handlesConfig.ai) {
            aiHandleDOMEvents?.mousemove?.();
          }
        },
        // keydown: () => hideSideMenu(),
        mousewheel: () => hideSideMenu(),
        dragenter: (view) => {
          if (handlesConfig.dragDrop) {
            dragHandleDOMEvents?.dragenter?.(view);
          }
        },
        drop: (view, event) => {
          if (handlesConfig.dragDrop) {
            dragHandleDOMEvents?.drop?.(view, event);
          }
        },
        dragend: (view) => {
          if (handlesConfig.dragDrop) {
            dragHandleDOMEvents?.dragend?.(view);
          }
        },
      },
    },
  });
};
