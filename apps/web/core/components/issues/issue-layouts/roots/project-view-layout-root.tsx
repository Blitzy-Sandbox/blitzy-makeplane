/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-aware layout orchestrator for a project view (a saved view inside a project): resolves
 * workspaceSlug/projectId/viewId from the route, hydrates view-scoped filters, and dispatches to
 * one of the project-view layout variants (list / kanban / calendar / gantt / spreadsheet).
 *
 * Props: none — driven by route params (workspaceSlug, projectId, viewId via useParams()).
 *
 * MobX stores read (injected via React context, not Redux):
 *   - useIssues(EIssuesStoreType.PROJECT_VIEW): issuesFilter for getIssueFilters/fetchFilters/updateFilterExpression/resetFilters.
 *   - useProjectView(): getViewById for the persisted project view (rich_filters seed).
 *
 * Derived state:
 *   - initialWorkItemFilters spreads local displayFilters/displayProperties/kanbanFilters but overrides
 *     richFilters with projectView.rich_filters so a freshly-opened view loads its persisted filter
 *     expression; undefined while the project view is unresolved.
 *
 * Side effects:
 *   - SWR key `PROJECT_VIEW_ISSUES_${workspaceSlug}_${projectId}_${viewId}` → issuesFilter.fetchFilters(workspaceSlug, projectId, viewId)
 *     (revalidation options are intentionally not set on this call, unlike sibling roots in this folder).
 *   - useEffect cleanup → issuesFilter.resetFilters(workspaceSlug, viewId) on unmount or when
 *     [issuesFilter, workspaceSlug, viewId] changes; this is the only root in this folder that tears
 *     down the filter store on exit, preventing the next view from inheriting transient filter mutations.
 *   - Provides IssuesStoreContext (EIssuesStoreType.PROJECT_VIEW) to descendants.
 *   - Forwards issuesFilter.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId, viewId)
 *     to ProjectLevelWorkItemFiltersHOC as updateFilters.
 *   - Wires PROJECT_VIEW_TRACKER_ELEMENTS.HEADER_SAVE_VIEW_BUTTON into WorkItemFiltersRow analytics.
 *   - Filters HOC opts into both enableSaveView (creates a new view) and enableUpdateView (in-place view-definition update).
 *
 * Conditional rendering: returns an empty fragment until all of workspaceSlug, projectId, viewId,
 * and workItemFilters resolve.
 *
 * Layout coverage: list / kanban / calendar / gantt (passes viewId) / spreadsheet.
 */

import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane constants
import { ISSUE_DISPLAY_FILTERS_BY_PAGE, PROJECT_VIEW_TRACKER_ELEMENTS } from "@plane/constants";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
// hooks
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
import { useIssues } from "@/hooks/store/use-issues";
import { useProjectView } from "@/hooks/store/use-project-view";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { ProjectViewCalendarLayout } from "../calendar/roots/project-view-root";
import { BaseGanttRoot } from "../gantt";
import { ProjectViewKanBanLayout } from "../kanban/roots/project-view-root";
import { ProjectViewListLayout } from "../list/roots/project-view-root";
import { ProjectViewSpreadsheetLayout } from "../spreadsheet/roots/project-view-root";

/** Dispatches to the project view's list/kanban/calendar/gantt/spreadsheet layout based on activeLayout; forwards viewId to BaseGanttRoot. */
function ProjectViewIssueLayout(props: { activeLayout: EIssueLayoutTypes | undefined; viewId: string }) {
  switch (props.activeLayout) {
    case EIssueLayoutTypes.LIST:
      return <ProjectViewListLayout />;
    case EIssueLayoutTypes.KANBAN:
      return <ProjectViewKanBanLayout />;
    case EIssueLayoutTypes.CALENDAR:
      return <ProjectViewCalendarLayout />;
    case EIssueLayoutTypes.GANTT:
      return <BaseGanttRoot viewId={props.viewId} />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <ProjectViewSpreadsheetLayout />;
    default:
      return null;
  }
}

export const ProjectViewLayoutRoot = observer(function ProjectViewLayoutRoot() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId, viewId: routerViewId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug?.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId?.toString() : undefined;
  const viewId = routerViewId ? routerViewId?.toString() : undefined;
  // hooks
  const { issuesFilter } = useIssues(EIssuesStoreType.PROJECT_VIEW);
  const { getViewById } = useProjectView();
  // derived values
  const projectView = viewId ? getViewById(viewId) : undefined;
  const workItemFilters = viewId ? issuesFilter?.getIssueFilters(viewId) : undefined;
  const activeLayout = workItemFilters?.displayFilters?.layout;
  const initialWorkItemFilters = projectView
    ? {
        displayFilters: workItemFilters?.displayFilters,
        displayProperties: workItemFilters?.displayProperties,
        kanbanFilters: workItemFilters?.kanbanFilters,
        richFilters: projectView.rich_filters,
      }
    : undefined;

  useSWR(
    workspaceSlug && projectId && viewId ? `PROJECT_VIEW_ISSUES_${workspaceSlug}_${projectId}_${viewId}` : null,
    async () => {
      if (workspaceSlug && projectId && viewId) {
        await issuesFilter?.fetchFilters(workspaceSlug, projectId, viewId);
      }
    }
  );

  useEffect(
    () => () => {
      if (workspaceSlug && viewId) {
        issuesFilter?.resetFilters(workspaceSlug, viewId);
      }
    },
    [issuesFilter, workspaceSlug, viewId]
  );

  if (!workspaceSlug || !projectId || !viewId || !workItemFilters) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.PROJECT_VIEW}>
      <ProjectLevelWorkItemFiltersHOC
        enableSaveView
        saveViewOptions={{
          label: "Save as",
        }}
        enableUpdateView
        entityId={viewId}
        entityType={EIssuesStoreType.PROJECT_VIEW}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters}
        initialWorkItemFilters={initialWorkItemFilters}
        updateFilters={issuesFilter?.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId, viewId)}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: projectViewWorkItemsFilter }) => (
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            {projectViewWorkItemsFilter && (
              <WorkItemFiltersRow
                filter={projectViewWorkItemsFilter}
                trackerElements={{
                  saveView: PROJECT_VIEW_TRACKER_ELEMENTS.HEADER_SAVE_VIEW_BUTTON,
                }}
              />
            )}
            <div className="relative h-full w-full overflow-auto">
              <ProjectViewIssueLayout activeLayout={activeLayout} viewId={viewId.toString()} />
            </div>
            {/* peek overview */}
            <IssuePeekOverview />
          </div>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
