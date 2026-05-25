/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
/**
 * React presentation layer for the editor's `:`-triggered emoji autocomplete
 * popup. Mounted by `../suggestion.ts` via Tiptap's `ReactRenderer`; owns the
 * selected-row state, keyboard navigation (Arrow keys / Enter), mouse
 * selection, fade-in animation, scroll-into-view of the highlighted item,
 * outside-click dismissal (via {@link useOutsideClickDetector}), and renders
 * a {@link FloatingOverlay} backdrop with locked scrolling beneath the styled
 * dropdown panel.
 */

import { FloatingOverlay } from "@floating-ui/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { cn } from "@plane/utils";

/**
 * UI-local emoji shape consumed by the dropdown row renderer — a narrowed
 * subset of the editor-side `EmojiItem` (only the fields this component
 * reads: `name`, `emoji`, `shortcodes`, `tags`).
 */
export type EmojiItem = {
  name: string;
  emoji: string;
  shortcodes: string[];
  tags: string[];
};

/**
 * Imperative ref API exposed via {@link forwardRef} so that
 * `../suggestion.ts`'s `onKeyDown` lifecycle hook can forward Tiptap's
 * keyboard events into this component without direct DOM access.
 */
export type EmojiListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

/**
 * Props for {@link EmojisListDropdown}.
 *
 * Extends Tiptap's `SuggestionProps<EmojiItem, { name: string }>` (items,
 * command, query, clientRect, …) with:
 *   - `onClose` (required): callback invoked on outside-click dismissal.
 *   - `forceOpen` (optional, default `false`): keeps the dropdown rendered
 *     even when `query` is empty — used for programmatically-opened pickers
 *     (e.g., a toolbar emoji button).
 */
export type EmojisListDropdownProps = SuggestionProps<EmojiItem, { name: string }> & {
  onClose: () => void;
  forceOpen?: boolean;
};

/**
 * Scrollable emoji autocomplete popup with selected-row highlight, rendered
 * above a {@link FloatingOverlay} backdrop with locked body scroll.
 *
 * Props:
 *   - `items` (required, `EmojiItem[]`): filtered emoji rows from
 *     `../suggestion.ts`'s `items` callback.
 *   - `command` (required): called with `{ name }` on row selection (mouse
 *     click OR Enter when highlighted).
 *   - `query` (required): current query string after the `:` trigger.
 *   - `onClose` (required): invoked on outside-click dismissal.
 *   - `forceOpen` (optional, default `false`): keeps the popup rendered when
 *     `query` is empty — used for programmatically-opened pickers.
 *   - Inherited from `SuggestionProps`: `clientRect`, `editor`, `decorationNode`, …
 *
 * Stores: NONE — leaf presentation component, data flows entirely through
 * props.
 *
 * Side effects:
 *   - `command({ name })` on row selection (Enter or click).
 *   - `onClose()` on outside-click (via {@link useOutsideClickDetector}).
 *
 * Keyboard / accessibility:
 *   - ArrowUp/ArrowDown wrap-around via modulo on `items.length`.
 *   - Enter commits the highlighted item.
 *   - Escape is owned by `../suggestion.ts`'s `onKeyDown` (not this component).
 *   - Mouse hover updates `selectedIndex` so keyboard and pointer share one
 *     visual cursor.
 *   - Keyboard handling is suppressed when `items.length === 0` or when
 *     `query.length === 0 && !forceOpen` so the popup never intercepts
 *     editor typing in its empty state.
 *   - Items render as native `<button>` elements; no explicit ARIA listbox
 *     role is applied — relies on native button semantics.
 *
 * Rendering:
 *   - Returns `null` when `query.length === 0 && !forceOpen`.
 *   - A 50 ms `setTimeout` flips `isVisible` to `true` for a one-shot
 *     opacity-transition fade-in.
 *   - `useEffect` on `selectedIndex` scrolls the highlighted
 *     `<button id="emoji-item-${index}">` into view when it leaves the
 *     dropdown's visible bounds.
 *   - "No emojis found" empty state rendered when `items.length === 0`.
 *
 * Imperative ref ({@link EmojiListRef}): exposes `onKeyDown` so the parent
 * suggestion controller in `../suggestion.ts` can dispatch Tiptap keyboard
 * events into this component without reaching for the DOM. Mirrors the
 * `ReactRenderer<CommandListInstance, ...>` pattern used by the `mentions/`
 * and `slash-commands/` extension folders.
 */
export const EmojisListDropdown = forwardRef(function EmojisListDropdown(
  props: EmojisListDropdownProps,
  ref: React.ForwardedRef<EmojiListRef>
) {
  const { items, command, query, onClose, forceOpen = false } = props;
  // states
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);
  // refs
  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  const selectItem = useCallback(
    (index: number): void => {
      const item = items[index];
      if (item) {
        command({ name: item.name });
      }
    },
    [command, items]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      // Allow keyboard navigation if we have items to show
      if (items.length === 0) {
        return false;
      }

      // Don't handle keyboard if modal shouldn't be visible (query empty without forceOpen)
      if (query.length === 0 && !forceOpen) {
        return false;
      }

      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
    [items.length, query.length, forceOpen, selectItem, selectedIndex]
  );

  // Show animation
  useEffect(() => {
    setIsVisible(false);
    const timeout = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timeout);
  }, []);

  // Reset selection when items change
  useEffect(() => setSelectedIndex(0), [items]);

  // Scroll selected item into view
  useEffect(() => {
    const container = dropdownContainerRef.current;
    if (!container) return;

    const item = container.querySelector(`#emoji-item-${selectedIndex}`) as HTMLElement;
    if (item) {
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();

      if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps): boolean => handleKeyDown(event),
    }),
    [handleKeyDown]
  );

  useOutsideClickDetector(dropdownContainerRef, onClose);

  if (query.length === 0 && !forceOpen) return null;

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
        ref={dropdownContainerRef}
        className={cn(
          "invisible relative max-h-80 w-[14rem] space-y-2 overflow-y-auto rounded-md border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 opacity-0 shadow-raised-200 transition-opacity",
          {
            "visible opacity-100": isVisible,
          }
        )}
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
        {items.length ? (
          items.map((item, index) => {
            const isSelected = index === selectedIndex;
            const emojiKey = item.shortcodes.join(" - ");

            return (
              <button
                key={emojiKey}
                id={`emoji-item-${index}`}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 truncate rounded-sm px-2 py-1.5 text-left text-13 text-secondary transition-colors duration-150 hover:bg-layer-1-hover",
                  {
                    "bg-layer-1-hover": isSelected,
                  }
                )}
                onClick={() => selectItem(index)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="grid size-5 flex-shrink-0 place-items-center text-14">{item.emoji}</span>
                <span className="flex-grow truncate">
                  <span className="font-medium">:{item.name}:</span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="py-2 text-center text-13 text-placeholder">No emojis found</div>
        )}
      </div>
    </>
  );
});

EmojisListDropdown.displayName = "EmojisListDropdown";
