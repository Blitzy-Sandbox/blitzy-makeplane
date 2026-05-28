/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Start-date filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, selectable list of relative date-after presets (e.g.
 * "1 week from now", "2 weeks from now", "1 month from now") plus a "Custom" row that opens a
 * `DateFilterModal` for entering an explicit date range. Clicking a preset row toggles that
 * preset's value in / out of the active start-date filter set; submitting a custom range yields a
 * `string[]` that the parent persists.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected start-date filter values
 *     for the `start_date` filter slot — either preset keys (from `DATE_AFTER_FILTER_OPTIONS`) or
 *     hyphen-separated custom date-range strings.
 *   - `handleUpdate` (`(val: string | string[]) => void`, required): invoked with either a preset
 *     value (string) on row click, OR an array of custom-range strings on modal submit / clear.
 *     The broader `string | string[]` signature (vs. plain `string` on entity filters) reflects
 *     the modal's bulk-replace semantics for the custom range. The parent route root persists
 *     via `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { start_date: <next-value> })`.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     preset option's `name` before rendering.
 *
 * MobX stores read: none. This is a pure-catalog filter — the preset options are enumerated
 * directly from the `DATE_AFTER_FILTER_OPTIONS` constant in `@plane/constants`. No issue /
 * project / member store is consulted.
 *
 * Side effects: opens the `DateFilterModal` overlay when the user clicks the "Custom" row and no
 * custom range is currently applied (`setIsDateFilterModalOpen(true)`). Submitting the modal
 * invokes `handleUpdate` with the resulting `string[]`. Clearing an active custom range invokes
 * `handleUpdate` synchronously with the filtered residue. No API calls, no router navigation, no
 * direct store writes from this component.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// constants
import { DATE_AFTER_FILTER_OPTIONS } from "@plane/constants";
// components
import { DateFilterModal } from "@/components/core/filters/date-filter-modal";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string | string[]) => void;
  searchQuery: string;
};

export const FilterStartDate = observer(function FilterStartDate(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [isDateFilterModalOpen, setIsDateFilterModalOpen] = useState(false);

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const filteredOptions = DATE_AFTER_FILTER_OPTIONS.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isCustomDateSelected = () => {
    const isCustomFateApplied = appliedFilters?.filter((f) => f.includes("-")) || [];
    return isCustomFateApplied.length > 0 ? true : false;
  };
  const handleCustomDate = () => {
    if (isCustomDateSelected()) {
      const updateAppliedFilters = appliedFilters?.filter((f) => f.includes("-")) || [];
      handleUpdate(updateAppliedFilters);
    } else setIsDateFilterModalOpen(true);
  };

  return (
    <>
      {isDateFilterModalOpen && (
        <DateFilterModal
          handleClose={() => setIsDateFilterModalOpen(false)}
          isOpen={isDateFilterModalOpen}
          onSelect={(val) => handleUpdate(val)}
          title="Start date"
        />
      )}
      <FilterHeader
        title={`Start date${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {filteredOptions.length > 0 ? (
            <>
              {filteredOptions.map((option) => (
                <FilterOption
                  key={option.value}
                  isChecked={appliedFilters?.includes(option.value) ? true : false}
                  onClick={() => handleUpdate(option.value)}
                  title={option.name}
                  multiple
                />
              ))}
              <FilterOption isChecked={isCustomDateSelected()} onClick={handleCustomDate} title="Custom" multiple />
            </>
          ) : (
            <p className="text-11 text-placeholder italic">No matches found</p>
          )}
        </div>
      )}
    </>
  );
});
