/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * State filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, paginated, selectable list of project states as
 * `FilterOption` rows; each row displays a `StateGroupIcon` colored by the state's `group` and
 * `color` and clicking a row toggles that state's id in / out of the active state filter set. The
 * header shows the active count as `State (N)` and the section can be collapsed via
 * `FilterHeader`'s preview toggle.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected state ids for the `state`
 *     filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked state id; the
 *     parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { state: <next-array> })`.
 *   - `states` (`IState[] | undefined`, required): candidate roster of state entities to render;
 *     supplied as a prop by the parent (typically resolved from the state MobX store selector at
 *     the parent level). `undefined` triggers a `Loader` skeleton fallback in the JSX.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     state's `name` before sorting.
 *
 * MobX stores read: none directly. This component is store-agnostic — the parent route root
 * resolves the `states` roster (typically from `useProjectState().getStateById` or similar
 * selectors) and passes it in as a prop, which keeps the component reusable across project,
 * cycle, and module contexts.
 *
 * Side effects: none directly. Row click invokes `handleUpdate`; pagination ("View all" / "View
 * less") only mutates the local `itemsToRender` state. No API calls, no router navigation, no
 * direct store writes.
 */

import React, { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import { EIconSize } from "@plane/constants";
import { StateGroupIcon } from "@plane/propel/icons";
import type { IState } from "@plane/types";
// components
import { Loader } from "@plane/ui";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// ui
// types

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
  states: IState[] | undefined;
};

export const FilterState = observer(function FilterState(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery, states } = props;

  /**
   * Paginated render: only the first `itemsToRender` rows are mounted at a time so that large
   * rosters (e.g. workspaces with hundreds of members or labels) do not stall the dropdown's first
   * paint. The user clicks "Load More" to grow the slice.
   */
  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const sortedOptions = useMemo(() => {
    const filteredOptions = (states ?? []).filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return sortBy(filteredOptions, [(s) => !(appliedFilters ?? []).includes(s.id)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const handleViewToggle = () => {
    if (!sortedOptions) return;

    if (itemsToRender === sortedOptions.length) setItemsToRender(5);
    else setItemsToRender(sortedOptions.length);
  };

  return (
    <>
      <FilterHeader
        title={`State${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {sortedOptions ? (
            sortedOptions.length > 0 ? (
              <>
                {sortedOptions.slice(0, itemsToRender).map((state) => (
                  <FilterOption
                    key={state.id}
                    isChecked={appliedFilters?.includes(state.id) ? true : false}
                    onClick={() => handleUpdate(state.id)}
                    icon={
                      <StateGroupIcon
                        stateGroup={state.group}
                        color={state.color}
                        size={EIconSize.MD}
                        percentage={state?.order}
                      />
                    }
                    title={state.name}
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
