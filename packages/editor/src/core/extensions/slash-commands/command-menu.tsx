/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Dropdown UI container for the slash-command editor extension.
 *
 * This module renders the React popup that the `Suggestion` plugin in `./root`
 * mounts via TipTap's `ReactRenderer`. The component is a `forwardRef` whose
 * exposed handle (see `useImperativeHandle`) lets the parent `Suggestion`
 * plugin forward editor keystrokes (ArrowUp/ArrowDown/Enter) into the menu's
 * keyboard handler — i.e. `component.ref?.onKeyDown({ event })` from `./root`.
 *
 * The popup consumes grouped sections produced by `getSlashCommandFilteredSections`
 * in `./command-items-list`, renders each item via `CommandMenuItem`, and
 * invokes the suggestion `command(item)` callback when the user selects a row.
 */
import { FloatingOverlay } from "@floating-ui/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
// helpers
import { DROPDOWN_NAVIGATION_KEYS, getNextValidIndex } from "@/helpers/tippy";
// types
import type { ISlashCommandItem } from "@/types";
// components
import type { TSlashCommandSection } from "./command-items-list";
import { CommandMenuItem } from "./command-menu-item";

/**
 * Props passed to the `SlashCommandsMenu` render component.
 *
 * Extends `SuggestionProps<TSlashCommandSection, ISlashCommandItem>` from
 * `@tiptap/suggestion` — the standard shape TipTap supplies to a suggestion
 * render component. The inherited fields used here are:
 * - `items: TSlashCommandSection[]` — the filtered, grouped catalog (destructured locally as `sections`).
 * - `command: (item: ISlashCommandItem) => void` — TipTap's selection callback; deletes the trigger range and runs the item's `command({ editor, range })`.
 * - `query: string` — the substring typed after the `/` trigger; forwarded to `CommandMenuItem` to highlight matched substrings.
 *
 * Adds:
 * - `onClose: () => void` — invoked by the menu on outside-click (and indirectly on Escape via `./root`'s `handleClose`) so the parent suggestion plugin can tear down the `ReactRenderer`.
 */
export type SlashCommandsMenuProps = SuggestionProps<TSlashCommandSection, ISlashCommandItem> & {
  onClose: () => void;
};

/**
 * Positioned floating popover that displays the filtered, grouped slash-command catalog for selection.
 *
 * Props (from {@link SlashCommandsMenuProps}):
 * - `items: TSlashCommandSection[]` (destructured locally as `sections`) — grouped catalog after filtering by the current query; produced by `getSlashCommandFilteredSections` in `./command-items-list`.
 * - `command: (item: ISlashCommandItem) => void` — TipTap suggestion callback invoked when the user selects an item via Enter or click; under the hood it deletes the trigger range and runs the item's `command({ editor, range })`.
 * - `query: string` — substring typed after the `/` trigger; passed through to `CommandMenuItem` for match highlighting.
 * - `onClose: () => void` — invoked by `useOutsideClickDetector` when the user clicks outside the container; the parent `./root` plugin reacts by destroying the `ReactRenderer` and removing the active dropbar registration.
 *
 * Keyboard navigation:
 * - **ArrowUp / ArrowDown** move the selection by one item and wrap around across sections — at the top of section 0 the selection wraps to the last item of the last section, and at the bottom of the last section it wraps to the first item of section 0.
 * - **Enter** invokes `selectItem(section, item)` which calls `command(item)` and triggers the item's editor mutation.
 * - **Escape** is NOT handled here; it is intercepted upstream in `./root`'s `Suggestion.onKeyDown`, which calls `handleClose(editor)` and that in turn calls back into the `onClose` prop.
 * - The keyboard handler is wired in two ways that must stay in sync: a document-level `keydown` listener used while the menu is mounted, and an imperative `onKeyDown` exposed via `useImperativeHandle` that the `Suggestion` plugin forwards editor keystrokes to. The imperative path delegates to `getNextValidIndex` from `@/helpers/tippy` (shared with sibling `./emoji` and `./mentions` menus for consistent navigation semantics).
 * - A `useLayoutEffect` calls `scrollIntoView({ block: "nearest" })` on the active item after every selection change so keyboard navigation always keeps the highlighted row visible.
 *
 * Accessibility considerations:
 * - Item rows are rendered by `CommandMenuItem` as `<button type="button">` with stable ids `item-${sectionIndex}-${itemIndex}` — the same ids the `scrollIntoView` lookup relies on.
 * - `click` and `mousedown` events are stopped from propagating on the container so the editor's selection underneath is not disturbed while the user interacts with the menu.
 * - `useOutsideClickDetector` from `@plane/hooks` closes the menu when the user clicks outside the container — it is wired directly to the `onClose` prop, which is the same handler the parent `./root` plugin uses to tear down the renderer.
 * - A `<FloatingOverlay lockScroll />` from `@floating-ui/react` sits behind the panel as a backdrop; `lockScroll` prevents the page from scrolling while the menu is open. The overlay and panel sit on adjacent z-index layers so the panel renders above the backdrop.
 * - The selected row is reflected visually via the `isSelected` prop forwarded to `CommandMenuItem` (which toggles a highlighted background class) — keyboard navigation, hover, and click all funnel through the same `selectedIndex` state.
 * - // INTENT UNCLEAR: the menu does not declare explicit `role="listbox"` / `role="option"` ARIA attributes despite implementing listbox-like keyboard semantics; adding them would be a behavioral change and is intentionally left to the AAP ambiguity protocol.
 *
 * Internal state:
 * - `selectedIndex` resets to `{ section: 0, item: 0 }` whenever `sections` changes (e.g. when the user types or erases characters and the filter result shifts) so the highlight always lands on the first available item.
 * - When the filtered catalog is empty the component returns `null` so the floating overlay does not flash on screen with nothing to choose.
 */
export const SlashCommandsMenu = forwardRef(function SlashCommandsMenu(props: SlashCommandsMenuProps, ref) {
  const { items: sections, command, query, onClose } = props;
  // states
  const [selectedIndex, setSelectedIndex] = useState({
    section: 0,
    item: 0,
  });
  // refs
  const commandListContainer = useRef<HTMLDivElement>(null);

  const selectItem = useCallback(
    (sectionIndex: number, itemIndex: number) => {
      const item = sections[sectionIndex]?.items?.[itemIndex];
      if (item) command(item);
    },
    [command, sections]
  );
  // handle arrow key navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (DROPDOWN_NAVIGATION_KEYS.includes(e.key)) {
        e.preventDefault();
        const currentSection = selectedIndex.section;
        const currentItem = selectedIndex.item;
        let nextSection = currentSection;
        let nextItem = currentItem;

        if (e.key === "ArrowUp") {
          nextItem = currentItem - 1;
          if (nextItem < 0) {
            nextSection = currentSection - 1;
            if (nextSection < 0) nextSection = sections.length - 1;
            nextItem = sections[nextSection]?.items?.length - 1;
          }
        }
        if (e.key === "ArrowDown") {
          nextItem = currentItem + 1;
          if (nextItem >= sections[currentSection]?.items?.length) {
            nextSection = currentSection + 1;
            if (nextSection >= sections.length) nextSection = 0;
            nextItem = 0;
          }
        }
        if (e.key === "Enter") {
          selectItem(currentSection, currentItem);
        }
        setSelectedIndex({
          section: nextSection,
          item: nextItem,
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sections, selectedIndex, setSelectedIndex, selectItem]);
  // initialize the select index to 0 by default
  useEffect(() => {
    setSelectedIndex({
      section: 0,
      item: 0,
    });
  }, [sections]);
  // scroll to the dropdown item when navigating via keyboard
  useLayoutEffect(() => {
    const container = commandListContainer?.current;
    if (!container) return;

    const item = container.querySelector(`#item-${selectedIndex.section}-${selectedIndex.item}`) as HTMLElement;

    // use scroll into view to bring the item in view if it is not in view
    item?.scrollIntoView({ block: "nearest" });
  }, [sections, selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!DROPDOWN_NAVIGATION_KEYS.includes(event.key)) return false;

      if (event.key === "Enter") {
        selectItem(selectedIndex.section, selectedIndex.item);
        return true;
      }

      const newIndex = getNextValidIndex({
        event,
        sections,
        selectedIndex,
      });

      if (newIndex) {
        setSelectedIndex(newIndex);
      }

      return true;
    },
  }));

  useOutsideClickDetector(commandListContainer, onClose);

  const areSearchResultsEmpty = sections.map((s) => s.items?.length).reduce((acc, curr) => acc + curr, 0) === 0;

  if (areSearchResultsEmpty) return null;

  return (
    <>
      {/* Backdrop */}
      <FloatingOverlay
        style={{
          zIndex: 99,
        }}
        lockScroll
      />
      <div
        id="slash-command"
        ref={commandListContainer}
        className="relative max-h-80 min-w-[12rem] space-y-2 overflow-y-auto rounded-md border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 shadow-raised-200"
        style={{
          zIndex: 100,
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        {sections.map((section, sectionIndex) => (
          <div key={section.key} className="space-y-2">
            {section.title && <h6 className="text-11 font-semibold text-tertiary">{section.title}</h6>}
            <div>
              {section.items?.map((item, itemIndex) => (
                <CommandMenuItem
                  key={item.key}
                  isSelected={sectionIndex === selectedIndex.section && itemIndex === selectedIndex.item}
                  item={item}
                  itemIndex={itemIndex}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectItem(sectionIndex, itemIndex);
                  }}
                  onMouseEnter={() =>
                    setSelectedIndex({
                      section: sectionIndex,
                      item: itemIndex,
                    })
                  }
                  sectionIndex={sectionIndex}
                  query={query}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
});

SlashCommandsMenu.displayName = "SlashCommandsMenu";
