/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle list page header that renders an inline expandable search input plus a filters
 * dropdown trigger, mutating the cycle-filter store on every keystroke / filter toggle.
 *
 * Props:
 *   - projectId (string, required): project ID used as the partition key for filter
 *     mutations (updateFilters is keyed by project, so the right project's filter slice
 *     is updated).
 *
 * MobX stores read:
 *   - useCycleFilter (cycle filter store): currentProjectFilters (TCycleFilters) for the
 *     active filter selection, searchQuery for the live search input value, plus the
 *     updateFilters and updateSearchQuery action setters.
 *
 * Side effects:
 *   - Mutations (synchronous, MobX store-only):
 *       - updateFilters(projectId, { [key]: newValues }) on each filter toggle in
 *         handleFilters — toggles a value in/out of an array per filter key.
 *       - updateSearchQuery(string) on every keystroke in the search input.
 *   - DOM/ref interactions:
 *       - useRef on the input element; inputRef.current?.focus() when opening the search,
 *         .blur() on Escape when the query is already empty.
 *       - useOutsideClickDetector to collapse the search affordance when the user clicks
 *         away with an empty query.
 *   - Keyboard: Escape clears the query first, then collapses the input on a second press.
 *   - No direct API calls — all data flow is store-mediated.
 *
 * Consumers: rendered from the cycles list route header alongside view-level controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ListFilter } from "lucide-react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { IconButton } from "@plane/propel/icon-button";
import { useTranslation } from "@plane/i18n";
import { SearchIcon, CloseIcon } from "@plane/propel/icons";
import type { TCycleFilters } from "@plane/types";
import { cn, calculateTotalFilters } from "@plane/utils";
// components
import { FiltersDropdown } from "@/components/issues/issue-layouts/filters";
// hooks
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";
// local imports
import { CycleFiltersSelection } from "./dropdowns";

type Props = {
  projectId: string;
};

export const CyclesViewHeader = observer(function CyclesViewHeader(props: Props) {
  const { projectId } = props;
  // refs
  const inputRef = useRef<HTMLInputElement>(null);
  // hooks
  const { currentProjectFilters, searchQuery, updateFilters, updateSearchQuery } = useCycleFilter();
  const { t } = useTranslation();
  // states
  const [isSearchOpen, setIsSearchOpen] = useState(searchQuery !== "" ? true : false);
  // outside click detector hook
  useOutsideClickDetector(inputRef, () => {
    if (isSearchOpen && searchQuery.trim() === "") setIsSearchOpen(false);
  });

  const handleFilters = useCallback(
    (key: keyof TCycleFilters, value: string | string[]) => {
      if (!projectId) return;
      const newValues = currentProjectFilters?.[key] ?? [];

      if (Array.isArray(value))
        value.forEach((val) => {
          if (!newValues.includes(val)) newValues.push(val);
          else newValues.splice(newValues.indexOf(val), 1);
        });
      else {
        if (currentProjectFilters?.[key]?.includes(value)) newValues.splice(newValues.indexOf(value), 1);
        else newValues.push(value);
      }

      updateFilters(projectId, { [key]: newValues });
    },
    [currentProjectFilters, projectId, updateFilters]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (searchQuery && searchQuery.trim() !== "") updateSearchQuery("");
      else {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  const isFiltersApplied = calculateTotalFilters(currentProjectFilters ?? {}) !== 0;

  useEffect(() => {
    if (searchQuery.trim() !== "") setIsSearchOpen(true);
  }, [searchQuery]);

  return (
    <div className="flex items-center gap-2">
      {!isSearchOpen ? (
        <IconButton
          variant="ghost"
          size="lg"
          onClick={() => {
            setIsSearchOpen(true);
            inputRef.current?.focus();
          }}
          icon={SearchIcon}
        />
      ) : (
        <div
          className={cn(
            "ml-auto flex w-0 items-center justify-start gap-1 overflow-hidden rounded-md border border-transparent bg-surface-1 text-placeholder opacity-0 transition-[width] ease-linear",
            {
              "w-64 border-subtle px-2.5 py-1.5 opacity-100": isSearchOpen,
            }
          )}
        >
          <SearchIcon className="h-3.5 w-3.5" />
          <input
            ref={inputRef}
            className="w-full max-w-[234px] border-none bg-transparent text-13 text-primary placeholder:text-placeholder focus:outline-none"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => updateSearchQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          {isSearchOpen && (
            <button
              type="button"
              className="grid place-items-center"
              onClick={() => {
                updateSearchQuery("");
                setIsSearchOpen(false);
              }}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <FiltersDropdown
        icon={<ListFilter className="h-3 w-3" />}
        title={t("common.filters")}
        placement="bottom-end"
        isFiltersApplied={isFiltersApplied}
      >
        <CycleFiltersSelection filters={currentProjectFilters ?? {}} handleFiltersUpdate={handleFilters} />
      </FiltersDropdown>
    </div>
  );
});
