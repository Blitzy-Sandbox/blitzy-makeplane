/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle status filter checkbox section.
 *
 * Multi-select checkbox group over the `CYCLE_STATUS` options
 * (`draft`, `current`, `upcoming`, `completed`) for the cycles filter
 * dropdown. Wrapped in MobX `observer` so any observable referenced through
 * the parent's filter snapshot triggers a re-render. Rendered inside a
 * `FilterHeader` titled "Status of the cycle" with a count suffix when one
 * or more values are applied.
 *
 * Props:
 *   - `appliedFilters: TCycleGroups[] | null` (required) — currently selected
 *     status values; `null` is treated as "nothing selected".
 *   - `handleUpdate: (val: string) => void` (required) — toggle callback fired
 *     with the option's `value` when the user clicks a row. The parent owns
 *     the cycle-filter store mutation — this component never writes to a
 *     MobX store directly.
 *   - `searchQuery: string` (required) — substring used to filter the option
 *     list. The match is case-insensitive against each option's raw `value`
 *     field (e.g. `"draft"`), not against the translated display label.
 *
 * MobX stores read:
 *   - None directly. `useTranslation` from `@plane/i18n` localizes the row
 *     label via `t(status.i18n_title)`; the option set is sourced from
 *     `CYCLE_STATUS` in `@plane/constants`.
 *
 * Local state:
 *   - `previewEnabled: boolean` — collapses or expands the option list under
 *     the `FilterHeader` chevron.
 *
 * Side effects:
 *   - Invokes `handleUpdate(value)` on row click.
 *   - No direct store writes, no API calls.
 *
 * Rendering branches:
 *   - Matched options render as `FilterOption` rows with `isChecked` derived
 *     from `appliedFilters?.includes(status.value)`.
 *   - When the search query eliminates every option, an italic
 *     "No matches found" message is rendered in place of the option list.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { CYCLE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TCycleGroups } from "@plane/types";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// types
// constants

type Props = {
  appliedFilters: TCycleGroups[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterStatus = observer(function FilterStatus(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;
  // states
  const [previewEnabled, setPreviewEnabled] = useState(true);
  //hooks
  const { t } = useTranslation();
  const appliedFiltersCount = appliedFilters?.length ?? 0;
  const filteredOptions = CYCLE_STATUS.filter((p) => p.value.includes(searchQuery.toLowerCase()));

  return (
    <>
      <FilterHeader
        title={`Status of the cycle${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((status) => (
              <FilterOption
                key={status.value}
                isChecked={appliedFilters?.includes(status.value) ? true : false}
                onClick={() => handleUpdate(status.value)}
                title={t(status.i18n_title)}
              />
            ))
          ) : (
            <p className="text-11 text-placeholder italic">No matches found</p>
          )}
        </div>
      )}
    </>
  );
});
