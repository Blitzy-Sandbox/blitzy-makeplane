/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed list view that renders the project's archived cycles via the shared
 * `CyclesList` component in archived mode, switching to a loader or a filter/search-
 * aware empty state when the filtered result set is empty.
 *
 * Props (`IArchivedCyclesView`):
 *   - workspaceSlug (string, required): workspace slug forwarded to `CyclesList` for
 *     downstream API targeting in row-level actions.
 *   - projectId (string, required): project ID used to derive the filtered archived
 *     cycle ID list and forwarded to `CyclesList`.
 *
 * MobX stores read:
 *   - useCycle (cycle store): `getFilteredArchivedCycleIds(projectId)` to compute
 *     the project-scoped filtered ID list, and `loader` to show the skeleton during
 *     the parent route's SWR fetch.
 *   - useCycleFilter (cycle filter store): `archivedCyclesSearchQuery` to pick the
 *     empty-state copy and artwork variant (filter empty vs. search empty).
 *
 * Side effects:
 *   - None directly — this component is a pure selector over store-derived data.
 *     The archived-cycles fetch is owned by the parent `ArchivedCycleLayoutRoot`
 *     (via SWR); row-level mutations (restore, delete, copy-link, etc.) are owned
 *     by the row quick-actions menu mounted inside `CyclesList`.
 *
 * Conditional rendering:
 *   - When `loader` is truthy or `filteredArchivedCycleIds` is undefined →
 *     `CycleModuleListLayoutLoader`.
 *   - When `filteredArchivedCycleIds.length === 0` → centered empty state with
 *     either `AllFiltersImage` (when `archivedCyclesSearchQuery` is blank, meaning
 *     filters alone are responsible for the empty result) or `NameFilterImage`
 *     (when a search query is present, with copy directing the user to clear it).
 *   - Otherwise → `CyclesList` with `completedCycleIds={[]}`, the filtered archived
 *     IDs as `cycleIds`, and `isArchived` to drive archive-specific row UI.
 *
 * Consumers:
 *   - `ArchivedCycleLayoutRoot` in `./root.tsx` mounts this view inside a
 *     full-height scrollable container when there is at least one archived cycle
 *     in the current project.
 */

import { observer } from "mobx-react";
// assets
import AllFiltersImage from "@/app/assets/empty-state/cycle/all-filters.svg?url";
import NameFilterImage from "@/app/assets/empty-state/cycle/name-filter.svg?url";
// components
import { CyclesList } from "@/components/cycles/list";
// ui
import { CycleModuleListLayoutLoader } from "@/components/ui/loader/cycle-module-list-loader";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";

export interface IArchivedCyclesView {
  workspaceSlug: string;
  projectId: string;
}

export const ArchivedCyclesView = observer(function ArchivedCyclesView(props: IArchivedCyclesView) {
  const { workspaceSlug, projectId } = props;
  // store hooks
  const { getFilteredArchivedCycleIds, loader } = useCycle();
  const { archivedCyclesSearchQuery } = useCycleFilter();
  // derived values
  const filteredArchivedCycleIds = getFilteredArchivedCycleIds(projectId);

  if (loader || !filteredArchivedCycleIds) return <CycleModuleListLayoutLoader />;

  if (filteredArchivedCycleIds.length === 0)
    return (
      <div className="grid h-full w-full place-items-center">
        <div className="text-center">
          <img
            src={archivedCyclesSearchQuery.trim() === "" ? AllFiltersImage : NameFilterImage}
            className="mx-auto h-36 w-36 sm:h-48 sm:w-48"
            alt="No matching cycles"
          />
          <h5 className="mt-7 mb-1 text-18 font-medium">No matching cycles</h5>
          <p className="text-14 text-placeholder">
            {archivedCyclesSearchQuery.trim() === ""
              ? "Remove the filters to see all cycles"
              : "Remove the search criteria to see all cycles"}
          </p>
        </div>
      </div>
    );

  return (
    <CyclesList
      completedCycleIds={[]}
      cycleIds={filteredArchivedCycleIds}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      isArchived
    />
  );
});
