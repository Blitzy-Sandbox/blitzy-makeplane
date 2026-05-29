/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * CycleAnalyticsProgress — collapsible progress panel inside the cycle sidebar.
 *
 * Rendered purpose:
 *   Shows the burndown/burnup chart and the assignee/label/state-group breakdowns
 *   for the selected cycle, gated on valid cycle start/end dates. Renders a
 *   "no data yet" notice when dates are missing or invalid.
 *
 * Props (TCycleAnalyticsProgress):
 *   - workspaceSlug: string (required) — forwarded to SidebarChartRoot.
 *   - projectId: string (required) — forwarded to SidebarChartRoot.
 *   - cycleId: string (required) — keys distribution + filter lookups.
 *
 * MobX stores read:
 *   - `useCycle` — `getPlotTypeByCycleId`, `getEstimateTypeByCycleId`, `getCycleById`.
 *   - `useWorkItemFilters` — `getFilter`, `updateFilterValueFromSidebar` for CYCLE store type.
 *   - `useTranslation` (`@plane/i18n`) — localized labels.
 *
 * Side effects:
 *   - Filter mutations: `CycleProgressStats` invokes `updateFilterValueFromSidebar` (bound
 *     via `Function.prototype.bind` to the CYCLE store + cycleId) when state-group / assignee
 *     / label rows are clicked.
 *   - Reads `peekCycle` query param via `useSearchParams` to decide whether filter editing
 *     is allowed (chart is read-only inside peek view).
 *
 * Named exports (in addition to the component):
 *   - `cycleEstimateOptions`: static `{value, label}[]` choices for "Work items" vs. "Estimates".
 *   - `cycleChartOptions`: static `{value, label}[]` choices for "Burn-down" vs. "Burn-up".
 *   - `validateCycleSnapshot(cycleDetails)`: flattens `progress_snapshot` keys onto the
 *     cycle record so completed-cycle counts override live counts.
 *
 * Consumers:
 *   - `apps/web/core/components/cycles/analytics-sidebar/root.tsx` (renders this directly
 *     when `workspaceSlug && projectId && cycleDetails?.id` are all present).
 */

import { useMemo } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { Disclosure, Transition } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ChevronUpIcon, ChevronDownIcon } from "@plane/propel/icons";
import type { ICycle, TCyclePlotType, TProgressSnapshot } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { getDate } from "@plane/utils";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
// plane web components
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";
import { SidebarChartRoot } from "@/plane-web/components/cycles";
// local imports
import { CycleProgressStats } from "./progress-stats";

type TCycleAnalyticsProgress = {
  workspaceSlug: string;
  projectId: string;
  cycleId: string;
};
type Options = {
  value: string;
  label: string;
};

export const cycleEstimateOptions: Options[] = [
  { value: "issues", label: "Work items" },
  { value: "points", label: "Estimates" },
];
export const cycleChartOptions: Options[] = [
  { value: "burndown", label: "Burn-down" },
  { value: "burnup", label: "Burn-up" },
];

export const validateCycleSnapshot = (cycleDetails: ICycle | null): ICycle | null => {
  if (!cycleDetails || cycleDetails === null) return cycleDetails;

  const updatedCycleDetails: any = { ...cycleDetails };
  if (!isEmpty(cycleDetails.progress_snapshot)) {
    Object.keys(cycleDetails.progress_snapshot || {}).forEach((key) => {
      const currentKey = key as keyof TProgressSnapshot;
      if (!isEmpty(cycleDetails.progress_snapshot) && !isEmpty(updatedCycleDetails)) {
        updatedCycleDetails[currentKey as keyof ICycle] = cycleDetails?.progress_snapshot?.[currentKey];
      }
    });
  }
  return updatedCycleDetails;
};

export const CycleAnalyticsProgress = observer(function CycleAnalyticsProgress(props: TCycleAnalyticsProgress) {
  // props
  const { workspaceSlug, projectId, cycleId } = props;
  // router
  const searchParams = useSearchParams();
  const peekCycle = searchParams.get("peekCycle") || undefined;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getPlotTypeByCycleId, getEstimateTypeByCycleId, getCycleById } = useCycle();
  const { getFilter, updateFilterValueFromSidebar } = useWorkItemFilters();
  // derived values
  const cycleFilter = getFilter(EIssuesStoreType.CYCLE, cycleId);
  const selectedAssignees = cycleFilter?.findFirstConditionByPropertyAndOperator("assignee_id", "in");
  const selectedLabels = cycleFilter?.findFirstConditionByPropertyAndOperator("label_id", "in");
  const selectedStateGroups = cycleFilter?.findFirstConditionByPropertyAndOperator("state_group", "in");
  const cycleDetails = validateCycleSnapshot(getCycleById(cycleId));
  const plotType: TCyclePlotType = getPlotTypeByCycleId(cycleId);
  const estimateType = getEstimateTypeByCycleId(cycleId);
  const totalIssues = cycleDetails?.total_issues || 0;
  const totalEstimatePoints = cycleDetails?.total_estimate_points || 0;
  const chartDistributionData =
    estimateType === "points" ? cycleDetails?.estimate_distribution : cycleDetails?.distribution || undefined;
  const groupedIssues = useMemo(
    () => ({
      backlog:
        estimateType === "points" ? cycleDetails?.backlog_estimate_points || 0 : cycleDetails?.backlog_issues || 0,
      unstarted:
        estimateType === "points" ? cycleDetails?.unstarted_estimate_points || 0 : cycleDetails?.unstarted_issues || 0,
      started:
        estimateType === "points" ? cycleDetails?.started_estimate_points || 0 : cycleDetails?.started_issues || 0,
      completed:
        estimateType === "points" ? cycleDetails?.completed_estimate_points || 0 : cycleDetails?.completed_issues || 0,
      cancelled:
        estimateType === "points" ? cycleDetails?.cancelled_estimate_points || 0 : cycleDetails?.cancelled_issues || 0,
    }),
    [estimateType, cycleDetails]
  );
  const cycleStartDate = getDate(cycleDetails?.start_date);
  const cycleEndDate = getDate(cycleDetails?.end_date);
  const isCycleStartDateValid = cycleStartDate && cycleStartDate <= new Date();
  const isCycleEndDateValid = cycleStartDate && cycleEndDate && cycleEndDate >= cycleStartDate;
  const isCycleDateValid = isCycleStartDateValid && isCycleEndDateValid;

  if (!cycleDetails) return <></>;
  return (
    <div className="space-y-4 border-t border-subtle py-5">
      <Disclosure defaultOpen>
        {({ open }) => (
          <div className="flex flex-col">
            {/* progress bar header */}
            {isCycleDateValid ? (
              <div className="relative flex w-full items-center justify-between gap-2">
                <Disclosure.Button className="relative flex w-full items-center gap-2">
                  <div className="text-13 font-medium text-secondary">{t("project_cycles.active_cycle.progress")}</div>
                </Disclosure.Button>
                <Disclosure.Button className="ml-auto">
                  {open ? (
                    <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Disclosure.Button>
              </div>
            ) : (
              <div className="relative flex w-full items-center justify-between gap-2">
                <div className="text-13 font-medium text-secondary">{t("project_cycles.active_cycle.progress")}</div>
              </div>
            )}
            <Transition show={open}>
              <Disclosure.Panel className="flex flex-col divide-y divide-subtle-1">
                {cycleStartDate && cycleEndDate ? (
                  <>
                    {isCycleDateValid && (
                      <SidebarChartRoot workspaceSlug={workspaceSlug} projectId={projectId} cycleId={cycleId} />
                    )}
                    {/* progress detailed view */}
                    {chartDistributionData && (
                      <div className="w-full py-4">
                        <CycleProgressStats
                          cycleId={cycleId}
                          distribution={chartDistributionData}
                          groupedIssues={groupedIssues}
                          handleFiltersUpdate={updateFilterValueFromSidebar.bind(
                            updateFilterValueFromSidebar,
                            EIssuesStoreType.CYCLE,
                            cycleId
                          )}
                          isEditable={Boolean(!peekCycle) && cycleFilter !== undefined}
                          noBackground={false}
                          plotType={plotType}
                          roundedTab={false}
                          selectedFilters={{
                            assignees: selectedAssignees,
                            labels: selectedLabels,
                            stateGroups: selectedStateGroups,
                          }}
                          size="xs"
                          totalIssuesCount={estimateType === "points" ? totalEstimatePoints || 0 : totalIssues || 0}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="my-2 w-full rounded-md bg-surface-2 px-2 py-2 text-13 text-tertiary">
                    {t("no_data_yet")}
                  </div>
                )}
              </Disclosure.Panel>
            </Transition>
          </div>
        )}
      </Disclosure>
    </div>
  );
});
