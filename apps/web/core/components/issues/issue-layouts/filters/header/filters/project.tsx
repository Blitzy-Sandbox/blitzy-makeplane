/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, paginated, selectable list of the user's joined projects
 * as `FilterOption` rows; each row shows the project's `Logo` (emoji/icon/image) and clicking a
 * row toggles that project's id in / out of the active project filter set. The header shows the
 * active count as `Project (N)` and the section can be collapsed via `FilterHeader`'s preview
 * toggle. Used on workspace-level views (e.g. workspace draft, profile views) where issues can
 * span multiple projects.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected project ids for the
 *     `project` filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked project id;
 *     the parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { project: <next-array> })`.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     project's `name` before sorting.
 *
 * MobX stores read:
 *   - `useProject()` -> `joinedProjectIds` for the candidate roster (the workspaces' joined
 *     projects for the current user), and `getProjectById` to resolve each project entity for
 *     rendering (name + `logo_props`).
 *
 * Side effects: none directly. Row click invokes `handleUpdate`; pagination ("View all" / "View
 * less") only mutates the local `itemsToRender` state. No API calls, no router navigation, no
 * direct store writes.
 */

import React, { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
// ui
import { Logo } from "@plane/propel/emoji-icon-picker";
import { Loader } from "@plane/ui";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// hooks
import { useProject } from "@/hooks/store/use-project";

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  searchQuery: string;
};

export const FilterProjects = observer(function FilterProjects(props: Props) {
  const { appliedFilters, handleUpdate, searchQuery } = props;
  /**
   * Paginated render: only the first `itemsToRender` rows are mounted at a time so that large
   * rosters (e.g. workspaces with hundreds of members or labels) do not stall the dropdown's first
   * paint. The user clicks "Load More" to grow the slice.
   */
  // states
  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  // store
  const { getProjectById, joinedProjectIds } = useProject();
  // derived values
  const projects = joinedProjectIds?.map((projectId) => getProjectById(projectId)!) ?? null;
  const appliedFiltersCount = appliedFilters?.length ?? 0;

  const sortedOptions = useMemo(() => {
    const filteredOptions = (projects || []).filter((project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return sortBy(filteredOptions, [
      (project) => !(appliedFilters ?? []).includes(project.id),
      (project) => project.name.toLowerCase(),
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
        title={`Project${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {sortedOptions ? (
            sortedOptions.length > 0 ? (
              <>
                {sortedOptions.slice(0, itemsToRender).map((project) => (
                  <FilterOption
                    key={`project-${project.id}`}
                    isChecked={appliedFilters?.includes(project.id) ? true : false}
                    onClick={() => handleUpdate(project.id)}
                    icon={
                      <span className="grid h-4 w-4 flex-shrink-0 place-items-center">
                        <Logo logo={project.logo_props} size={12} />
                      </span>
                    }
                    title={project.name}
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
