/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * State-group filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, selectable list of the five canonical state groups
 * (backlog / unstarted / started / completed / cancelled) as `FilterOption` rows with a
 * `StateGroupIcon`; clicking a row toggles that group's key in / out of the active state-group
 * filter set. The header shows the active count as `State group (N)` and the section can be
 * collapsed via `FilterHeader`'s preview toggle.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected state-group keys for the
 *     `state_group` filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked state-group
 *     key; the parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { state_group: <next-array> })`.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     state group's `key` before rendering.
 *
 * MobX stores read: none. This is a pure-catalog filter — the state-group options are enumerated
 * directly from the `STATE_GROUPS` constant in `@plane/constants`. Distinct from `state.tsx`,
 * which filters by specific per-project state ids and receives its roster as a prop.
 *
 * Side effects: none directly. Row click invokes `handleUpdate`. The `itemsToRender` /
 * `handleViewToggle` paginate-and-grow scaffolding is present for structural symmetry with the
 * other filters but is functionally inert here because the `STATE_GROUPS` catalog contains only
 * five entries (the default page size). No API calls, no router navigation, no direct store
 * writes.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import { StateGroupIcon } from "@plane/propel/icons";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterStateGroup = observer(function FilterStateGroup(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;

  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const filteredOptions = Object.values(STATE_GROUPS).filter((s) => s.key.includes(searchQuery.toLowerCase()));

  const handleViewToggle = () => {
    if (!filteredOptions) return;

    if (itemsToRender === filteredOptions.length) setItemsToRender(5);
    else setItemsToRender(filteredOptions.length);
  };

  return (
    <>
      <FilterHeader
        title={`State group${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.slice(0, itemsToRender).map((stateGroup) => (
                <FilterOption
                  key={stateGroup.key}
                  isChecked={appliedFilters?.includes(stateGroup.key) ? true : false}
                  onClick={() => handleUpdate(stateGroup.key)}
                  icon={<StateGroupIcon stateGroup={stateGroup.key} />}
                  title={stateGroup.label}
                />
              ))}
              {filteredOptions.length > 5 && (
                <button
                  type="button"
                  className="ml-8 text-11 font-medium text-accent-primary"
                  onClick={handleViewToggle}
                >
                  {itemsToRender === filteredOptions.length ? "View less" : "View all"}
                </button>
              )}
            </>
          ) : (
            <p className="text-11 text-placeholder italic">No matches found</p>
          )}
        </div>
      )}
    </>
  );
});
