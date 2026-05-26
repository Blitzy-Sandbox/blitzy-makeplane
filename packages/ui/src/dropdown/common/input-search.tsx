/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared search input used inside the dropdown options panel for filtering options.
 *
 * Renders as a Headless UI `Combobox.Input` so Headless UI continues to receive typeahead
 * keystrokes while the parent dropdown owns the query state.
 */

import { Combobox } from "@headlessui/react";
import React, { useEffect, useRef } from "react";
import { SearchIcon } from "@plane/propel/icons";
// helpers
import { cn } from "../../utils";

/**
 * Internal prop contract for `InputSearch`. Not re-exported from the `common` barrel because
 * the dropdown variants pass these props through `DropdownOptions` rather than mounting
 * `InputSearch` directly.
 *
 * Non-obvious field semantics:
 *   - `isOpen` + `isMobile`: together drive the auto-focus effect. Auto-focus runs only when
 *     the panel is open AND the device is not mobile (mobile auto-focus pops the on-screen
 *     keyboard, which disrupts the dropdown UX).
 *   - `updateQuery`: parent-owned query setter; the input is fully controlled, with no
 *     internal state for the value.
 */
interface IInputSearch {
  isOpen: boolean;
  query: string;
  updateQuery: (query: string) => void;
  inputIcon?: React.ReactNode;
  inputContainerClassName?: string;
  inputClassName?: string;
  inputPlaceholder?: string;
  isMobile: boolean;
}

/**
 * Controlled search field rendered inside dropdown panels for filtering options.
 *
 * Pressing Escape while the query is non-empty clears the query in place (without bubbling
 * the Escape event), so the user can reset the filter without closing the dropdown. When the
 * query is already empty, Escape bubbles up to the surrounding `useDropdownKeyPressed` handler
 * which closes the dropdown — this two-stage Escape pattern is the WHY worth documenting.
 *
 * Auto-focus on open is suppressed on mobile to avoid disruptive on-screen keyboards.
 *
 * Props (see local `IInputSearch` interface):
 *   - `isOpen`, `isMobile`: drive the auto-focus effect.
 *   - `query`, `updateQuery`: parent-owned controlled value and setter.
 *   - `inputIcon` (default: `<SearchIcon />` from `@plane/propel/icons`): leading icon.
 *   - `inputPlaceholder` (default `"Search"`).
 *   - `inputClassName` / `inputContainerClassName`: optional Tailwind overrides.
 *
 * Accessibility: rendered as Headless UI `Combobox.Input` on a native `<input>` element;
 * keyboard navigation and combobox `aria-*` are managed by Headless UI. INTENT UNCLEAR:
 * the input lacks `type="search"`, `role="searchbox"`, and an `aria-label` — the only label
 * affordance is the visible placeholder text.
 */
export function InputSearch(props: IInputSearch) {
  const { isOpen, query, updateQuery, inputIcon, inputContainerClassName, inputClassName, inputPlaceholder, isMobile } =
    props;

  const inputRef = useRef<HTMLInputElement | null>(null);

  const searchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (query !== "" && e.key === "Escape") {
      e.stopPropagation();
      updateQuery("");
    }
  };

  useEffect(() => {
    if (isOpen && !isMobile) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      inputRef.current && inputRef.current.focus();
    }
  }, [isOpen, isMobile]);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border border-subtle bg-surface-2 px-2",
        inputContainerClassName
      )}
    >
      {inputIcon ? <>{inputIcon}</> : <SearchIcon className="h-4 w-4 text-tertiary" aria-hidden="true" />}
      <Combobox.Input
        as="input"
        ref={inputRef}
        className={cn(
          "w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none",
          inputClassName
        )}
        value={query}
        onChange={(e) => updateQuery(e.target.value)}
        placeholder={inputPlaceholder ?? "Search"}
        onKeyDown={searchInputKeyDown}
      />
    </div>
  );
}
