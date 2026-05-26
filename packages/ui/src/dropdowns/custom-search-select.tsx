/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Headless UI-based custom select with a built-in search input for filtering options.
 *
 * Combines a Headless UI `Combobox` trigger with a portal-rendered options panel that contains
 * a `Combobox.Input` search field. Filtering is performed client-side against each option's
 * `query` string (case-insensitive substring match); async option fetching is the caller's
 * responsibility through the `options` prop.
 */

import { Combobox } from "@headlessui/react";
import { Info } from "lucide-react";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { useOutsideClickDetector } from "@plane/hooks";
import { CheckIcon, SearchIcon, ChevronDownIcon } from "@plane/propel/icons";
// plane imports
// local imports
import { Tooltip } from "@plane/propel/tooltip";
import { useDropdownKeyDown } from "../hooks/use-dropdown-key-down";
import { cn } from "../utils";
import type { ICustomSearchSelectProps } from "./helper";

/**
 * Searchable single- or multi-value select built on Headless UI `Combobox` with a portal-rendered
 * options panel.
 *
 * The panel contains a `Combobox.Input` search field. Filtering is performed client-side against
 * each option's `query` field (case-insensitive substring); async option loading is the caller's
 * responsibility (pass updated `options` as state changes). When `options` is `undefined` the
 * panel shows `Loading...`; when filtering yields zero results it shows `noResultsMessage`.
 *
 * Selection mode is determined by the discriminator `multiple`. In single-select mode a click on
 * any option auto-closes the panel; in multi-select mode the panel stays open so consumers can
 * accumulate selections.
 *
 * Props (see `ICustomSearchSelectProps` in `./helper`):
 *   - `options` (`ICustomSearchSelectOption[]`): values, content, optional tooltip, optional
 *     per-option `disabled`. Pass `undefined` to render a "Loading..." state.
 *   - `onChange` (required): fires with `value` (single) or `value[]` (multi). Owned by caller.
 *   - `value` + `multiple`: discriminated union — `{multiple: true, value: any[] | null}` or
 *     `{multiple?: false, value: any}`.
 *   - `customButton` / `label` / `noChevron` / `chevronClassName`: trigger customisation.
 *   - `placement` / `maxHeight` / `optionsClassName` / `footerOption`: panel customisation.
 *   - `onOpen` / `onClose`: open/close lifecycle hooks; `defaultOpen` for initial state.
 *   - `noResultsMessage` (default `"No matches found"`): shown when filter returns zero matches.
 *
 * Side effects: `onOpen` may fire twice on first open (once from the imperative `toggleDropdown`
 * and once from Headless UI's `{open}` render-prop transition). Consumers should treat `onOpen`
 * as idempotent.
 *
 * Accessibility: Headless UI Combobox provides ARIA `combobox` role on the input,
 * `aria-expanded`, `aria-autocomplete="list"`, arrow-key navigation, Enter to commit, Escape to
 * dismiss. The panel carries `data-prevent-outside-click` so consumer outside-click detectors
 * can opt out of closing on inside clicks. INTENT UNCLEAR: the search `Combobox.Input` has no
 * `aria-label`; screen readers fall back to the visible placeholder `"Search"`.
 */
export function CustomSearchSelect(props: ICustomSearchSelectProps) {
  const {
    customButtonClassName = "",
    buttonClassName = "",
    className = "",
    chevronClassName = "",
    customButton,
    placement,
    disabled = false,
    footerOption,
    input = false,
    label,
    maxHeight = "md",
    multiple = false,
    noChevron = false,
    onChange,
    options,
    onOpen,
    onClose,
    optionsClassName = "",
    value,
    tabIndex,
    noResultsMessage = "No matches found",
    defaultOpen = false,
  } = props;
  const [query, setQuery] = useState("");

  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
  });

  const filteredOptions =
    query === "" ? options : options?.filter((option) => option.query.toLowerCase().includes(query.toLowerCase()));

  const comboboxProps: any = {
    value,
    onChange,
    disabled,
  };

  if (multiple) comboboxProps.multiple = true;

  const openDropdown = () => {
    setIsOpen(true);
    if (referenceElement) referenceElement.focus();
    if (onOpen) onOpen();
  };

  const closeDropdown = () => {
    setIsOpen(false);
    onClose && onClose();
  };

  const handleKeyDown = useDropdownKeyDown(openDropdown, closeDropdown, isOpen);
  useOutsideClickDetector(dropdownRef, closeDropdown);

  const toggleDropdown = () => {
    if (isOpen) closeDropdown();
    else openDropdown();
  };

  return (
    <Combobox
      as="div"
      ref={dropdownRef}
      tabIndex={tabIndex}
      className={cn("relative flex-shrink-0 text-left", className)}
      onKeyDown={handleKeyDown}
      {...comboboxProps}
    >
      {({ open }: { open: boolean }) => {
        if (open && onOpen) onOpen();

        return (
          <>
            {customButton ? (
              <Combobox.Button as={React.Fragment}>
                <button
                  ref={setReferenceElement}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-1 text-11",
                    {
                      "cursor-not-allowed text-secondary": disabled,
                      "cursor-pointer hover:bg-layer-transparent-hover": !disabled,
                    },
                    customButtonClassName
                  )}
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
                    "flex w-full items-center justify-between gap-1 rounded-sm border-[0.5px] border-strong",
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
                  {!noChevron && !disabled && (
                    <ChevronDownIcon className={cn("h-3 w-3 flex-shrink-0", chevronClassName)} aria-hidden="true" />
                  )}
                </button>
              </Combobox.Button>
            )}
            {isOpen &&
              createPortal(
                <Combobox.Options data-prevent-outside-click static>
                  <div
                    className={cn(
                      "z-30 my-1 min-w-48 overflow-y-scroll rounded-md border-[0.5px] border-subtle-1 bg-surface-1 py-2.5 text-11 whitespace-nowrap focus:outline-none",
                      optionsClassName
                    )}
                    ref={setPopperElement}
                    style={styles.popper}
                    {...attributes.popper}
                  >
                    <div className="mx-2 flex items-center gap-1.5 rounded-sm border border-subtle px-2">
                      <SearchIcon className="h-3.5 w-3.5 text-placeholder" strokeWidth={1.5} />
                      <Combobox.Input
                        className="w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search"
                        displayValue={(assigned: any) => assigned?.name}
                      />
                    </div>
                    <div
                      className={cn("vertical-scrollbar mt-2 scrollbar-xs space-y-1 overflow-y-scroll px-2", {
                        "max-h-96": maxHeight === "2xl",
                        "max-h-80": maxHeight === "xl",
                        "max-h-60": maxHeight === "lg",
                        "max-h-48": maxHeight === "md",
                        "max-h-36": maxHeight === "rg",
                        "max-h-28": maxHeight === "sm",
                      })}
                    >
                      {filteredOptions ? (
                        filteredOptions.length > 0 ? (
                          filteredOptions.map((option) => (
                            <Combobox.Option
                              key={option.value}
                              value={option.value}
                              className={({ active }) =>
                                cn(
                                  "flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                                  {
                                    "bg-layer-transparent-hover": active,
                                    "cursor-not-allowed text-placeholder opacity-60": option.disabled,
                                  }
                                )
                              }
                              onClick={() => {
                                if (!multiple) closeDropdown();
                              }}
                              disabled={option.disabled}
                            >
                              {({ selected }) => (
                                <>
                                  <span className="flex-grow truncate">{option.content}</span>
                                  {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                                  {option.tooltip && (
                                    <>
                                      {typeof option.tooltip === "string" ? (
                                        <Tooltip tooltipContent={option.tooltip}>
                                          <Info className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer text-secondary" />
                                        </Tooltip>
                                      ) : (
                                        option.tooltip
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </Combobox.Option>
                          ))
                        ) : (
                          <p className="px-1.5 py-1 text-placeholder italic">{noResultsMessage}</p>
                        )
                      ) : (
                        <p className="px-1.5 py-1 text-placeholder italic">Loading...</p>
                      )}
                    </div>
                    {footerOption}
                  </div>
                </Combobox.Options>,
                document.body
              )}
          </>
        );
      }}
    </Combobox>
  );
}
