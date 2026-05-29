/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * CycleProgressStats — tabbed breakdown of cycle progress by state group, assignee, and label.
 *
 * Rendered purpose:
 *   Renders three accessibility-aware tabs (state groups, assignees, labels) using
 *   `@headlessui/react` `Tab.Group`. Each panel displays a distribution row component
 *   (StateGroupStatComponent, AssigneeStatComponent, LabelStatComponent) with optional
 *   filter-edit affordances when `isEditable` is true.
 *
 * Props (TCycleProgressStats):
 *   - cycleId: string (required) — keys the persisted tab choice in localStorage.
 *   - distribution: TCycleDistribution | TCycleEstimateDistribution | undefined (required) —
 *     cycle distribution payload already selected upstream by the per-viewer
 *     `TCycleEstimateType` (`"issues"` → `cycleDetails.distribution`,
 *     `"points"` → `cycleDetails.estimate_distribution`) in
 *     `analytics-sidebar/issue-progress.tsx`. The component does not re-derive
 *     the data shape from `plotType`.
 *   - groupedIssues: Record<string, number> (required) — aggregate counts by state group.
 *   - handleFiltersUpdate: (condition: TWorkItemFilterCondition) => void (required) —
 *     callback delegated from the parent to commit filter changes (e.g., toggle an
 *     assignee/label/state-group filter in the work-item filter store).
 *   - isEditable?: boolean (optional, default false) — gates clickability of rows; when
 *     false, rows render as read-only.
 *   - noBackground?: boolean (optional, default false) — strips the `bg-layer-2` tab list bg.
 *   - plotType: TCyclePlotType (required) — burn direction of the cycle chart:
 *     `"burndown"` (remaining work decreases toward zero) or `"burnup"` (completed
 *     work increases toward scope). It controls chart shape, not the analytics
 *     data shape — that is the role of `estimateType` upstream.
 *   - roundedTab?: boolean (optional, default false) — switches tab pill radius styling.
 *   - selectedFilters: TSelectedFilterProgressStats (required) — currently active
 *     assignee / label / state-group filter conditions for highlighting selected rows.
 *   - size?: "xs" | "sm" (optional, default "sm") — text-size variant.
 *   - totalIssuesCount: number (required) — denominator for the state-group progress bars.
 *
 * MobX stores read:
 *   - `useTranslation` (`@plane/i18n`) — localized tab titles via `stat.i18n_title`.
 *   - No direct cycle / work-item store reads — all data is passed in via props from
 *     the parent `CycleAnalyticsProgress`.
 *
 * Hooks:
 *   - `useLocalStorage(`cycle-analytics-tab-${cycleId}`, "stat-assignees")` — persists
 *     the active tab per-cycle across sessions.
 *
 * Side effects:
 *   - Persists `currentTab` to localStorage via `setCycleTab` when a tab is clicked.
 *   - Filter mutations: `createFilterUpdateHandler("assignee_id" | "label_id" | "state_group",
 *     currentSelection, handleFiltersUpdate)` builds bound handlers that the child stat
 *     components invoke on row clicks; the parent's `handleFiltersUpdate` then writes to
 *     the work-item filter store.
 *
 * Consumers:
 *   - `apps/web/core/components/cycles/analytics-sidebar/issue-progress.tsx` (renders this
 *     inside the `CycleAnalyticsProgress` disclosure panel when distribution data exists).
 */

import { observer } from "mobx-react";
import { Tab } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TWorkItemFilterCondition } from "@plane/shared-state";
import type { TCycleDistribution, TCycleEstimateDistribution, TCyclePlotType } from "@plane/types";
import { cn, toFilterArray } from "@plane/utils";
// components
import type { TAssigneeData } from "@/components/core/sidebar/progress-stats/assignee";
import { AssigneeStatComponent } from "@/components/core/sidebar/progress-stats/assignee";
import type { TLabelData } from "@/components/core/sidebar/progress-stats/label";
import { LabelStatComponent } from "@/components/core/sidebar/progress-stats/label";
import type { TSelectedFilterProgressStats } from "@/components/core/sidebar/progress-stats/shared";
import { createFilterUpdateHandler, PROGRESS_STATS } from "@/components/core/sidebar/progress-stats/shared";
import type { TStateGroupData } from "@/components/core/sidebar/progress-stats/state_group";
import { StateGroupStatComponent } from "@/components/core/sidebar/progress-stats/state_group";
// helpers
// hooks
import useLocalStorage from "@/hooks/use-local-storage";

type TCycleProgressStats = {
  cycleId: string;
  distribution: TCycleDistribution | TCycleEstimateDistribution | undefined;
  groupedIssues: Record<string, number>;
  handleFiltersUpdate: (condition: TWorkItemFilterCondition) => void;
  isEditable?: boolean;
  noBackground?: boolean;
  plotType: TCyclePlotType;
  roundedTab?: boolean;
  selectedFilters: TSelectedFilterProgressStats;
  size?: "xs" | "sm";
  totalIssuesCount: number;
};

export const CycleProgressStats = observer(function CycleProgressStats(props: TCycleProgressStats) {
  const {
    cycleId,
    distribution,
    groupedIssues,
    handleFiltersUpdate,
    isEditable = false,
    noBackground = false,
    plotType,
    roundedTab = false,
    selectedFilters,
    size = "sm",
    totalIssuesCount,
  } = props;
  // plane imports
  const { t } = useTranslation();
  // store imports
  const { storedValue: currentTab, setValue: setCycleTab } = useLocalStorage(
    `cycle-analytics-tab-${cycleId}`,
    "stat-assignees"
  );
  // derived values
  const currentTabIndex = (tab: string): number => PROGRESS_STATS.findIndex((stat) => stat.key === tab);
  const currentDistribution = distribution as TCycleDistribution;
  const currentEstimateDistribution = distribution as TCycleEstimateDistribution;
  const selectedAssigneeIds = toFilterArray(selectedFilters?.assignees?.value || []) as string[];
  const selectedLabelIds = toFilterArray(selectedFilters?.labels?.value || []) as string[];
  const selectedStateGroups = toFilterArray(selectedFilters?.stateGroups?.value || []) as string[];

  // INTENT UNCLEAR: CycleProgressStats branches issue vs estimate row mapping on
  // plotType ("burndown" -> issue counts; otherwise -> estimate points), even though
  // estimateType is the upstream selector that decides which distribution payload
  // (`cycleDetails.distribution` vs `cycleDetails.estimate_distribution`) is passed in.
  const distributionAssigneeData: TAssigneeData =
    plotType === "burndown"
      ? (currentDistribution?.assignees || []).map((assignee) => ({
          id: assignee?.assignee_id || undefined,
          title: assignee?.display_name || undefined,
          avatar_url: assignee?.avatar_url || undefined,
          completed: assignee.completed_issues,
          total: assignee.total_issues,
        }))
      : (currentEstimateDistribution?.assignees || []).map((assignee) => ({
          id: assignee?.assignee_id || undefined,
          title: assignee?.display_name || undefined,
          avatar_url: assignee?.avatar_url || undefined,
          completed: assignee.completed_estimates,
          total: assignee.total_estimates,
        }));

  const distributionLabelData: TLabelData =
    plotType === "burndown"
      ? (currentDistribution?.labels || []).map((label) => ({
          id: label?.label_id || undefined,
          title: label?.label_name || undefined,
          color: label?.color || undefined,
          completed: label.completed_issues,
          total: label.total_issues,
        }))
      : (currentEstimateDistribution?.labels || []).map((label) => ({
          id: label?.label_id || undefined,
          title: label?.label_name || undefined,
          color: label?.color || undefined,
          completed: label.completed_estimates,
          total: label.total_estimates,
        }));

  const distributionStateData: TStateGroupData = Object.keys(groupedIssues || {}).map((state) => ({
    state: state,
    completed: groupedIssues?.[state] || 0,
    total: totalIssuesCount || 0,
  }));

  const handleAssigneeFiltersUpdate = createFilterUpdateHandler(
    "assignee_id",
    selectedAssigneeIds,
    handleFiltersUpdate
  );
  const handleLabelFiltersUpdate = createFilterUpdateHandler("label_id", selectedLabelIds, handleFiltersUpdate);
  const handleStateGroupFiltersUpdate = createFilterUpdateHandler(
    "state_group",
    selectedStateGroups,
    handleFiltersUpdate
  );

  return (
    <div>
      <Tab.Group defaultIndex={currentTabIndex(currentTab ? currentTab : "stat-assignees")}>
        <Tab.List
          as="div"
          className={cn(
            `flex w-full items-center justify-between gap-2 rounded-md p-1`,
            roundedTab ? `rounded-3xl` : `rounded-md`,
            noBackground ? `` : `bg-layer-2`,
            size === "xs" ? `text-11` : `text-13`
          )}
        >
          {PROGRESS_STATS.map((stat) => (
            <Tab
              className={cn(
                `w-full cursor-pointer p-1 text-primary transition-all outline-none focus:outline-none`,
                roundedTab ? `rounded-3xl border border-subtle` : `rounded-sm`,
                stat.key === currentTab
                  ? "bg-layer-transparent-active text-secondary"
                  : "text-placeholder hover:text-secondary"
              )}
              key={stat.key}
              onClick={() => setCycleTab(stat.key)}
            >
              {t(stat.i18n_title)}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="py-3 text-secondary">
          <Tab.Panel key={"stat-states"}>
            <StateGroupStatComponent
              distribution={distributionStateData}
              handleStateGroupFiltersUpdate={handleStateGroupFiltersUpdate}
              isEditable={isEditable}
              selectedStateGroups={selectedStateGroups}
              totalIssuesCount={totalIssuesCount}
            />
          </Tab.Panel>
          <Tab.Panel key={"stat-assignees"}>
            <AssigneeStatComponent
              distribution={distributionAssigneeData}
              handleAssigneeFiltersUpdate={handleAssigneeFiltersUpdate}
              isEditable={isEditable}
              selectedAssigneeIds={selectedAssigneeIds}
            />
          </Tab.Panel>
          <Tab.Panel key={"stat-labels"}>
            <LabelStatComponent
              distribution={distributionLabelData}
              handleLabelFiltersUpdate={handleLabelFiltersUpdate}
              isEditable={isEditable}
              selectedLabelIds={selectedLabelIds}
            />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
});
