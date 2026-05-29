/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-aware layout orchestrator for the module-scoped issues page: resolves workspaceSlug, projectId, and moduleId
 * from the route, hydrates module-scoped filters via SWR, and dispatches to one of the module layout variants
 * (list / kanban / calendar / gantt / spreadsheet) wrapped in a scrollable Row container.
 *
 * Props: none — driven entirely by route params (workspaceSlug, projectId, moduleId via next/navigation useParams()).
 *
 * MobX stores read:
 *   - useIssues(EIssuesStoreType.MODULE): destructures `issuesFilter` for getIssueFilters / fetchFilters / updateFilterExpression.
 *
 * Side effects:
 *   - SWR key `MODULE_ISSUES_${workspaceSlug}_${projectId}_${moduleId}` → issuesFilter.fetchFilters(workspaceSlug, projectId, moduleId);
 *     SWR options { revalidateIfStale: false, revalidateOnFocus: false }.
 *   - Provides IssuesStoreContext.Provider value={EIssuesStoreType.MODULE} to descendants.
 *   - Forwards `issuesFilter.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId, moduleId)` to
 *     ProjectLevelWorkItemFiltersHOC as its `updateFilters` callback.
 *
 * Conditional rendering:
 *   - Returns an empty fragment when any of workspaceSlug, projectId, moduleId, or workItemFilters is unresolved.
 *
 * Layout coverage: list / kanban / calendar / gantt (passes viewId=moduleId to BaseGanttRoot) / spreadsheet.
 *
 * Architecture: MobX exclusively (no Redux); store consumed via React context. All API calls flow through MobX
 * store actions (fetchFilters, updateFilterExpression).
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ISSUE_DISPLAY_FILTERS_BY_PAGE, PROJECT_VIEW_TRACKER_ELEMENTS } from "@plane/constants";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
import { Row, ERowVariant } from "@plane/ui";
// hooks
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
import { useIssues } from "@/hooks/store/use-issues";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { ModuleCalendarLayout } from "../calendar/roots/module-root";
import { BaseGanttRoot } from "../gantt";
import { ModuleKanBanLayout } from "../kanban/roots/module-root";
import { ModuleListLayout } from "../list/roots/module-root";
import { ModuleSpreadsheetLayout } from "../spreadsheet/roots/module-root";

/** Dispatches to the module's list/kanban/calendar/gantt/spreadsheet layout based on activeLayout; forwards moduleId to BaseGanttRoot as viewId. */
function ModuleIssueLayout(props: { activeLayout: EIssueLayoutTypes | undefined; moduleId: string }) {
  switch (props.activeLayout) {
    case EIssueLayoutTypes.LIST:
      return <ModuleListLayout />;
    case EIssueLayoutTypes.KANBAN:
      return <ModuleKanBanLayout />;
    case EIssueLayoutTypes.CALENDAR:
      return <ModuleCalendarLayout />;
    case EIssueLayoutTypes.GANTT:
      return <BaseGanttRoot viewId={props.moduleId} />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <ModuleSpreadsheetLayout />;
    default:
      return null;
  }
}

export const ModuleLayoutRoot = observer(function ModuleLayoutRoot() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId, moduleId: routerModuleId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  const moduleId = routerModuleId ? routerModuleId.toString() : undefined;
  // hooks
  const { issuesFilter } = useIssues(EIssuesStoreType.MODULE);
  // derived values
  const workItemFilters = moduleId ? issuesFilter?.getIssueFilters(moduleId) : undefined;
  const activeLayout = workItemFilters?.displayFilters?.layout || undefined;

  useSWR(
    workspaceSlug && projectId && moduleId
      ? `MODULE_ISSUES_${workspaceSlug.toString()}_${projectId.toString()}_${moduleId.toString()}`
      : null,
    async () => {
      if (workspaceSlug && projectId && moduleId) {
        await issuesFilter?.fetchFilters(workspaceSlug.toString(), projectId.toString(), moduleId.toString());
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  if (!workspaceSlug || !projectId || !moduleId || !workItemFilters) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.MODULE}>
      <ProjectLevelWorkItemFiltersHOC
        enableSaveView
        entityType={EIssuesStoreType.MODULE}
        entityId={moduleId}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters}
        initialWorkItemFilters={workItemFilters}
        updateFilters={issuesFilter?.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId, moduleId)}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: moduleWorkItemsFilter }) => (
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            {moduleWorkItemsFilter && (
              <WorkItemFiltersRow
                filter={moduleWorkItemsFilter}
                trackerElements={{
                  saveView: PROJECT_VIEW_TRACKER_ELEMENTS.MODULE_HEADER_SAVE_AS_VIEW_BUTTON,
                }}
              />
            )}
            <Row variant={ERowVariant.HUGGING} className="h-full w-full overflow-auto">
              <ModuleIssueLayout activeLayout={activeLayout} moduleId={moduleId} />
            </Row>
            {/* peek overview */}
            <IssuePeekOverview />
          </div>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
