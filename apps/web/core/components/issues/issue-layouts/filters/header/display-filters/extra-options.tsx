/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extra-options section inside the Display Filters dropdown.
 *
 * Rendered purpose: renders the boolean toggles ("show empty groups", "show sub-issues", etc.) for
 * the active layout, gated against `layoutDisplayFiltersOptions.extra_options` so layouts only
 * surface the toggles they support.
 *
 * Props (`Props`):
 *   - `displayFilters` (`IIssueDisplayFilterOptions`, required): current display-filter state
 *     (reads the `show_empty_groups`, `sub_issue`, etc. flags)
 *   - `handleUpdate` (`(partial: Partial<IIssueDisplayFilterOptions>) => void`, required): toggle
 *     callback. Parent persists via `EIssueFilterType.DISPLAY_FILTERS`.
 *   - `enabledExtraOptions` (`(keyof IIssueDisplayFilterOptions)[]`, required): subset of toggles to
 *     surface — sourced from `layoutDisplayFiltersOptions.extra_options`.
 *
 * MobX stores read: none.
 *
 * Side effects: none. Toggle click invokes `handleUpdate({ <flag>: !prev })`.
 */

import React from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssueExtraOptions } from "@plane/types";
// components
import { FilterOption } from "@/components/issues/issue-layouts/filters";

// constants
const ISSUE_EXTRA_OPTIONS: {
  key: TIssueExtraOptions;
  titleTranslationKey: string;
}[] = [
  {
    key: "sub_issue",
    titleTranslationKey: "issue.display.extra.show_sub_issues",
  }, // in spreadsheet its always false
  {
    key: "show_empty_groups",
    titleTranslationKey: "issue.display.extra.show_empty_groups",
  }, // filter on front-end
];

type Props = {
  selectedExtraOptions: {
    sub_issue: boolean;
    show_empty_groups: boolean;
  };
  handleUpdate: (key: keyof IIssueDisplayFilterOptions, val: boolean) => void;
  enabledExtraOptions: TIssueExtraOptions[];
};

export const FilterExtraOptions = observer(function FilterExtraOptions(props: Props) {
  const { selectedExtraOptions, handleUpdate, enabledExtraOptions } = props;
  // hooks
  const { t } = useTranslation();
  const isExtraOptionEnabled = (option: TIssueExtraOptions) => enabledExtraOptions.includes(option);

  return (
    <div>
      {ISSUE_EXTRA_OPTIONS.map((option) => {
        if (!isExtraOptionEnabled(option.key)) return null;

        return (
          <FilterOption
            key={option.key}
            isChecked={selectedExtraOptions?.[option.key] ? true : false}
            onClick={() => handleUpdate(option.key, !selectedExtraOptions?.[option.key])}
            title={t(option.titleTranslationKey)}
          />
        );
      })}
    </div>
  );
});
