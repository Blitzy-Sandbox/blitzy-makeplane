/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Headless UI-based custom select dropdown for non-search single-value selection.
 *
 * Built on Headless UI `Combobox` (used as a controlled select, NOT a search input — the input
 * element is omitted from the trigger). Renders the options panel through `createPortal` so it
 * can escape parent overflow/transform contexts, and uses `react-popper` for placement.
 *
 * The internal `DropdownContext` shares a `closeDropdown` callback with the nested `Option`
 * subcomponent so each option can dismiss the panel on click regardless of whether Headless UI
 * has fired its own `onChange` (e.g., when the user re-clicks an already-selected option).
 */

import { Combobox } from "@headlessui/react";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { useOutsideClickDetector } from "@plane/hooks";
import { CheckIcon, ChevronDownIcon } from "@plane/propel/icons";
// plane helpers
// hooks
import { useDropdownKeyDown } from "../hooks/use-dropdown-key-down";
// helpers
import { cn } from "../utils";
// types
import type { ICustomSelectItemProps, ICustomSelectProps } from "./helper";

// Context to share the close handler with option components
const DropdownContext = createContext<() => void>(() => {});

/**
 * Non-searchable single-value select rendered as a Headless UI `Combobox` (no input element).
 *
 * Use this for short option lists (statuses, priorities, simple enums). For long lists or
 * search-on-type behavior use `CustomSearchSelect` instead. The options panel is rendered via
 * `createPortal` into `document.body` so it escapes parent overflow/transform contexts and is
 * positioned by `react-popper`.
 *
 * Selection auto-closes the dropdown: after the consumer's `onChange` runs, the panel calls
 * `closeDropdown()`. The internal `DropdownContext` exposes that close handler to the nested
 * `Option` subcomponent so a click on an already-selected option (which would NOT trigger
 * Headless UI's `onChange`) still dismisses the panel.
 *
 * Props (see `ICustomSelectProps` in `./helper`):
 *   - `value` (required): currently selected value.
 *   - `onChange` (required): fires with the new value; the panel auto-closes after the call.
 *   - `children` (required): typically `<CustomSelect.Option value={...}>` elements.
 *   - Trigger: `customButton` / `customButtonClassName` / `buttonClassName` / `label` /
 *     `noChevron` / `input` (`true` → larger 13px padding, `false` → 11px).
 *   - Panel: `placement` (default `"bottom-start"`), `maxHeight` (default `"md"`),
 *     `optionsClassName`, `className`.
 *   - Behavior: `disabled` (default `false`), `tabIndex`.
 *
 * Side effects: `openDropdown` imperatively focuses the trigger button via `referenceElement`;
 * `useOutsideClickDetector(dropdownRef, closeDropdown)` from `@plane/hooks` closes on outside
 * clicks; `useDropdownKeyDown` wires Enter-to-open / Escape-to-close.
 *
 * Accessibility: Headless UI Combobox provides ARIA `combobox` role + `aria-expanded`. Keyboard:
 * Enter opens (via `useDropdownKeyDown`), arrows navigate options, Enter commits, Escape closes.
 * The trigger is a native `<button type="button">` so Space/Enter activate it.
 */
function CustomSelect(props: ICustomSelectProps) {
  const {
    customButtonClassName = "",
    buttonClassName = "",
    placement,
    children,
    className = "",
    customButton,
    disabled = false,
    input = false,
    label,
    maxHeight = "md",
    noChevron = false,
    onChange,
    optionsClassName = "",
    value,
    tabIndex,
  } = props;
  // states
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
  });

  const openDropdown = useCallback(() => {
    setIsOpen(true);
    if (referenceElement) referenceElement.focus();
  }, [referenceElement]);

  const closeDropdown = useCallback(() => setIsOpen(false), []);
  const handleKeyDown = useDropdownKeyDown(openDropdown, closeDropdown, isOpen);
  useOutsideClickDetector(dropdownRef, closeDropdown);

  const toggleDropdown = useCallback(() => {
    if (isOpen) closeDropdown();
    else openDropdown();
  }, [closeDropdown, isOpen, openDropdown]);

  return (
    <DropdownContext.Provider value={closeDropdown}>
      <Combobox
        as="div"
        ref={dropdownRef}
        tabIndex={tabIndex}
        value={value}
        onChange={(val) => {
          onChange?.(val);
          closeDropdown();
        }}
        className={cn("relative flex-shrink-0 text-left", className)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      >
        <>
          {customButton ? (
            <Combobox.Button as={React.Fragment}>
              <button
                ref={setReferenceElement}
                type="button"
                className={`flex items-center justify-between gap-1 rounded text-11 ${
                  disabled ? "cursor-not-allowed text-secondary" : "cursor-pointer hover:bg-layer-transparent-hover"
                } ${customButtonClassName}`}
                onClick={toggleDropdown}
              >
                {customButton}
              </button>
            </Combobox.Button>
          ) : (
            <Combobox.Button as={React.Fragment}>
              <button
                ref={setReferenceElement}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-1 rounded border border-strong",
                  {
                    "px-3 py-2 text-13": input,
                    "px-2 py-1 text-11": !input,
                    "cursor-not-allowed text-secondary": disabled,
                    "cursor-pointer hover:bg-layer-transparent-hover": !disabled,
                  },
                  buttonClassName
                )}
                onClick={toggleDropdown}
              >
                {label}
                {!noChevron && !disabled && <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />}
              </button>
            </Combobox.Button>
          )}
        </>
        {isOpen &&
          createPortal(
            <Combobox.Options data-prevent-outside-click>
              <div
                className={cn(
                  "z-30 my-1 min-w-48 overflow-y-scroll rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-2 py-2.5 text-11 whitespace-nowrap focus:outline-none",
                  optionsClassName
                )}
                ref={setPopperElement}
                style={styles.popper}
                {...attributes.popper}
              >
                <div
                  className={cn("space-y-1 overflow-y-scroll", {
                    "max-h-60": maxHeight === "lg",
                    "max-h-48": maxHeight === "md",
                    "max-h-36": maxHeight === "rg",
                    "max-h-28": maxHeight === "sm",
                  })}
                >
                  {children}
                </div>
              </div>
            </Combobox.Options>,
            document.body
          )}
      </Combobox>
    </DropdownContext.Provider>
  );
}

/**
 * Single option rendered inside a `CustomSelect`. Wraps Headless UI `Combobox.Option` and
 * displays a `CheckIcon` when selected. Active (hovered/keyboard-focused) rows get a transparent
 * background tint via the `bg-layer-transparent-hover` class.
 *
 * The `setTimeout(closeDropdown, 0)` in `handleClick` is intentional: Headless UI fires
 * `onChange` BEFORE `onClick`, but only when the selected value actually changes. A user
 * re-clicking the already-selected option would leave the panel open without this explicit
 * close. The 0 ms deferral lets Headless UI's selection handler run first for new selections,
 * then closes the panel uniformly for both new and re-selection cases.
 *
 * Props (see `ICustomSelectItemProps` in `./helper`):
 *   - `value` (required): option value matched against the parent select's `value`.
 *   - `children` (required): rendered content (label, icons, etc.).
 *   - `className`: optional Tailwind class overrides.
 */
function Option(props: ICustomSelectItemProps) {
  const { children, value, className } = props;
  const closeDropdown = useContext(DropdownContext);

  const handleClick = useCallback(() => {
    // Close dropdown for both new and already-selected options.
    // Use setTimeout to ensure HeadlessUI's onChange handler fires first for new selections.
    // For already-selected options, this ensures the dropdown closes since onChange won't fire.
    setTimeout(() => {
      closeDropdown();
    }, 0);
  }, [closeDropdown]);

  return (
    <Combobox.Option
      value={value}
      className={({ active }) =>
        cn(
          "flex cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 text-secondary select-none",
          {
            "bg-layer-transparent-hover": active,
          },
          className
        )
      }
      onClick={handleClick}
    >
      {({ selected }) => (
        <div className="flex w-full items-center justify-between gap-2">
          {children}
          {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
        </div>
      )}
    </Combobox.Option>
  );
}

CustomSelect.Option = Option;

export { CustomSelect };
