/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sub-group-by selector inside the Display Filters dropdown.
 *
 * Rendered purpose: renders a radio-style `FilterOption` row per sub-group-by key, gated to layouts
 * that support sub-grouping (kanban). Selecting a row sets `displayFilters.sub_group_by`.
 *
 * Props (`Props`):
 *   - `selectedSubGroupBy` (`TIssueGroupByOptions | null`, required): the currently-active
 *     sub-group-by key (or `null` for "no sub-grouping")
 *   - `selectedGroupBy` (`TIssueGroupByOptions`, required): the active group-by key — used to hide
 *     the same key from the sub-group-by list (sub-grouping by the same field is meaningless)
 *   - `handleUpdate` (`(val: TIssueGroupByOptions | null) => void`, required): selection callback.
 *     Parent persists via `EIssueFilterType.DISPLAY_FILTERS`.
 *   - `cycleViewDisabled` (`boolean`, optional): hide the "cycle" sub-group-by row.
 *   - `moduleViewDisabled` (`boolean`, optional): hide the "module" sub-group-by row.
 *
 * MobX stores read: none.
 *
 * Side effects: none. Row click invokes `handleUpdate(val)`.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { ISSUE_GROUP_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssueGroupByOptions } from "@plane/types";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// constants

type Props = {
  displayFilters: IIssueDisplayFilterOptions;
  handleUpdate: (val: TIssueGroupByOptions) => void;
  subGroupByOptions: TIssueGroupByOptions[];
  ignoreGroupedFilters: Partial<TIssueGroupByOptions>[];
};

export const FilterSubGroupBy = observer(function FilterSubGroupBy(props: Props) {
  // hooks
  const { t } = useTranslation();

  const { displayFilters, handleUpdate, subGroupByOptions, ignoreGroupedFilters } = props;

  const [previewEnabled, setPreviewEnabled] = useState(true);

  const selectedGroupBy = displayFilters.group_by ?? null;
  const selectedSubGroupBy = displayFilters.sub_group_by ?? null;

  return (
    <>
      <FilterHeader
        title="Sub-group by"
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {ISSUE_GROUP_BY_OPTIONS.filter((option) => subGroupByOptions.includes(option.key)).map((subGroupBy) => {
            if (selectedGroupBy !== null && subGroupBy.key === selectedGroupBy) return null;
            if (ignoreGroupedFilters.includes(subGroupBy?.key)) return null;

            return (
              <FilterOption
                key={subGroupBy?.key}
                isChecked={selectedSubGroupBy === subGroupBy?.key ? true : false}
                onClick={() => handleUpdate(subGroupBy.key)}
                title={t(subGroupBy.titleTranslationKey)}
                multiple={false}
              />
            );
          })}
        </div>
      )}
    </>
  );
});
