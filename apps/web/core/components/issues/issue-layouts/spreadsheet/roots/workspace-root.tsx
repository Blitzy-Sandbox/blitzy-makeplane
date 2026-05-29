/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace / global-view route adapter for the spreadsheet issue layout.
 *
 * Rendered purpose: hydrates workspace-level issue-property metadata, reads the global issues store
 * keyed by `globalViewId`, wires row-level quick actions (delete / update / archive) into
 * `<AllIssueQuickActions>`, and renders `<SpreadsheetView>` directly inside `<IssueLayoutHOC>`
 * once the loader has resolved. Diverges from every sibling adapter in this folder because workspace
 * stores aggregate issues across projects and key their filter state by `globalViewId` rather than
 * `projectId` — `BaseSpreadsheetRoot` (used by project / cycle / module / project-view roots) is not
 * compatible with that orchestration path.
 *
 * Props (Props — declared at lines 26-38):
 *   - isDefaultView (boolean, required): whether the current global view is the workspace's default
 *     view; preserved on the shared layout-prop contract though not consumed in this body
 *   - isLoading (boolean, optional, default=false): outer loading flag passed by the calling route;
 *     combined with `issuesLoading` + the store loader to decide whether to render the skeleton
 *   - toggleLoading ((value: boolean) => void, required): parent loader toggle; preserved on the
 *     shared contract though not consumed in this body
 *   - workspaceSlug (string, required): active workspace slug from the route; used to scope
 *     `useWorkspaceIssueProperties` hydration, the `updateFilters` call, and the per-project
 *     permission check inside `canEditProperties`
 *   - globalViewId (string, required): the active global view id; gates rendering until present,
 *     namespaces filter state inside the GLOBAL issues filter store, and selects the issue ids to
 *     render
 *   - routeFilters (Record<string, string>, required): URL-derived filters; preserved on the
 *     shared contract though not consumed in this body
 *   - fetchNextPages (() => void, required): pagination callback wired into `<SpreadsheetView>` as
 *     `loadMoreIssues` — invoked by the spreadsheet's intersection observer
 *   - globalViewsLoading (boolean, required): outer global-view-list loader; preserved on the
 *     shared contract though not consumed in this body
 *   - issuesLoading (boolean, required): outer issues loader passed by the calling route; combined
 *     with `isLoading` + `getIssueLoader()` to decide whether to render the skeleton
 *
 * MobX stores read:
 *   - `useWorkspaceIssueProperties(workspaceSlug)` — side-effecting hook that hydrates workspace
 *     issue-property metadata (label/member/state rosters across all projects in the workspace);
 *     no return value is destructured here, the hook drives a fetch on mount
 *   - `useIssues(EIssuesStoreType.GLOBAL)` exposes the `issuesFilter` slice
 *     (`filters`, `updateFilters`) and the `issues` slice (`getIssueLoader`, `getPaginationData`,
 *     `groupedIssueIds`)
 *   - `useIssuesActions(EIssuesStoreType.GLOBAL)` exposes the mutation handlers
 *     (`updateIssue`, `removeIssue`, `archiveIssue`)
 *   - `useUserPermissions()` exposes `allowPermissions(roles, level, workspaceSlug, projectId)` —
 *     used by the memoised `canEditProperties` callback for per-project edit gating
 *
 * Side effects:
 *   - On mount and whenever `workspaceSlug` changes, `useWorkspaceIssueProperties(workspaceSlug)`
 *     fires a workspace-issue-properties hydration request (GET against the workspace's labels /
 *     members / states endpoints).
 *   - `renderQuickActions` (per row) may invoke `removeIssue(project_id, id)`,
 *     `updateIssue(project_id, id, data)`, or `archiveIssue(project_id, id)` — each delegates to
 *     the issue service in `apps/api` (DELETE / PATCH / POST archive).
 *   - `handleDisplayFiltersUpdate` invokes `updateFilters(workspaceSlug, undefined,
 *     EIssueFilterType.DISPLAY_FILTERS, partial, globalViewId)` — persists display-filter changes
 *     into the GLOBAL issues filter store and (through the store) the backend display-filter
 *     endpoint.
 *   - `fetchNextPages()` (passed from the parent route) is invoked by `<SpreadsheetView>` via the
 *     intersection-observer pagination footer.
 *
 * Derived state (the WHY for non-obvious computations):
 *   - `issueFilters = globalViewId ? filters?.[globalViewId.toString()] : undefined` — the workspace
 *     issues-filter store keys filter state by `globalViewId` (not `projectId`) because a workspace
 *     issue view aggregates across projects but persists per global-view.
 *   - The loader gate at line 106 combines THREE conditions: the outer `isLoading && issuesLoading`
 *     flags AND the store's `getIssueLoader() === "init-loader"` state OR a missing `globalViewId`
 *     OR missing `groupedIssueIds`. This compound check ensures the loader stays mounted until the
 *     route, the store, and the data are all simultaneously ready.
 *   - `groupedIssueIds[ALL_ISSUES]` — the global view is ungrouped (always keyed under
 *     `ALL_ISSUES`); `Array.isArray(issueIds) ? issueIds : []` defensively coerces in case the
 *     store returns a grouped shape unexpectedly.
 *   - `canEditProperties(projectId)` early-returns `false` when `projectId` is undefined — relevant
 *     because workspace views can include cross-project issues where a row's `project_id` may not
 *     resolve before the membership data is hydrated.
 *
 * Consumers:
 *   - `apps/web/app/(workspace-projects)/.../workspace-views/[globalViewId]/page.tsx`
 *     (workspace-view spreadsheet page; the workspace-views route mounts this directly with the
 *     hydrated route props above)
 */

import React, { useCallback } from "react";
import { observer } from "mobx-react";
// plane constants
import { ALL_ISSUES, EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { IIssueDisplayFilterOptions } from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
// components
import { AllIssueQuickActions } from "@/components/issues/issue-layouts/quick-action-dropdowns";
import { SpreadsheetLayoutLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
// store
import { IssueLayoutHOC } from "../../issue-layout-HOC";
import type { TRenderQuickActions } from "../../list/list-view-types";
import { SpreadsheetView } from "../spreadsheet-view";

/** Props for `WorkspaceSpreadsheetRoot`. */
type Props = {
  isDefaultView: boolean;
  isLoading?: boolean;
  toggleLoading: (value: boolean) => void;
  workspaceSlug: string;
  globalViewId: string;
  routeFilters: {
    [key: string]: string;
  };
  fetchNextPages: () => void;
  globalViewsLoading: boolean;
  issuesLoading: boolean;
};

/** Workspace / global-view spreadsheet route adapter; see the module-level JSDoc for full semantics. */
export const WorkspaceSpreadsheetRoot = observer(function WorkspaceSpreadsheetRoot(props: Props) {
  const { isLoading = false, workspaceSlug, globalViewId, fetchNextPages, issuesLoading } = props;

  // Custom hooks
  useWorkspaceIssueProperties(workspaceSlug);

  // Store hooks
  const {
    issuesFilter: { filters, updateFilters },
    issues: { getIssueLoader, getPaginationData, groupedIssueIds },
  } = useIssues(EIssuesStoreType.GLOBAL);
  const { updateIssue, removeIssue, archiveIssue } = useIssuesActions(EIssuesStoreType.GLOBAL);
  const { allowPermissions } = useUserPermissions();

  // Derived values
  const issueFilters = globalViewId ? filters?.[globalViewId.toString()] : undefined;

  // Permission checker
  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      if (!projectId) return false;
      return allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug.toString(),
        projectId
      );
    },
    [allowPermissions, workspaceSlug]
  );

  // Display filters handler
  const handleDisplayFiltersUpdate = useCallback(
    (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
      if (!workspaceSlug || !globalViewId) return;

      updateFilters(
        workspaceSlug.toString(),
        undefined,
        EIssueFilterType.DISPLAY_FILTERS,
        { ...updatedDisplayFilter },
        globalViewId.toString()
      );
    },
    [updateFilters, workspaceSlug, globalViewId]
  );

  // Quick actions renderer
  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton, placement, portalElement }) => (
      <AllIssueQuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        portalElement={portalElement}
        readOnly={!canEditProperties(issue.project_id ?? undefined)}
        placements={placement}
      />
    ),
    [canEditProperties, removeIssue, updateIssue, archiveIssue]
  );

  // Loading state
  if ((isLoading && issuesLoading && getIssueLoader() === "init-loader") || !globalViewId || !groupedIssueIds) {
    return <SpreadsheetLayoutLoader />;
  }

  // Computed values
  const issueIds = groupedIssueIds[ALL_ISSUES];
  const nextPageResults = getPaginationData(ALL_ISSUES, undefined)?.nextPageResults;

  // Render spreadsheet
  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.SPREADSHEET}>
      <SpreadsheetView
        displayProperties={issueFilters?.displayProperties ?? {}}
        displayFilters={issueFilters?.displayFilters ?? {}}
        handleDisplayFilterUpdate={handleDisplayFiltersUpdate}
        issueIds={Array.isArray(issueIds) ? issueIds : []}
        quickActions={renderQuickActions}
        updateIssue={updateIssue}
        canEditProperties={canEditProperties}
        canLoadMoreIssues={!!nextPageResults}
        loadMoreIssues={fetchNextPages}
        isWorkspaceLevel
      />
    </IssueLayoutHOC>
  );
});
