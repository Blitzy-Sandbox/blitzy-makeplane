/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Order-by selector inside the Display Filters dropdown.
 *
 * Rendered purpose: renders a radio-style `FilterOption` row per order-by key in the
 * `ORDER_BY_OPTIONS` catalog from `@plane/constants`; selecting a row sets `displayFilters.order_by`.
 *
 * Props (`Props`):
 *   - `selectedOrderBy` (`TIssueOrderByOptions`, required): the currently-active order-by key
 *   - `handleUpdate` (`(val: TIssueOrderByOptions) => void`, required): selection callback. Parent
 *     persists via `EIssueFilterType.DISPLAY_FILTERS`.
 *   - `orderByFlags` (e.g. `OrderByOptionFlag`, optional): per-option enable/disable map sourced from
 *     `layoutDisplayFiltersOptions.order_by`.
 *
 * MobX stores read: none.
 *
 * Side effects: none. Row click invokes `handleUpdate(val)`.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { ISSUE_ORDER_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssueOrderByOptions } from "@plane/types";

// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";

type Props = {
  selectedOrderBy: TIssueOrderByOptions | undefined;
  handleUpdate: (val: TIssueOrderByOptions) => void;
  orderByOptions: TIssueOrderByOptions[];
};

export const FilterOrderBy = observer(function FilterOrderBy(props: Props) {
  const { selectedOrderBy, handleUpdate, orderByOptions } = props;
  // hooks
  const { t } = useTranslation();

  const [previewEnabled, setPreviewEnabled] = useState(true);

  const activeOrderBy = selectedOrderBy ?? "-created_at";

  return (
    <>
      <FilterHeader
        title={t("common.order_by.label")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {ISSUE_ORDER_BY_OPTIONS.filter((option) => orderByOptions.includes(option.key)).map((orderBy) => (
            <FilterOption
              key={orderBy?.key}
              isChecked={activeOrderBy === orderBy?.key ? true : false}
              onClick={() => handleUpdate(orderBy.key)}
              title={t(orderBy.titleTranslationKey)}
              multiple={false}
            />
          ))}
        </div>
      )}
    </>
  );
});
