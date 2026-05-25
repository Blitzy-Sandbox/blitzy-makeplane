/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Interactive mention suggestion dropdown — the React UI that appears after a `@` trigger
 * while typing in any editor that wires `CustomMentionExtension`.
 *
 * Renders a `FloatingOverlay`-backed popover containing a debounced (300ms) list of
 * grouped search matches resolved through the caller-injected `searchCallback`. The list
 * supports arrow-key navigation, Enter to select, mouse hover to highlight, click to
 * select, and outside-click / Escape to close.
 *
 * Mounted by `renderMentionsDropdown` (see `./utils.ts`) inside a `ReactRenderer`, with
 * positioning anchored via floating-ui (see `@/helpers/floating-ui`).
 */

import { FloatingOverlay } from "@floating-ui/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { debounce } from "lodash-es";
// plane utils
import { useOutsideClickDetector } from "@plane/hooks";
import { cn } from "@plane/utils";
// helpers
import { DROPDOWN_NAVIGATION_KEYS, getNextValidIndex } from "@/helpers/tippy";
// types
import type { TMentionHandler, TMentionSection, TMentionSuggestion } from "@/types";

/**
 * Props consumed by `MentionsListDropdown`.
 *
 * Composition:
 *   - `SuggestionProps<TMentionSection, TMentionSuggestion>` — TipTap suggestion props
 *     including `command` (callback invoked on selection), `query` (current text after
 *     the `@` trigger), `items`, `clientRect`, `editor`, etc. Provided by
 *     `@tiptap/suggestion` at the lifecycle hook boundary.
 *   - `Pick<TMentionHandler, "searchCallback">` — async query resolver injected by the
 *     consumer; ultimately calls Plane's workspace member search API.
 *   - `onClose: () => void` — fired on outside-click or Escape; routed back to the
 *     `renderMentionsDropdown.onStart` `handleClose` so the active-dropbar marker is
 *     cleared and the React renderer is destroyed.
 */
export type MentionsListDropdownProps = SuggestionProps<TMentionSection, TMentionSuggestion> &
  Pick<TMentionHandler, "searchCallback"> & {
    onClose: () => void;
  };

/**
 * Mention suggestion list — a `forwardRef` React component that exposes an imperative
 * `onKeyDown` handler to `@tiptap/suggestion`.
 *
 * State:
 *   - `sections: TMentionSection[]` — grouped results returned by the latest `searchCallback`.
 *   - `selectedIndex: { section, item }` — keyboard/hover-driven highlight; reset to
 *     `{ section: 0, item: 0 }` whenever `sections` changes.
 *   - `isLoading: boolean` — true between the first keystroke and the next debounced
 *     `searchCallback` resolution.
 *
 * Search delegation (NOT a static list):
 *   The component invokes `searchCallback(query)` via a `lodash-es/debounce` wrapper at
 *   300ms. The callback is supplied by the editor consumer (web, live, plane-editor)
 *   and ultimately calls Plane's workspace member search API. The debounce cancels on
 *   unmount to prevent setState-on-unmounted-component warnings.
 *
 * Imperative API (exposed via `useImperativeHandle`):
 *   - `onKeyDown({ event })` — Called from `renderMentionsDropdown.onKeyDown` (utils.ts).
 *       * `Enter` → invokes `command({ ...item, id: uuidv4() })` for the current selection;
 *         the regenerated UUID is the mention node's per-insertion ProseMirror attribute.
 *       * `ArrowUp` / `ArrowDown` → moves `selectedIndex` via `getNextValidIndex` (wraps
 *         across sections); returns true so the editor does not also move the caret.
 *       * Any other key → returns false; TipTap's default handling proceeds.
 *
 * Accessibility / keyboard behavior:
 *   - Arrow keys navigate sections and items (wraps).
 *   - Enter inserts the highlighted item as a mention node.
 *   - Escape closes the dropdown (handled upstream in `utils.ts`'s `onKeyDown` to ensure
 *     the active-dropbar marker is cleared before unmount).
 *   - The highlighted item auto-scrolls into view via `useLayoutEffect` whenever
 *     `selectedIndex` changes (looks up `#mention-item-<sectionIdx>-<itemIdx>` in the
 *     scroll container).
 *   - `useOutsideClickDetector` (`@plane/hooks`) closes the dropdown on outside click.
 *   - `FloatingOverlay` (`@floating-ui/react`) renders a `zIndex: 99` backdrop with
 *     `lockScroll`; the panel itself is `zIndex: 100`. `onClick` / `onMouseDown` stop
 *     propagation so clicks inside the panel don't escape to the editor surface.
 *
 * Side effects:
 *   - Invokes `searchCallback` (network call to Plane workspace member API via the
 *     consumer's service layer).
 *   - Invokes `command()` from TipTap's suggestion plugin on selection — this writes a
 *     mention node into the editor document.
 *   - Does NOT call any Plane API directly; does NOT navigate.
 *   - On selection error or search error, logs to `console.error` (non-fatal).
 *
 * @param props - `MentionsListDropdownProps`.
 * @param ref - Forwarded ref expecting a `CommandListInstance` (imperative `onKeyDown`).
 */
export const MentionsListDropdown = forwardRef(function MentionsListDropdown(props: MentionsListDropdownProps, ref) {
  const { command, query, searchCallback, onClose } = props;
  // states
  const [sections, setSections] = useState<TMentionSection[]>([]);
  const [selectedIndex, setSelectedIndex] = useState({
    section: 0,
    item: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  // refs
  const dropdownContainer = useRef<HTMLDivElement>(null);

  const selectItem = useCallback(
    (sectionIndex: number, itemIndex: number) => {
      try {
        const item = sections?.[sectionIndex]?.items?.[itemIndex];
        const transactionId = uuidv4();
        if (item) {
          command({
            ...item,
            id: transactionId,
          });
        }
      } catch (error) {
        console.error("Error selecting mention item:", error);
      }
    },
    [command, sections]
  );

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

  // initialize the select index to 0 by default
  useEffect(() => {
    setSelectedIndex({
      section: 0,
      item: 0,
    });
  }, [sections]);

  // debounced search callback
  const debouncedSearchCallback = useCallback(
    debounce(async (searchQuery: string) => {
      try {
        const sectionsResponse = await searchCallback?.(searchQuery);
        if (sectionsResponse) {
          setSections(sectionsResponse);
        }
      } catch (error) {
        console.error("Failed to fetch suggestions:", error);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    [searchCallback]
  );

  // trigger debounced search when query changes
  useEffect(() => {
    if (query !== undefined && query !== null) {
      setIsLoading(true);
      void debouncedSearchCallback(query);
    }
  }, [query, debouncedSearchCallback]);

  // cancel pending debounced calls on unmount
  useEffect(
    () => () => {
      debouncedSearchCallback.cancel();
    },
    [debouncedSearchCallback]
  );

  // scroll to the dropdown item when navigating via keyboard
  useLayoutEffect(() => {
    const container = dropdownContainer?.current;
    if (!container) return;

    const item = container.querySelector(`#mention-item-${selectedIndex.section}-${selectedIndex.item}`) as HTMLElement;
    if (item) {
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();

      const isItemInView = itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom;

      if (!isItemInView) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  useOutsideClickDetector(dropdownContainer, onClose);

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
        ref={dropdownContainer}
        className="relative max-h-80 w-[14rem] space-y-2 overflow-y-auto rounded-md border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 shadow-raised-200"
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
        {isLoading ? (
          <div className="text-center text-13 text-placeholder">Loading...</div>
        ) : sections.length ? (
          sections.map((section, sectionIndex) => (
            <div key={section.key} className="space-y-2">
              {section.title && <h6 className="text-11 font-semibold text-tertiary">{section.title}</h6>}
              {section.items.map((item, itemIndex) => {
                const isSelected = sectionIndex === selectedIndex.section && itemIndex === selectedIndex.item;

                return (
                  <button
                    key={item.id}
                    id={`mention-item-${sectionIndex}-${itemIndex}`}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 truncate rounded-sm px-1 py-1.5 text-left text-11 text-secondary hover:bg-layer-1-hover",
                      {
                        "bg-layer-1-hover": isSelected,
                      }
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectItem(sectionIndex, itemIndex);
                    }}
                    onMouseEnter={() =>
                      setSelectedIndex({
                        section: sectionIndex,
                        item: itemIndex,
                      })
                    }
                  >
                    <span className="grid size-5 flex-shrink-0 place-items-center">{item.icon}</span>
                    {item.subTitle && (
                      <h5 className="flex-shrink-0 text-11 whitespace-nowrap text-tertiary">{item.subTitle}</h5>
                    )}
                    <p className="flex-grow truncate">{item.title}</p>
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <div className="text-center text-13 text-placeholder">No results</div>
        )}
      </div>
    </>
  );
});

MentionsListDropdown.displayName = "MentionsListDropdown";
