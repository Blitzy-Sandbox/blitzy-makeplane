/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Group-by selector inside the Display Filters dropdown.
 *
 * Rendered purpose: renders a radio-style `FilterOption` row per group-by key in the
 * `GROUP_BY_OPTIONS` catalog from `@plane/constants`; selecting a row sets `displayFilters.group_by`.
 *
 * Props (`Props`):
 *   - `selectedGroupBy` (`TIssueGroupByOptions`, required): the currently-active group-by key
 *   - `handleUpdate` (`(val: TIssueGroupByOptions) => void`, required): selection callback. Parent
 *     persists via `EIssueFilterType.DISPLAY_FILTERS`.
 *   - `ignoreGroupedFilters` (`TIssueGroupByOptions[]`, optional): keys to hide (e.g. when the page
 *     already filters by that key).
 *   - `cycleViewDisabled` (`boolean`, optional): hide the "cycle" group-by row.
 *   - `moduleViewDisabled` (`boolean`, optional): hide the "module" group-by row.
 *
 * MobX stores read: none.
 *
 * Side effects: none. Row click invokes `handleUpdate(val)`.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssueGroupByOptions } from "@plane/types";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
import { useGroupByOptions } from "@/plane-web/components/issues/issue-layouts/utils";

type Props = {
  displayFilters: IIssueDisplayFilterOptions | undefined;
  groupByOptions: TIssueGroupByOptions[];
  handleUpdate: (val: TIssueGroupByOptions) => void;
  ignoreGroupedFilters: Partial<TIssueGroupByOptions>[];
};

export const FilterGroupBy = observer(function FilterGroupBy(props: Props) {
  const { displayFilters, groupByOptions, handleUpdate, ignoreGroupedFilters } = props;
  // hooks
  const { t } = useTranslation();
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const selectedGroupBy = displayFilters?.group_by ?? null;
  const selectedSubGroupBy = displayFilters?.sub_group_by ?? null;

  const options = useGroupByOptions(groupByOptions);

  return (
    <>
      <FilterHeader
        title={t("common.group_by")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {options.map((groupBy) => {
            if (
              displayFilters?.layout === "kanban" &&
              selectedSubGroupBy !== null &&
              groupBy.key === selectedSubGroupBy
            )
              return null;
            if (ignoreGroupedFilters.includes(groupBy?.key)) return null;

            return (
              <FilterOption
                key={groupBy?.key}
                isChecked={selectedGroupBy === groupBy?.key ? true : false}
                onClick={() => handleUpdate(groupBy.key)}
                title={t(groupBy.titleTranslationKey)}
                multiple={false}
              />
            );
          })}
        </div>
      )}
    </>
  );
});
