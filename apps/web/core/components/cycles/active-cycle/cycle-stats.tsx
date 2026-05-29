/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed tabbed-statistics panel for the active cycle screen with three tabs —
 * Priority issues (paginated, infinite-scroll list of urgent/high-priority work items),
 * Assignees (per-assignee completion progress), and Labels (per-label completion progress).
 * Persists the selected tab in localStorage so it survives reloads, and converts row clicks
 * into either a work-item peek panel open or a filter application via `handleFiltersUpdate`.
 *
 * Props (ActiveCycleStatsProps):
 *   - workspaceSlug (string, required): workspace slug used for the peek-issue payload and
 *     paginated issue fetches.
 *   - projectId (string, required): project ID used for the peek-issue payload, paginated
 *     issue fetches, and the StateDropdown / IssueIdentifier project context.
 *   - cycle (ICycle | null, required): active cycle whose distribution.assignees and
 *     distribution.labels populate the Assignees and Labels tabs.
 *   - cycleId (string | null, optional): when null/undefined the entire panel renders a
 *     full-card Loader skeleton; when present, the tabs render.
 *   - handleFiltersUpdate ((conditions: TWorkItemFilterCondition[]) => void, required):
 *     callback used to push filter changes (priority / assignee_id / label_id) into the
 *     cycle-scoped issue filter store; typically supplied by `useCyclesDetails`.
 *   - cycleIssueDetails (ActiveCycleIssueDetails | { nextPageResults: boolean }, optional):
 *     paginated priority-issue payload from the cycle issues store; the union allows a safe
 *     fallback when no cycle id is available.
 *
 * MobX stores read:
 *   - useIssues(EIssuesStoreType.CYCLE): destructures `issues.fetchNextActiveCycleIssues`
 *     used by the infinite-scroll loader for the Priority-Issues tab.
 *   - useIssueDetail: destructures `issue.getIssueById` to resolve each priority-issue row
 *     and `setPeekIssue` to open the work-item peek panel on row click.
 *
 * Side effects:
 *   - API calls (via store actions wired to IssueService):
 *       - fetchNextActiveCycleIssues(workspaceSlug, projectId, cycleId) when the
 *         intersection observer scrolls the loader sentinel into view.
 *   - Mutations:
 *       - handleFiltersUpdate([{ property: "priority", operator: "in", value: ["urgent","high"] }])
 *         on a priority-issue row click (alongside the peek open).
 *       - handleFiltersUpdate([{ property: "assignee_id", operator: "in", value: [assignee_id] }])
 *         on an assignee progress row click (only when the row has an assignee_id; unassigned
 *         rows are not clickable).
 *       - handleFiltersUpdate([{ property: "label_id", operator: "in", value: [label_id] }])
 *         on a label progress row click (only when the row has a label_id).
 *       - setPeekIssue({ workspaceSlug, projectId, issueId, isArchived }) opens the cycle's
 *         issue peek panel for the clicked priority issue.
 *   - DOM / imperative interactions:
 *       - useLocalStorage("activeCycleTab", "Assignees") persists the active tab name
 *         across reloads; the stored string is mapped to a numeric Tab.Group defaultIndex
 *         via `currentValue`.
 *       - useIntersectionObserver(issuesContainerRef, issuesLoaderElement, loadMoreIssues,
 *         "0% 0% 100% 0%") drives infinite-scroll pagination on the Priority-Issues tab.
 *   - Theme: useTheme().resolvedTheme selects the light/dark empty-state webp for each tab.
 *   - No direct navigation calls — the peek panel is mounted by the parent route.
 *
 * Consumers: the active cycle detail experience under apps/web/app/[workspaceSlug]/projects/
 * [projectId]/cycles/(detail)/[cycleId]/active-cycle.
 */

import { Fragment, useCallback, useRef, useState } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
import { CalendarCheck } from "lucide-react";
// headless ui
import { Tab } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PriorityIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { TWorkItemFilterCondition } from "@plane/shared-state";
import type { ICycle } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
// ui
import { Loader, Avatar } from "@plane/ui";
import { cn, renderFormattedDate, renderFormattedDateWithoutYear, getFileURL } from "@plane/utils";
// assets
import darkAssigneeAsset from "@/app/assets/empty-state/active-cycle/assignee-dark.webp?url";
import lightAssigneeAsset from "@/app/assets/empty-state/active-cycle/assignee-light.webp?url";
import darkLabelAsset from "@/app/assets/empty-state/active-cycle/label-dark.webp?url";
import lightLabelAsset from "@/app/assets/empty-state/active-cycle/label-light.webp?url";
import darkPriorityAsset from "@/app/assets/empty-state/active-cycle/priority-dark.webp?url";
import lightPriorityAsset from "@/app/assets/empty-state/active-cycle/priority-light.webp?url";
import userImage from "@/app/assets/user.png?url";
// components
import { SingleProgressStats } from "@/components/core/sidebar/single-progress-stats";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { SimpleEmptyState } from "@/components/empty-state/simple-empty-state-root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import useLocalStorage from "@/hooks/use-local-storage";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// store
import type { ActiveCycleIssueDetails } from "@/store/issue/cycle";

export type ActiveCycleStatsProps = {
  workspaceSlug: string;
  projectId: string;
  cycle: ICycle | null;
  cycleId?: string | null;
  handleFiltersUpdate: (conditions: TWorkItemFilterCondition[]) => void;
  cycleIssueDetails?: ActiveCycleIssueDetails | { nextPageResults: boolean };
};

export const ActiveCycleStats = observer(function ActiveCycleStats(props: ActiveCycleStatsProps) {
  const { workspaceSlug, projectId, cycle, cycleId, handleFiltersUpdate, cycleIssueDetails } = props;
  // local storage
  const { storedValue: tab, setValue: setTab } = useLocalStorage("activeCycleTab", "Assignees");
  // refs
  const issuesContainerRef = useRef<HTMLDivElement | null>(null);
  // states
  const [issuesLoaderElement, setIssueLoaderElement] = useState<HTMLDivElement | null>(null);
  // theme hook
  const { resolvedTheme } = useTheme();
  // plane hooks
  const { t } = useTranslation();
  // derived values
  const priorityResolvedPath = resolvedTheme === "light" ? lightPriorityAsset : darkPriorityAsset;
  const assigneesResolvedPath = resolvedTheme === "light" ? lightAssigneeAsset : darkAssigneeAsset;
  const labelsResolvedPath = resolvedTheme === "light" ? lightLabelAsset : darkLabelAsset;

  const currentValue = (tab: string | null) => {
    switch (tab) {
      case "Priority-Issues":
        return 0;
      case "Assignees":
        return 1;
      case "Labels":
        return 2;
      default:
        return 0;
    }
  };
  const {
    issues: { fetchNextActiveCycleIssues },
  } = useIssues(EIssuesStoreType.CYCLE);
  const {
    issue: { getIssueById },
    setPeekIssue,
  } = useIssueDetail();
  const loadMoreIssues = useCallback(() => {
    if (!cycleId) return;
    fetchNextActiveCycleIssues(workspaceSlug, projectId, cycleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, cycleId, issuesLoaderElement, cycleIssueDetails?.nextPageResults]);

  useIntersectionObserver(issuesContainerRef, issuesLoaderElement, loadMoreIssues, `0% 0% 100% 0%`);

  const loaders = (
    <Loader className="space-y-3">
      <Loader.Item height="30px" />
      <Loader.Item height="30px" />
      <Loader.Item height="30px" />
    </Loader>
  );

  return cycleId ? (
    <div className="col-span-1 flex min-h-[17rem] flex-col gap-4 overflow-hidden rounded-lg border border-subtle bg-surface-1 p-4 lg:col-span-2 xl:col-span-1">
      <Tab.Group
        as={Fragment}
        defaultIndex={currentValue(tab)}
        onChange={(i) => {
          switch (i) {
            case 0:
              return setTab("Priority-Issues");
            case 1:
              return setTab("Assignees");
            case 2:
              return setTab("Labels");

            default:
              return setTab("Priority-Issues");
          }
        }}
      >
        <Tab.List
          as="div"
          className="relative grid rounded-sm border-[0.5px] border-subtle bg-layer-1 p-[1px]"
          style={{
            gridTemplateColumns: `repeat(3, 1fr)`,
          }}
        >
          <Tab
            className={({ selected }) =>
              cn(
                "relative z-[1] rounded-[3px] py-1.5 text-11 font-semibold text-placeholder transition duration-500 focus:outline-none",
                {
                  "bg-surface-1 text-tertiary": selected,
                  "hover:text-tertiary": !selected,
                }
              )
            }
          >
            {t("project_cycles.active_cycle.priority_issue")}
          </Tab>
          <Tab
            className={({ selected }) =>
              cn(
                "relative z-[1] rounded-[3px] py-1.5 text-11 font-semibold text-placeholder transition duration-500 focus:outline-none",
                {
                  "bg-surface-1 text-tertiary": selected,
                  "hover:text-tertiary": !selected,
                }
              )
            }
          >
            {t("project_cycles.active_cycle.assignees")}
          </Tab>
          <Tab
            className={({ selected }) =>
              cn(
                "relative z-[1] rounded-[3px] py-1.5 text-11 font-semibold text-placeholder transition duration-500 focus:outline-none",
                {
                  "bg-surface-1 text-tertiary": selected,
                  "hover:text-tertiary": !selected,
                }
              )
            }
          >
            {t("project_cycles.active_cycle.labels")}
          </Tab>
        </Tab.List>

        <Tab.Panels as={Fragment}>
          <Tab.Panel
            as="div"
            className="vertical-scrollbar flex scrollbar-sm h-52 w-full flex-col gap-1 overflow-y-auto text-secondary"
          >
            <div
              ref={issuesContainerRef}
              className="vertical-scrollbar flex scrollbar-sm h-full w-full flex-col gap-1 overflow-y-auto"
            >
              {cycleIssueDetails && "issueIds" in cycleIssueDetails ? (
                cycleIssueDetails.issueCount > 0 ? (
                  <>
                    {cycleIssueDetails.issueIds.map((issueId: string) => {
                      const issue = getIssueById(issueId);

                      if (!issue) return null;

                      return (
                        <div
                          key={issue.id}
                          className="group flex cursor-pointer items-center justify-between gap-2 rounded-md p-1 hover:bg-surface-2"
                          onClick={() => {
                            if (issue.id) {
                              setPeekIssue({
                                workspaceSlug,
                                projectId,
                                issueId: issue.id,
                                isArchived: !!issue.archived_at,
                              });
                              handleFiltersUpdate([
                                { property: "priority", operator: "in", value: ["urgent", "high"] },
                              ]);
                            }
                          }}
                        >
                          <div className="flex w-full min-w-24 flex-grow items-center gap-1.5 truncate">
                            <IssueIdentifier issueId={issue.id} projectId={projectId} size="xs" variant="secondary" />
                            <Tooltip position="top-start" tooltipHeading="Title" tooltipContent={issue.name}>
                              <span className="truncate text-13 text-primary">{issue.name}</span>
                            </Tooltip>
                          </div>
                          <PriorityIcon priority={issue.priority} withContainer size={12} />
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <StateDropdown
                              value={issue.state_id}
                              onChange={() => {}}
                              projectId={projectId?.toString() ?? ""}
                              disabled
                              buttonVariant="background-with-text"
                              buttonContainerClassName="cursor-pointer max-w-24"
                              showTooltip
                            />
                            {issue.target_date && (
                              <Tooltip
                                tooltipHeading="Target Date"
                                tooltipContent={renderFormattedDate(issue.target_date)}
                              >
                                <div className="flex h-full cursor-pointer items-center gap-1.5 truncate rounded-sm bg-layer-1 px-2 py-0.5 text-11 group-hover:bg-surface-1">
                                  <CalendarCheck className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate text-11">
                                    {renderFormattedDateWithoutYear(issue.target_date)}
                                  </span>
                                </div>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(cycleIssueDetails.nextPageResults === undefined || cycleIssueDetails.nextPageResults) && (
                      <div
                        ref={setIssueLoaderElement}
                        className={
                          "relative flex h-11 animate-pulse cursor-pointer items-center gap-3 bg-layer-1 p-3 text-13"
                        }
                      />
                    )}
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <SimpleEmptyState
                      title={t("active_cycle.empty_state.priority_issue.title")}
                      assetPath={priorityResolvedPath}
                    />
                  </div>
                )
              ) : (
                loaders
              )}
            </div>
          </Tab.Panel>

          <Tab.Panel
            as="div"
            className="vertical-scrollbar flex scrollbar-sm h-52 w-full flex-col gap-1 overflow-y-auto text-secondary"
          >
            {cycle && !isEmpty(cycle.distribution) ? (
              cycle?.distribution?.assignees && cycle.distribution.assignees.length > 0 ? (
                cycle.distribution?.assignees?.map((assignee, index) => {
                  if (assignee.assignee_id)
                    return (
                      <SingleProgressStats
                        key={assignee.assignee_id}
                        title={
                          <div className="flex items-center gap-2">
                            <Avatar
                              name={assignee?.display_name ?? undefined}
                              src={getFileURL(assignee?.avatar_url ?? "")}
                            />

                            <span>{assignee.display_name}</span>
                          </div>
                        }
                        completed={assignee.completed_issues}
                        total={assignee.total_issues}
                        onClick={() => {
                          if (assignee.assignee_id) {
                            handleFiltersUpdate([
                              { property: "assignee_id", operator: "in", value: [assignee.assignee_id] },
                            ]);
                          }
                        }}
                      />
                    );
                  else
                    return (
                      <SingleProgressStats
                        key={`unassigned-${index}`}
                        title={
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-5 rounded-full border-2 border-subtle bg-layer-1">
                              <img src={userImage} height="100%" width="100%" className="rounded-full" alt="User" />
                            </div>
                            <span>{t("no_assignee")}</span>
                          </div>
                        }
                        completed={assignee.completed_issues}
                        total={assignee.total_issues}
                      />
                    );
                })
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <SimpleEmptyState
                    title={t("active_cycle.empty_state.assignee.title")}
                    assetPath={assigneesResolvedPath}
                  />
                </div>
              )
            ) : (
              loaders
            )}
          </Tab.Panel>

          <Tab.Panel
            as="div"
            className="vertical-scrollbar flex scrollbar-sm h-52 w-full flex-col gap-1 overflow-y-auto text-secondary"
          >
            {cycle && !isEmpty(cycle.distribution) ? (
              cycle?.distribution?.labels && cycle.distribution.labels.length > 0 ? (
                cycle.distribution.labels?.map((label, index) => (
                  <SingleProgressStats
                    key={label.label_id ?? `no-label-${index}`}
                    title={
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="block h-3 w-3 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor: label.color ?? "#000000",
                          }}
                        />
                        <span className="truncate text-11 text-ellipsis">{label.label_name ?? "No labels"}</span>
                      </div>
                    }
                    completed={label.completed_issues}
                    total={label.total_issues}
                    onClick={
                      label.label_id
                        ? () => {
                            if (label.label_id) {
                              handleFiltersUpdate([{ property: "label_id", operator: "in", value: [label.label_id] }]);
                            }
                          }
                        : undefined
                    }
                  />
                ))
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <SimpleEmptyState title={t("active_cycle.empty_state.label.title")} assetPath={labelsResolvedPath} />
                </div>
              )
            ) : (
              loaders
            )}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  ) : (
    <Loader className="col-span-1 flex min-h-[17rem] flex-col gap-4 overflow-hidden bg-surface-1 lg:col-span-2 xl:col-span-1">
      <Loader.Item width="100%" height="17rem" />
    </Loader>
  );
});
