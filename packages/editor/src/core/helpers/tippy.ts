/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared keyboard-navigation primitives for command-list popovers (emoji picker, mentions, slash commands).
 *
 * Filename predates the migration from `tippy.js` to `@floating-ui/dom` (see `helpers/floating-ui.ts`); the helpers themselves now back any popover that exposes a section/item navigation contract.
 */

/**
 * Imperative handle exposed by command-list popovers (emoji, mentions, slash commands) to forward keystrokes from the editor to the popover for highlight-row navigation.
 */
export type CommandListInstance = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

type TArgs = {
  event: KeyboardEvent;
  sections: {
    items: any[];
  }[];
  selectedIndex: {
    section: number;
    item: number;
  };
};

/**
 * Keys consumed by the command-list popover for highlight-row navigation; surfaced as a shared constant so the editor's `handleDOMEvents.keydown` can short-circuit when the popover is visible.
 *
 * Currently `["ArrowUp", "ArrowDown", "Enter"]`.
 */
export const DROPDOWN_NAVIGATION_KEYS = ["ArrowUp", "ArrowDown", "Enter"];

/**
 * Computes the next `{ section, item }` selection in a multi-section command list given an ArrowUp / ArrowDown event, wrapping across sections and across the start / end of the list.
 *
 * Consumed by `extensions/mentions/mentions-list-dropdown.tsx` and `extensions/slash-commands/command-menu.tsx` to keep highlight navigation behavior consistent across all command-list surfaces.
 *
 * @returns `undefined` when sections are empty after the wrap calculation (defensive); otherwise the next `{ section, item }` tuple.
 */
export const getNextValidIndex = (
  args: TArgs
):
  | {
      section: number;
      item: number;
    }
  | undefined => {
  const { event, sections, selectedIndex } = args;
  const direction = event.key === "ArrowUp" ? "up" : "down";
  if (!sections.length) return { section: 0, item: 0 };
  // next available selection
  let nextSection = selectedIndex.section;
  let nextItem = selectedIndex.item;

  if (direction === "up") {
    nextItem--;
    if (nextItem < 0) {
      // Move to previous section
      nextSection--;
      if (nextSection < 0) {
        // Wrap to last section
        nextSection = sections?.length - 1;
      }
      nextItem = sections?.[nextSection]?.items?.length - 1;
    }
  } else {
    nextItem++;
    if (nextItem >= sections?.[nextSection]?.items?.length) {
      // Move to next section
      nextSection++;
      if (nextSection >= sections?.length) {
        // Wrap to first section
        nextSection = 0;
      }
      nextItem = 0;
    }
  }

  return { section: nextSection, item: nextItem };
};
