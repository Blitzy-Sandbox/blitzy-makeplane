/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating UI positioning helper for editor popovers anchored to the current ProseMirror selection.
 *
 * Wraps `@floating-ui/dom`'s `computePosition` + `autoUpdate` and feeds it a virtual reference element whose bounding rect derives from `posToDOMRect` over the editor's current selection — so popovers track the caret across scrolls, edits, and viewport resizes.
 */

import { computePosition, flip, shift, autoUpdate } from "@floating-ui/dom";
import type { Placement, ReferenceElement, Strategy } from "@floating-ui/dom";
import { posToDOMRect } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

/**
 * Callable signature of `updateFloatingUIFloaterPosition`. Returns a `cleanup` function the caller must invoke when the popover unmounts to stop the autoUpdate loop and avoid memory leaks.
 */
export type UpdateFloatingUIFloaterPosition = (
  editor: Editor,
  element: HTMLElement,
  options?: {
    elementStyle?: Partial<CSSStyleDeclaration>;
    placement?: Placement;
    strategy?: Strategy;
  }
) => {
  cleanup: () => void;
};

/**
 * Appends the given element to `document.body` and positions it next to the editor's current selection using `@floating-ui/dom`'s `computePosition`, with `shift()` and `flip()` middleware for viewport collision handling.
 *
 * Consumed by `extensions/emoji/suggestion.ts`, `extensions/mentions/utils.ts`, and `extensions/slash-commands/root.tsx` to render their command-list popovers; the returned `cleanup` MUST be called on popover teardown.
 *
 * @param editor - TipTap editor instance used to derive the selection's DOM rect via `posToDOMRect`.
 * @param element - Popover DOM node to position; appended to `document.body` as a side-effect.
 * @param options.placement - Floating UI placement (default `bottom-start`).
 * @param options.strategy - Floating UI strategy (default `fixed`); `fixed` is preferred for scrollable editor containers so the popover stays anchored to the caret.
 * @param options.elementStyle - Extra CSS overrides merged into the computed `style` object.
 * @returns Object with `cleanup` — call this on unmount to stop the autoUpdate observer.
 */
export const updateFloatingUIFloaterPosition: UpdateFloatingUIFloaterPosition = (editor, element, options) => {
  document.body.appendChild(element);

  const virtualElement: ReferenceElement = {
    getBoundingClientRect: () => posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
  };

  const cleanup = autoUpdate(virtualElement, element, () => {
    computePosition(virtualElement, element, {
      placement: options?.placement ?? "bottom-start",
      strategy: options?.strategy ?? "fixed",
      middleware: [shift(), flip()],
    })
      .then(({ x, y, strategy }) => {
        Object.assign(element.style, {
          width: "max-content",
          position: strategy,
          left: `${x}px`,
          top: `${y}px`,
          ...options?.elementStyle,
        });
      })
      .catch((error) => console.error("An error occurred while updating floating UI floater position:", error));
  });

  return {
    cleanup,
  };
};
