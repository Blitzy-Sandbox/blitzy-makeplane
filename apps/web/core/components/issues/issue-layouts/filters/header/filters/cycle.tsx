/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, paginated, selectable list of the current project's
 * cycles as `FilterOption` rows; each row displays a `CycleGroupIcon` colored by cycle status
 * (current / upcoming / completed / draft) and clicking a row toggles that cycle's id in / out of
 * the active cycle filter set. The "current" cycle's row pulses via `FilterOption.activePulse`.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected cycle ids for the `cycle`
 *     filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked cycle id; the
 *     parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { cycle: <next-array> })`.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     cycle's `name` before sorting.
 *
 * Route context: reads `projectId` from `useParams()` (route param) and resolves the candidate
 * roster internally via `useCycle().getProjectCycleIds(projectId)` — there is no `cycleIds` prop.
 *
 * MobX stores read:
 *   - `useCycle()` -> `getProjectCycleIds(projectId)` for the candidate roster, and `getCycleById`
 *     to resolve each cycle entity for rendering (name + status).
 *
 * Side effects: none directly. Row click invokes `handleUpdate`; pagination ("View all" / "View
 * less") only mutates the local `itemsToRender` state. No API calls, no router navigation, no
 * direct store writes.
 */

import React, { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { CycleGroupIcon } from "@plane/propel/icons";
import type { TCycleGroups } from "@plane/types";
// components
import { Loader } from "@plane/ui";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
import { useCycle } from "@/hooks/store/use-cycle";
// ui
// types

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterCycle = observer(function FilterCycle(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;

  // hooks
  const { projectId } = useParams();
  const { getCycleById, getProjectCycleIds } = useCycle();

  /**
   * Paginated render: only the first `itemsToRender` rows are mounted at a time so that large
   * rosters (e.g. workspaces with hundreds of members or labels) do not stall the dropdown's first
   * paint. The user clicks "Load More" to grow the slice.
   */
  // states
  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const cycleIds = projectId ? getProjectCycleIds(projectId.toString()) : undefined;
  const cycles = cycleIds?.map((projectId) => getCycleById(projectId)!) ?? null;
  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const sortedOptions = useMemo(() => {
    const filteredOptions = (cycles || []).filter((cycle) =>
      cycle.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return sortBy(filteredOptions, [
      (cycle) => !appliedFilters?.includes(cycle.id),
      (cycle) => cycle.name.toLowerCase(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const handleViewToggle = () => {
    if (!sortedOptions) return;

    if (itemsToRender === sortedOptions.length) setItemsToRender(5);
    else setItemsToRender(sortedOptions.length);
  };

  const cycleStatus = (status: TCycleGroups | undefined) =>
    (status ? status.toLocaleLowerCase() : "draft") as TCycleGroups;

  return (
    <>
      <FilterHeader
        title={`Cycle ${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {sortedOptions ? (
            sortedOptions.length > 0 ? (
              <>
                {sortedOptions.slice(0, itemsToRender).map((cycle) => (
                  <FilterOption
                    key={cycle.id}
                    isChecked={appliedFilters?.includes(cycle.id) ? true : false}
                    onClick={() => handleUpdate(cycle.id)}
                    icon={
                      <CycleGroupIcon cycleGroup={cycleStatus(cycle?.status)} className="h-3.5 w-3.5 flex-shrink-0" />
                    }
                    title={cycle.name}
                    activePulse={cycleStatus(cycle?.status) === "current" ? true : false}
                  />
                ))}
                {sortedOptions.length > 5 && (
                  <button
                    type="button"
                    className="ml-8 text-11 font-medium text-accent-primary"
                    onClick={handleViewToggle}
                  >
                    {itemsToRender === sortedOptions.length ? "View less" : "View all"}
                  </button>
                )}
              </>
            ) : (
              <p className="text-11 text-placeholder italic">No matches found</p>
            )
          ) : (
            <Loader className="space-y-2">
              <Loader.Item height="20px" />
              <Loader.Item height="20px" />
              <Loader.Item height="20px" />
            </Loader>
          )}
        </div>
      )}
    </>
  );
});
