/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-aware layout orchestrator for the archived-issues page of a project — resolves route params, hydrates archived-scoped filters via SWR, and renders ArchivedIssueListLayout inside the project-level filters HOC.
 *
 * Props: none — driven entirely by route params (workspaceSlug, projectId via next/navigation useParams()).
 *
 * MobX stores read:
 *   - useIssues(EIssuesStoreType.ARCHIVED): destructures issuesFilter for getIssueFilters / fetchFilters / updateFilterExpression.
 *
 * Side effects:
 *   - SWR key `ARCHIVED_ISSUES_${workspaceSlug}_${projectId}` → issuesFilter.fetchFilters(workspaceSlug, projectId); revalidateIfStale: false, revalidateOnFocus: false.
 *   - Provides IssuesStoreContext (EIssuesStoreType.ARCHIVED) to descendants so they consume the archived-issues store scope.
 *   - Forwards issuesFilter.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId) to ProjectLevelWorkItemFiltersHOC.updateFilters.
 *
 * Early return: yields <></> until workspaceSlug, projectId, and workItemFilters all resolve — guards the HOC against undefined filter state during initial route hydration.
 *
 * Layout coverage: list only — archived issues do not expose kanban/calendar/gantt/spreadsheet variants.
 *
 * Architectural context (AAP §0.2.2): MobX exclusively (no Redux); store consumed via React context; all API calls flow through MobX store actions (fetchFilters, updateFilterExpression).
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ISSUE_DISPLAY_FILTERS_BY_PAGE } from "@plane/constants";
import { EIssuesStoreType } from "@plane/types";
// components
import { ProjectLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/project-level";
// hooks
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
import { useIssues } from "@/hooks/store/use-issues";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
// local imports
import { IssuePeekOverview } from "../../peek-overview";
import { ArchivedIssueListLayout } from "../list/roots/archived-issue-root";

export const ArchivedIssueLayoutRoot = observer(function ArchivedIssueLayoutRoot() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // hooks
  const { issuesFilter } = useIssues(EIssuesStoreType.ARCHIVED);
  // derived values
  const workItemFilters = projectId ? issuesFilter?.getIssueFilters(projectId) : undefined;

  useSWR(
    workspaceSlug && projectId ? `ARCHIVED_ISSUES_${workspaceSlug.toString()}_${projectId.toString()}` : null,
    async () => {
      if (workspaceSlug && projectId) {
        await issuesFilter?.fetchFilters(workspaceSlug.toString(), projectId.toString());
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  if (!workspaceSlug || !projectId || !workItemFilters) return <></>;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.ARCHIVED}>
      <ProjectLevelWorkItemFiltersHOC
        entityType={EIssuesStoreType.ARCHIVED}
        entityId={projectId?.toString()}
        filtersToShowByLayout={ISSUE_DISPLAY_FILTERS_BY_PAGE.archived_issues.filters}
        initialWorkItemFilters={workItemFilters}
        updateFilters={issuesFilter?.updateFilterExpression.bind(issuesFilter, workspaceSlug, projectId)}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: archivedWorkItemsFilter }) => (
          <>
            {archivedWorkItemsFilter && <WorkItemFiltersRow filter={archivedWorkItemsFilter} />}
            <div className="relative h-full w-full overflow-auto">
              <ArchivedIssueListLayout />
            </div>
            <IssuePeekOverview />
          </>
        )}
      </ProjectLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
