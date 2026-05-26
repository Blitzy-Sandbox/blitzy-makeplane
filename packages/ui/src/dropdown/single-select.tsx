/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single-selection combobox-style dropdown for selecting one option from a list with optional
 * search/filter, sort, and custom rendering.
 *
 * Built on `@headlessui/react` `Combobox` for accessible combobox semantics and `react-popper`
 * for floating-panel positioning. The shared trigger button and options panel come from
 * `./common` so this file owns only the single-value state and combobox wiring.
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
import type { ISingleSelectDropdown } from "./dropdown";

/**
 * Combobox-style single-value dropdown built on `@headlessui/react` and `react-popper`.
 *
 * The component owns only ephemeral UI state (open flag, search query, popper refs) and stays
 * fully controlled: selection lives in the consumer and flows through `value` / `onChange`.
 * The trigger button and option list are delegated to `DropdownButton` and `DropdownOptions`
 * from `./common` so multi-select and single-select share one visual surface.
 *
 * Naming note: the exported function is `Dropdown` (not `SingleSelectDropdown`) as a historical
 * counterpart to the explicit `MultiSelectDropdown` name; both names are part of the public API
 * and are preserved as-is by AAP system boundaries.
 *
 * Props (see `ISingleSelectDropdown` in `./dropdown.d.ts` and the inherited `IDropdown`):
 *   - Root: `value` (string, required), `onChange`, `options` (undefined → loader), `onOpen`,
 *           `onClose`, `containerClassName` (string or function), `tabIndex`,
 *           `placement` (default `"bottom-start"`), `disabled`.
 *   - Button: `buttonContent` (custom renderer), `buttonContainerClassName`, `buttonClassName`.
 *   - Search: `disableSearch`, `inputPlaceholder`, `inputClassName`, `inputIcon`,
 *             `inputContainerClassName`.
 *   - Options: `keyExtractor` (required), `optionsContainerClassName`, `queryArray` (fields
 *              joined for case-insensitive query matching), `sortByKey`, `firstItem`
 *              (pin-to-top predicate), `renderItem`, `loader` (default `false`),
 *              `disableSorting`.
 *
 * MobX stores read: none. The component is a pure controlled primitive; selection state lives
 * with the consumer and is the source of truth for behavior.
 *
 * Side effects: invokes `onOpen` / `onClose` on state transitions only. No API calls, no
 * navigation, and no store mutations originate inside this component. `useOutsideClickDetector`
 * is wired in capture phase (third arg `true`) so panels close before parent click handlers run.
 *
 * Sort logic (when `sortByKey` is set and `disableSorting` is false): primary by `firstItem`
 * pin predicate, secondary by membership in `value`, tertiary by lowercased `sortByKey`.
 * INTENT UNCLEAR: secondary sort uses `(value ?? []).includes(...)` against a single-string
 * `value` (inherited from the multi-select sort pattern); this is preserved as-is per system
 * boundaries even though `.includes` is being called on a string rather than an array.
 *
 * Accessibility: `combobox` role, `aria-expanded`, and `aria-controls` come from Headless UI.
 * Keyboard: arrow keys traverse options, Enter selects, Escape closes, Tab exits (via
 * `useDropdownKeyPressed`). Typeahead is provided by the inner search input when
 * `disableSearch` is false.
 */
export function Dropdown(props: ISingleSelectDropdown) {
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

    if (disableSorting || !sortByKey) return filteredOptions;

    return sortBy(filteredOptions, [
      (option) => firstItem && firstItem(option.data[option.value]),
      (option) => !(value ?? []).includes(option.data[option.value]),
      () => sortByKey && sortByKey.toLowerCase(),
    ]);
  }, [query, options]);

  // hooks
  const handleKeyDown = useDropdownKeyPressed(toggleDropdown, handleClose);

  useOutsideClickDetector(dropdownRef, handleClose, true);

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
              "my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2 text-11 shadow-raised-200 focus:outline-none",
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
              handleClose={handleClose}
            />
          </div>
        </Combobox.Options>
      )}
    </Combobox>
  );
}
