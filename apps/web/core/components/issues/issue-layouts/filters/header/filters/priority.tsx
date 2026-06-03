/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Priority filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, selectable list of the five issue priority levels
 * (urgent / high / medium / low / none) as `FilterOption` rows with a `PriorityIcon`; clicking a
 * row toggles that priority's key in / out of the active priority filter set. The header shows
 * the active count as `Priority (N)` and the section can be collapsed via `FilterHeader`'s
 * preview toggle.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected priority keys for the
 *     `priority` filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked priority key;
 *     the parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { priority: <next-array> })`.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     priority's `key` before rendering.
 *
 * MobX stores read: none. This is a pure-catalog filter — the priority options are enumerated
 * directly from the `ISSUE_PRIORITIES` constant in `@plane/constants` and the empty-state message
 * is localized via `useTranslation()` from `@plane/i18n`. No issue / project / member store is
 * consulted.
 *
 * Side effects: none directly. Row click invokes `handleUpdate`. The five-item catalog is small
 * enough that the file does NOT paginate via `itemsToRender` (unlike most other entity filters in
 * this folder). No API calls, no router navigation, no direct store writes.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// plane constants
import { ISSUE_PRIORITIES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// ui
import { PriorityIcon } from "@plane/propel/icons";

// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterPriority = observer(function FilterPriority(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;
  // hooks
  const { t } = useTranslation();
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const filteredOptions = ISSUE_PRIORITIES.filter((p) => p.key.includes(searchQuery.toLowerCase()));
  return (
    <>
      <FilterHeader
        title={`Priority ${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((priority) => (
              <FilterOption
                key={priority.key}
                isChecked={appliedFilters?.includes(priority.key) ? true : false}
                onClick={() => handleUpdate(priority.key)}
                icon={<PriorityIcon priority={priority.key} className="h-3.5 w-3.5" />}
                title={priority.title}
              />
            ))
          ) : (
            <p className="text-11 text-placeholder italic">{t("common.search.no_matches_found")}</p>
          )}
        </div>
      )}
    </>
  );
});
