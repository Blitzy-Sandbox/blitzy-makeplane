/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared options-list renderer for dropdown panels in `@plane/ui/dropdown`.
 *
 * Handles three render states based on `options`:
 *   - `undefined` → loading (custom `loader` if supplied, else `DropdownOptionsLoader`).
 *   - `[]`        → "No matching results" placeholder.
 *   - non-empty   → mapped `Combobox.Option` rows.
 */

import { Combobox } from "@headlessui/react";

import React from "react";
import { CheckIcon } from "@plane/propel/icons";
// helpers
import { cn } from "../../utils";
// types
import type { IMultiSelectDropdownOptions, ISingleSelectDropdownOptions } from "../dropdown";
// components
import { DropdownOptionsLoader, InputSearch } from ".";

/**
 * Renders the search input (when enabled) and the scrollable options panel for both
 * single-select and multi-select dropdown variants.
 *
 * Each row is a Headless UI `Combobox.Option`, which provides the `active` (hover/focus) and
 * `selected` render-prop states used to drive styling and the trailing checkmark.
 * `option.className` is invoked with both flags so consumers can compute styling against the
 * current row state.
 *
 * When `renderItem` is supplied, the consumer's renderer takes over; otherwise the panel
 * shows the option's `value` plus a checkmark on selected rows.
 *
 * Click on a row optionally invokes `handleClose` — single-select wires this to close the
 * panel after selection; multi-select omits `handleClose` so the panel stays open across
 * toggles.
 *
 * Props (see `IDropdownOptions` and its variant narrowings in `../dropdown.d.ts`):
 *   - `isOpen`, `query`, `setQuery`: control the inner `InputSearch`.
 *   - `disableSearch`: when true, the search input is hidden and the options list reclaims
 *     the freed space (top margin is removed).
 *   - `inputPlaceholder` / `inputClassName` / `inputIcon` / `inputContainerClassName`:
 *     forwarded to `InputSearch`.
 *   - `keyExtractor` (required): yields a stable key per option (used for React `key` and
 *     `Combobox.Option.value`).
 *   - `renderItem`: optional custom row renderer; falls back to plain `value` + checkmark.
 *   - `options`: `undefined` → loader, `[]` → empty-state placeholder, otherwise → mapped rows.
 *   - `handleClose`: optional; when set, every row click invokes it (single-select behavior).
 *   - `loader`: optional custom loading node; when omitted, `DropdownOptionsLoader` is used.
 *   - `isMobile` (default `false`): forwarded to `InputSearch` to suppress auto-focus on
 *     mobile.
 *   - `value`: variant-specific (string for single-select, string[] for multi-select); used
 *     by Headless UI to derive each row's `selected` state via `Combobox`.
 *
 * Accessibility: Headless UI `Combobox.Option` applies `role="option"` and `aria-selected`
 * (mirrors the combobox's `value` so single-select sets it on one row and multi-select sets
 * it on every selected row). Keyboard navigation (Arrow keys to traverse, Enter to select) is
 * inherited from `Combobox`.
 */
export function DropdownOptions(props: IMultiSelectDropdownOptions | ISingleSelectDropdownOptions) {
  const {
    isOpen,
    query,
    setQuery,
    inputIcon,
    inputPlaceholder,
    inputClassName,
    inputContainerClassName,
    disableSearch,
    keyExtractor,
    options,
    handleClose,
    renderItem,
    loader,
    isMobile = false,
  } = props;
  return (
    <>
      {!disableSearch && (
        <InputSearch
          isOpen={isOpen}
          query={query}
          updateQuery={(query) => setQuery(query)}
          inputIcon={inputIcon}
          inputPlaceholder={inputPlaceholder}
          inputClassName={inputClassName}
          inputContainerClassName={inputContainerClassName}
          isMobile={isMobile}
        />
      )}
      <div className={cn("max-h-48 space-y-1 overflow-y-scroll", !disableSearch && "mt-2")}>
        <>
          {options ? (
            options.length > 0 ? (
              options?.map((option) => (
                <Combobox.Option
                  key={keyExtractor(option)}
                  value={keyExtractor(option)}
                  disabled={option.disabled}
                  className={({ active, selected }) =>
                    cn(
                      "flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                      {
                        "bg-layer-1": active,
                        "text-primary": selected,
                        "text-secondary": !selected,
                      },
                      option.className && option.className({ active, selected })
                    )
                  }
                  onClick={handleClose}
                >
                  {({ selected }) => (
                    <>
                      {renderItem ? (
                        <>{renderItem({ value: keyExtractor(option), selected, disabled: option.disabled })}</>
                      ) : (
                        <>
                          <span className="flex-grow truncate">{option.value}</span>
                          {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                        </>
                      )}
                    </>
                  )}
                </Combobox.Option>
              ))
            ) : (
              <p className="px-1.5 py-1 text-placeholder italic">No matching results</p>
            )
          ) : loader ? (
            <> {loader} </>
          ) : (
            <DropdownOptionsLoader />
          )}
        </>
      </div>
    </>
  );
}
