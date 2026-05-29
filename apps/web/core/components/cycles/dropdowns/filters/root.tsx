/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle filters selection orchestrator.
 *
 * Top-level container for the cycles filter dropdown that composes the three
 * sub-sections (status, start date, end date) with a controlled search input
 * whose query is forwarded to each section for substring matching. Wrapped
 * in MobX `observer` so any observable read transitively reached through the
 * child sub-sections re-renders the dropdown.
 *
 * Props:
 *   - `filters: TCycleFilters` (required) — current filter snapshot owned by
 *     the caller (typically wired to a cycle-filter MobX store).
 *   - `handleFiltersUpdate: (key: keyof TCycleFilters, value: string | string[]) => void`
 *     (required) — callback that propagates a sub-section's selection back to
 *     the parent. The parent owns the actual store mutation — this component
 *     is fully prop-driven and never writes to a MobX store directly.
 *   - `isArchived?: boolean` (optional, default `false`) — when `true` the
 *     status sub-section is suppressed because archived cycles have no live
 *     status to filter against.
 *
 * MobX stores read:
 *   - None directly. The component is prop-driven; the parent (e.g. the
 *     cycles list / archived-cycles header) is responsible for reading and
 *     mutating the cycle filter store.
 *
 * Hooks consumed:
 *   - `usePlatformOS` — gates `autoFocus` on the search input so focus is
 *     auto-engaged on desktop only (skipped on mobile to avoid the soft
 *     keyboard popping up when the dropdown opens).
 *
 * Local state:
 *   - `filtersSearchQuery: string` — controlled search input value;
 *     forwarded to each sub-section's `searchQuery` prop and cleared by the
 *     in-input close button.
 *
 * Side effects:
 *   - Invokes `handleFiltersUpdate(key, value)` when a sub-section reports
 *     a selection change.
 *   - No direct store writes, no API calls, no navigations.
 *
 * Consumers: `cycles-view-header.tsx` (cycles list page header) and the
 * archived-cycles header, via the `dropdowns/filters` barrel.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { SearchIcon, CloseIcon } from "@plane/propel/icons";
// plane imports
import type { TCycleFilters, TCycleGroups } from "@plane/types";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { FilterEndDate } from "./end-date";
import { FilterStartDate } from "./start-date";
import { FilterStatus } from "./status";

type Props = {
  filters: TCycleFilters;
  handleFiltersUpdate: (key: keyof TCycleFilters, value: string | string[]) => void;
  isArchived?: boolean;
};

export const CycleFiltersSelection = observer(function CycleFiltersSelection(props: Props) {
  const { filters, handleFiltersUpdate, isArchived = false } = props;
  // states
  const [filtersSearchQuery, setFiltersSearchQuery] = useState("");
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="bg-surface-1 p-2.5 pb-0">
        <div className="flex items-center gap-1.5 rounded-sm border-[0.5px] border-subtle bg-surface-2 px-1.5 py-1 text-11">
          <SearchIcon className="text-placeholder" width={12} height={12} strokeWidth={2} />
          <input
            type="text"
            className="w-full bg-surface-2 outline-none placeholder:text-placeholder"
            placeholder="Search"
            value={filtersSearchQuery}
            onChange={(e) => setFiltersSearchQuery(e.target.value)}
            autoFocus={!isMobile}
          />
          {filtersSearchQuery !== "" && (
            <button type="button" className="grid place-items-center" onClick={() => setFiltersSearchQuery("")}>
              <CloseIcon className="text-tertiary" height={12} width={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <div className="vertical-scrollbar scrollbar-sm h-full w-full divide-y divide-subtle-1 overflow-y-auto px-2.5">
        {/* cycle status */}
        {!isArchived && (
          <div className="py-2">
            <FilterStatus
              appliedFilters={(filters.status as TCycleGroups[]) ?? null}
              handleUpdate={(val) => handleFiltersUpdate("status", val)}
              searchQuery={filtersSearchQuery}
            />
          </div>
        )}

        {/* start date */}
        <div className="py-2">
          <FilterStartDate
            appliedFilters={filters.start_date ?? null}
            handleUpdate={(val) => handleFiltersUpdate("start_date", val)}
            searchQuery={filtersSearchQuery}
          />
        </div>

        {/* end date */}
        <div className="py-2">
          <FilterEndDate
            appliedFilters={filters.end_date ?? null}
            handleUpdate={(val) => handleFiltersUpdate("end_date", val)}
            searchQuery={filtersSearchQuery}
          />
        </div>
      </div>
    </div>
  );
});
