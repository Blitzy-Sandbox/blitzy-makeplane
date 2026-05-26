/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Multi-selection combobox-style dropdown for selecting one or more options with shared
 * filtering, sorting, and rendering primitives.
 *
 * Built on `@headlessui/react` `Combobox` (with the `multiple` prop) and `react-popper` for
 * floating-panel positioning. The trigger button and options panel come from `./common` so the
 * multi-select and single-select variants share one visual surface.
 */

import { Combobox } from "@headlessui/react";
import { sortBy } from "lodash-es";
import React, { useMemo, useRef, useState } from "react";
import { usePopper } from "react-popper";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
// local imports
import { useDropdownKeyPressed } from "../hooks/use-dropdown-key-pressed";
import { cn } from "../utils";
import { DropdownButton } from "./common";
import { DropdownOptions } from "./common/options";
import type { IMultiSelectDropdown } from "./dropdown";

/**
 * Combobox-style multi-value dropdown built on `@headlessui/react` and `react-popper`.
 *
 * The component is the multi-selection counterpart to the sibling `Dropdown` (single-select).
 * It owns only ephemeral UI state (open flag, search query, popper refs) and stays fully
 * controlled: the array of selected keys lives in the consumer and flows through
 * `value` / `onChange`. The trigger button and option list are delegated to `DropdownButton`
 * and `DropdownOptions` from `./common` so both variants share one visual surface.
 *
 * Props (see `IMultiSelectDropdown` in `./dropdown.d.ts` and the inherited `IDropdown`):
 *   - Root: `value` (string[], required), `onChange` (receives the full updated array),
 *           `options` (undefined → loader), `onOpen`, `onClose`, `containerClassName`
 *           (string or function), `tabIndex`, `placement` (default `"bottom-start"`),
 *           `disabled`.
 *   - Button: `buttonContent`, `buttonContainerClassName`, `buttonClassName`.
 *   - Search: `disableSearch`, `inputPlaceholder`, `inputClassName`, `inputIcon`,
 *             `inputContainerClassName`.
 *   - Options: `keyExtractor` (required), `optionsContainerClassName`, `queryArray`,
 *              `sortByKey`, `firstItem` (pin-to-top predicate), `renderItem`, `loader`
 *              (default `false`), `disableSorting`.
 *
 * No max/min selection prop is enforced by this component — the consumer is the single source
 * of truth for the selection array and may apply caps before calling `onChange`.
 *
 * MobX stores read: none. The component is a pure controlled primitive.
 *
 * Side effects: invokes `onOpen` / `onClose` on state transitions only. No API calls, no
 * navigation, and no store mutations originate inside this component. Unlike the single-select
 * variant, `useOutsideClickDetector` is wired in bubble phase (no capture-phase third arg),
 * so parent click handlers run before the panel closes.
 *
 * Sort logic (when `disableSorting` is false): primary by `firstItem` pin predicate, secondary
 * by membership in `value` so already-selected options stay pinned to the top of the panel,
 * tertiary by lowercased `sortByKey`. Differs from `single-select.tsx` which gates sorting on
 * `sortByKey` being set.
 *
 * Accessibility: the `multiple` prop on `<Combobox>` produces `aria-multiselectable="true"` on
 * the listbox. Trigger has `combobox` role, `aria-expanded`, and `aria-controls` (provided by
 * Headless UI). Keyboard: arrow keys traverse, Enter toggles selection without closing the
 * panel, Escape closes, Tab exits (via `useDropdownKeyPressed`). Typeahead is provided by the
 * inner search input when `disableSearch` is false.
 */
export function MultiSelectDropdown(props: IMultiSelectDropdown) {
  const {
    value,
    onChange,
    options,
    onOpen,
    onClose,
    containerClassName,
    tabIndex,
    placement,
    disabled,
    buttonContent,
    buttonContainerClassName,
    buttonClassName,
    disableSearch,
    inputPlaceholder,
    inputClassName,
    inputIcon,
    inputContainerClassName,
    keyExtractor,
    optionsContainerClassName,
    queryArray,
    sortByKey,
    firstItem,
    renderItem,
    loader = false,
    disableSorting,
  } = props;

  // states
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);

  // popper-js init
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  // handlers
  const toggleDropdown = () => {
    if (!isOpen) onOpen?.();
    setIsOpen((prevIsOpen) => !prevIsOpen);
    if (isOpen) onClose?.();
  };

  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    toggleDropdown();
  };

  const handleClose = () => {
    if (!isOpen) return;
    setIsOpen(false);
    onClose?.();
    setQuery?.("");
  };

  // options
  const sortedOptions = useMemo(() => {
    if (!options) return undefined;

    const filteredOptions = queryArray
      ? (options || []).filter((options) => {
          const queryString = queryArray.map((query) => options.data[query]).join(" ");
          return queryString.toLowerCase().includes(query.toLowerCase());
        })
      : options;

    if (disableSorting) return filteredOptions;

    return sortBy(filteredOptions, [
      (option) => firstItem && firstItem(option.data[option.value]),
      (option) => !(value ?? []).includes(option.data[option.value]),
      () => sortByKey && sortByKey.toLowerCase(),
    ]);
  }, [query, options]);

  // hooks
  const handleKeyDown = useDropdownKeyPressed(toggleDropdown, handleClose);

  useOutsideClickDetector(dropdownRef, handleClose);

  return (
    <Combobox
      as="div"
      ref={dropdownRef}
      value={value}
      onChange={onChange}
      className={cn(
        "h-full",
        typeof containerClassName === "function" ? containerClassName(isOpen) : containerClassName
      )}
      tabIndex={tabIndex}
      multiple
      onKeyDown={handleKeyDown}
      disabled={disabled}
    >
      <DropdownButton
        value={value}
        isOpen={isOpen}
        setReferenceElement={setReferenceElement}
        handleOnClick={handleOnClick}
        buttonContent={buttonContent}
        buttonClassName={buttonClassName}
        buttonContainerClassName={buttonContainerClassName}
        disabled={disabled}
      />

      {isOpen && (
        <Combobox.Options className="fixed z-10" static>
          <div
            className={cn(
              "my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 text-11 shadow-raised-200 focus:outline-none",
              optionsContainerClassName
            )}
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
          >
            <DropdownOptions
              isOpen={isOpen}
              query={query}
              setQuery={setQuery}
              inputIcon={inputIcon}
              inputPlaceholder={inputPlaceholder}
              inputClassName={inputClassName}
              inputContainerClassName={inputContainerClassName}
              disableSearch={disableSearch}
              keyExtractor={keyExtractor}
              options={sortedOptions}
              value={value}
              renderItem={renderItem}
              loader={loader}
            />
          </div>
        </Combobox.Options>
      )}
    </Combobox>
  );
}
