/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Main cycles screen body that selects between three views — loading skeleton,
 * search/filter empty state, or the populated CyclesList — based on cycle store
 * data and the user's current filter selection.
 *
 * Props (ICyclesView):
 *   - workspaceSlug (string, required): workspace slug used for store lookups and
 *     pass-through to CyclesList.
 *   - projectId (string, required): project ID used to compute filtered cycle IDs
 *     and as the partition key for CyclesList.
 *
 * MobX stores read:
 *   - useCycle (cycle store): getFilteredCycleIds(projectId, false) for non-completed
 *     cycles, getFilteredCompletedCycleIds(projectId) for completed cycles, the
 *     boolean `loader` flag, and `currentProjectActiveCycleId` used to subtract the
 *     active cycle from the upcoming subset.
 *   - useCycleFilter (cycle filter store): searchQuery used to pick the empty-state
 *     copy and artwork variant.
 *
 * Side effects:
 *   - None directly — no service calls, no navigations, no mutations. This component
 *     is a pure selector over store-derived data; downstream data fetching is owned
 *     by parent route components.
 *
 * Conditional rendering:
 *   - When `loader` is truthy or `filteredCycleIds` is undefined → CycleModuleListLayoutLoader.
 *   - When BOTH active+upcoming AND completed result sets are empty → empty state with
 *     either AllFiltersImage (no search query) or NameFilterImage (search query set).
 *   - Otherwise → CyclesList with completed / upcoming / overall cycle ID partitions.
 *
 * Consumers: cycle index route (apps/web/app/[workspaceSlug]/projects/[projectId]/cycles).
 */

import { observer } from "mobx-react";
// components
import { useTranslation } from "@plane/i18n";
// assets
import AllFiltersImage from "@/app/assets/empty-state/cycle/all-filters.svg?url";
import NameFilterImage from "@/app/assets/empty-state/cycle/name-filter.svg?url";
// components
import { CyclesList } from "@/components/cycles/list";
import { CycleModuleListLayoutLoader } from "@/components/ui/loader/cycle-module-list-loader";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";

export interface ICyclesView {
  workspaceSlug: string;
  projectId: string;
}

export const CyclesView = observer(function CyclesView(props: ICyclesView) {
  const { workspaceSlug, projectId } = props;
  // store hooks
  const { getFilteredCycleIds, getFilteredCompletedCycleIds, loader, currentProjectActiveCycleId } = useCycle();
  const { searchQuery } = useCycleFilter();
  const { t } = useTranslation();
  // derived values
  const filteredCycleIds = getFilteredCycleIds(projectId, false);
  const filteredCompletedCycleIds = getFilteredCompletedCycleIds(projectId);
  const filteredUpcomingCycleIds = (filteredCycleIds ?? []).filter(
    (cycleId) => cycleId !== currentProjectActiveCycleId
  );

  if (loader || !filteredCycleIds) return <CycleModuleListLayoutLoader />;

  if (filteredCycleIds.length === 0 && filteredCompletedCycleIds?.length === 0)
    return (
      <div className="grid h-full w-full place-items-center">
        <div className="text-center">
          <img
            src={searchQuery.trim() === "" ? AllFiltersImage : NameFilterImage}
            className="mx-auto h-36 w-36 object-contain sm:h-48 sm:w-48"
            alt="No matching cycles"
          />
          <h5 className="mt-7 mb-1 text-18 font-medium">{t("project_cycles.no_matching_cycles")}</h5>
          <p className="text-14 text-placeholder">
            {searchQuery.trim() === ""
              ? t("project_cycles.remove_filters_to_see_all_cycles")
              : t("project_cycles.remove_search_criteria_to_see_all_cycles")}
          </p>
        </div>
      </div>
    );

  return (
    <CyclesList
      completedCycleIds={filteredCompletedCycleIds ?? []}
      upcomingCycleIds={filteredUpcomingCycleIds}
      cycleIds={filteredCycleIds}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
    />
  );
});
