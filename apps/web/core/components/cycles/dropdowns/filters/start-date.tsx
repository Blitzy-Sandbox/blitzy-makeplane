/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle start-date filter section.
 *
 * Preset start-date filter checkbox group sourced from
 * `DATE_AFTER_FILTER_OPTIONS`, with an additional Custom row that opens
 * `DateFilterModal` for picking an explicit date. Wrapped in MobX `observer`
 * so any observable referenced through the parent's filter snapshot triggers
 * a re-render. Rendered inside a `FilterHeader` titled "Start date" with a
 * count suffix when one or more values are applied.
 *
 * Props:
 *   - `appliedFilters: string[] | null` (required) — currently selected
 *     start-date filter tokens; `null` is treated as "nothing selected".
 *   - `handleUpdate: (val: string | string[]) => void` (required) — toggle
 *     callback. Receives a single preset token (on preset-row click) or an
 *     array (on Custom-row toggle / date-modal selection). The parent owns
 *     the cycle-filter store mutation — this component never writes to a
 *     MobX store directly.
 *   - `searchQuery: string` (required) — case-insensitive substring filter
 *     applied to each preset option's `name` field.
 *
 * MobX stores read:
 *   - None directly. Preset options come from `DATE_AFTER_FILTER_OPTIONS`
 *     (`@plane/constants`) and the date predicate `isInDateFormat` from
 *     `@plane/utils`.
 *
 * Local state:
 *   - `previewEnabled: boolean` — collapses or expands the option list under
 *     the `FilterHeader` chevron.
 *   - `isDateFilterModalOpen: boolean` — controls visibility of
 *     `DateFilterModal` for explicit-date selection.
 *
 * Side effects:
 *   - Invokes `handleUpdate(value)` on preset-row click and Custom-row toggle.
 *   - Opens `DateFilterModal` when the user toggles Custom on with no
 *     explicit-date entry currently present in `appliedFilters`.
 *   - No direct store writes, no API calls, no navigations.
 *
 * Custom row semantics:
 *   - The Custom row's checked state is derived by scanning `appliedFilters`,
 *     splitting each entry on `;`, and running `isInDateFormat` on the prefix.
 *     Preset filters use named tokens, so any entry whose `;`-prefix matches
 *     a `YYYY-MM-DD` date is by construction a user-picked custom selection.
 *   - Clicking Custom while it is unchecked opens `DateFilterModal` for
 *     picking an explicit date. Clicking Custom while it is checked calls
 *     `handleUpdate` with the subset of `appliedFilters` whose entries
 *     contain a `-` character, short-circuiting the modal.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// constants
import { DATE_AFTER_FILTER_OPTIONS } from "@plane/constants";
// components
import { isInDateFormat } from "@plane/utils";
import { DateFilterModal } from "@/components/core/filters/date-filter-modal";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";

// helpers

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
    const isValidDateSelected = appliedFilters?.filter((f) => isInDateFormat(f.split(";")[0])) || [];
    return isValidDateSelected.length > 0 ? true : false;
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
