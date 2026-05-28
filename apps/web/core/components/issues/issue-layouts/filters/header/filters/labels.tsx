/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Labels filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, paginated, selectable list of issue labels as
 * `FilterOption` rows with a colored dot icon per label; clicking a row toggles that label's id in
 * / out of the active labels filter set. The header shows the active count as `Label (N)` and the
 * section can be collapsed via `FilterHeader`'s preview toggle.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected label ids for the
 *     `labels` filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked label id; the
 *     parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { labels: <next-array> })`.
 *   - `labels` (`IIssueLabel[] | undefined`, required): candidate roster of label entities to
 *     render; supplied as a prop by the parent (typically resolved from the label MobX store
 *     selector at the parent level). `undefined` triggers a `Loader` skeleton fallback in the JSX.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     label's `name` before sorting.
 *
 * MobX stores read: none directly. This component is store-agnostic — the parent route root
 * resolves the `labels` roster from `useLabel().labelMap` (or analogous selectors) and passes it
 * in as a prop, which keeps the component reusable across workspace, project, and module contexts.
 *
 * Side effects: none directly. Row click invokes `handleUpdate`; pagination ("View all" / "View
 * less") only mutates the local `itemsToRender` state. No API calls, no router navigation, no
 * direct store writes.
 */

import React, { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import type { IIssueLabel } from "@plane/types";
// components
import { Loader } from "@plane/ui";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";

// ui
// types

function LabelIcons({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />;
}

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  labels: IIssueLabel[] | undefined;
  searchQuery: string;
};

export const FilterLabels = observer(function FilterLabels(props: Props) {
  const { appliedFilters, handleUpdate, labels, searchQuery } = props;

  /**
   * Paginated render: only the first `itemsToRender` rows are mounted at a time so that large
   * rosters (e.g. workspaces with hundreds of members or labels) do not stall the dropdown's first
   * paint. The user clicks "Load More" to grow the slice.
   */
  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  /**
   * Sort order: applied filters first, then the current user, then alphabetical — keeps active
   * filters and "me" pinned to the top so users can re-toggle them quickly without scrolling.
   */
  const sortedOptions = useMemo(() => {
    const filteredOptions = (labels || []).filter((label) =>
      label.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return sortBy(filteredOptions, [
      (label) => !(appliedFilters ?? []).includes(label.id),
      (label) => label.name.toLowerCase(),
    ]);
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
        title={`Label${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {sortedOptions ? (
            sortedOptions.length > 0 ? (
              <>
                {sortedOptions.slice(0, itemsToRender).map((label) => (
                  <FilterOption
                    key={label?.id}
                    isChecked={appliedFilters?.includes(label?.id) ? true : false}
                    onClick={() => handleUpdate(label?.id)}
                    icon={<LabelIcons color={label.color} />}
                    title={label.name}
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
