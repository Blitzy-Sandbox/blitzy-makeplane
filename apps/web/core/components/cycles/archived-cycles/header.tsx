/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top control bar for the archived-cycles route; renders the archive tabs, a
 * collapsible search input, and the cycle filters dropdown, mutating the
 * cycle-filter store on every keystroke / filter toggle.
 *
 * Props: NONE — project context is read from `useParams()` rather than passed in.
 * This component is rendered as a sibling of `ArchivedCycleLayoutRoot` by the
 * archived-cycles page route.
 *
 * MobX stores read:
 *   - useCycleFilter (cycle filter store): `currentProjectArchivedFilters`
 *     (TCycleFilters) for the active filter selection on the current project,
 *     `archivedCyclesSearchQuery` for the live search input value, plus the
 *     `updateFilters` and `updateArchivedCyclesSearchQuery` action setters.
 *
 * Side effects:
 *   - Store mutations (synchronous, MobX store-only):
 *       - `updateFilters(projectId, { [key]: newValues }, "archived")` on each
 *         filter toggle from `handleFilters` — toggles a value in/out of an array
 *         per filter key, partitioned under the "archived" filter slice.
 *       - `updateArchivedCyclesSearchQuery(string)` on every keystroke in the
 *         search input and when the close-button or Escape clears the query.
 *   - DOM/ref interactions:
 *       - `useRef` on the search input element; `inputRef.current?.focus()` when
 *         the search affordance is opened, `.blur()` on Escape when the query is
 *         already empty.
 *       - `useOutsideClickDetector` collapses the expanded search input when the
 *         user clicks outside it AND the query is empty (a non-empty query keeps
 *         the input expanded so the user does not lose their typed text).
 *   - Keyboard:
 *       - Escape clears the search query first (if non-empty) and only on a
 *         second Escape press collapses the input and blurs the focus.
 *   - No direct API calls — all data flow is store-mediated; the SWR fetch for
 *     archived cycles lives in `ArchivedCycleLayoutRoot`, not here.
 *
 * Consumers: rendered from the archived-cycles route page at
 * `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/archives/cycles/page.tsx`
 * as a sibling of `ArchivedCycleLayoutRoot`.
 */

import { useCallback, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// icons
import { ListFilter } from "lucide-react";
import { useOutsideClickDetector } from "@plane/hooks";
import { SearchIcon, CloseIcon } from "@plane/propel/icons";
// plane helpers
// types
import type { TCycleFilters } from "@plane/types";
import { cn, calculateTotalFilters } from "@plane/utils";
// components
import { ArchiveTabsList } from "@/components/archives";
import { FiltersDropdown } from "@/components/issues/issue-layouts/filters";
// hooks
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";
// local imports
import { CycleFiltersSelection } from "../dropdowns";

export const ArchivedCyclesHeader = observer(function ArchivedCyclesHeader() {
  // router
  const { projectId } = useParams();
  // refs
  const inputRef = useRef<HTMLInputElement>(null);
  // hooks
  const { currentProjectArchivedFilters, archivedCyclesSearchQuery, updateFilters, updateArchivedCyclesSearchQuery } =
    useCycleFilter();
  // states
  const [isSearchOpen, setIsSearchOpen] = useState(archivedCyclesSearchQuery !== "" ? true : false);
  // outside click detector hook
  useOutsideClickDetector(inputRef, () => {
    if (isSearchOpen && archivedCyclesSearchQuery.trim() === "") setIsSearchOpen(false);
  });

  const handleFilters = useCallback(
    (key: keyof TCycleFilters, value: string | string[]) => {
      if (!projectId) return;
      const newValues = currentProjectArchivedFilters?.[key] ?? [];

      if (Array.isArray(value))
        value.forEach((val) => {
          if (!newValues.includes(val)) newValues.push(val);
          else newValues.splice(newValues.indexOf(val), 1);
        });
      else {
        if (currentProjectArchivedFilters?.[key]?.includes(value)) newValues.splice(newValues.indexOf(value), 1);
        else newValues.push(value);
      }

      updateFilters(projectId.toString(), { [key]: newValues }, "archived");
    },
    [currentProjectArchivedFilters, projectId, updateFilters]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (archivedCyclesSearchQuery && archivedCyclesSearchQuery.trim() !== "") updateArchivedCyclesSearchQuery("");
      else {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  const isFiltersApplied = calculateTotalFilters(currentProjectArchivedFilters ?? {}) !== 0;

  return (
    <div className="group relative flex border-b border-subtle">
      <div className="horizontal-scrollbar flex scrollbar-sm w-full items-center gap-2 overflow-x-auto px-4">
        <ArchiveTabsList />
      </div>
      {/* filter options */}
      <div className="flex h-full items-center gap-3 self-end px-8">
        {!isSearchOpen && (
          <button
            type="button"
            className="-mr-5 grid place-items-center rounded-sm p-2 text-placeholder hover:bg-layer-1"
            onClick={() => {
              setIsSearchOpen(true);
              inputRef.current?.focus();
            }}
          >
            <SearchIcon className="h-3.5 w-3.5" />
          </button>
        )}
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
            value={archivedCyclesSearchQuery}
            onChange={(e) => updateArchivedCyclesSearchQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          {isSearchOpen && (
            <button
              type="button"
              className="grid place-items-center"
              onClick={() => {
                updateArchivedCyclesSearchQuery("");
                setIsSearchOpen(false);
              }}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <FiltersDropdown
          icon={<ListFilter className="h-3 w-3" />}
          title="Filters"
          placement="bottom-end"
          isFiltersApplied={isFiltersApplied}
        >
          <CycleFiltersSelection
            filters={currentProjectArchivedFilters ?? {}}
            handleFiltersUpdate={handleFilters}
            isArchived
          />
        </FiltersDropdown>
      </div>
    </div>
  );
});
