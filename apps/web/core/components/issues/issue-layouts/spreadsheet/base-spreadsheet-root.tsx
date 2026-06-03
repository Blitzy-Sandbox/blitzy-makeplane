/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central controller for spreadsheet-layout issue views (non-workspace contexts).
 *
 * Rendered purpose: orchestrates a spreadsheet-style issue table for project, module, cycle,
 * project-view, team, team-view, and epic stores. It resolves the active issue-store type from
 * route context, fetches the first page of issues, wires quick-action handlers, gates editability
 * by user role + project flags, and synchronises display-filter changes back into the active store
 * before rendering `<SpreadsheetView>` inside `<IssueLayoutHOC>`.
 *
 * Props (IBaseSpreadsheetRoot):
 *   - QuickActions (FC<IQuickActionProps>, required): the per-row quick-action menu component to
 *     render against each issue row (varies by context — project / cycle / module / view / global)
 *   - canEditPropertiesBasedOnProject ((projectId: string) => boolean, optional): callback that
 *     scopes property editability per-project; used by workspace / multi-project contexts
 *   - isCompletedCycle (boolean, optional, default=false): when true, disables row quick actions
 *     and inline editing (completed cycles are read-only)
 *   - viewId (string, optional): the active view identifier; forwarded into `fetchIssues` so the
 *     store paginates within the correct view
 *   - isEpic (boolean, optional, default=false): when true, switches the layout into epic mode
 *     (label/copy and quick-action set adjust accordingly)
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the current `EIssuesStoreType` from React context
 *   - `useUserPermissions()` exposes `allowPermissions(roles, level)` for role-based gating
 *   - `useIssues(storeType)` exposes the `issues` slice (groupedIssueIds, getPaginationData,
 *     viewFlags) and the `issuesFilter` slice (issueFilters.displayProperties, displayFilters)
 *   - `useIssuesActions(storeType)` exposes the mutator action set (fetchIssues, fetchNextIssues,
 *     quickAddIssue, updateIssue, removeIssue, removeIssueFromView, archiveIssue, restoreIssue,
 *     updateFilters)
 *
 * Side effects:
 *   - On mount and whenever `storeType` or `viewId` changes, calls `fetchIssues("init-loader",
 *     { canGroup: false, perPageCount: 100 }, viewId)` — paginates the first 100 issues without grouping.
 *   - `renderQuickActions` invokes `removeIssue`, `updateIssue`, `removeIssueFromView`, `archiveIssue`,
 *     or `restoreIssue` from the issues-actions hook (each ultimately makes API calls into `apps/api`).
 *   - `handleDisplayFiltersUpdate` invokes `updateFilters(projectId, DISPLAY_FILTERS, ...)` to persist
 *     filter changes back into the store (and through to the backend display-filter endpoint).
 *
 * Derived state:
 *   - `isEditingAllowed` — admin/member at project level
 *   - `canEditProperties(projectId)` — true only when `enableInlineEditing` is set AND either the
 *     per-project predicate (when supplied) or `isEditingAllowed` is true
 *   - `issueIds` — `groupedIssueIds[ALL_ISSUES]` (the layout is intentionally ungrouped)
 *   - `nextPageResults` — derived from pagination metadata; gates the "Load more" UI in the table
 *
 * Consumers:
 *   - `./roots/project-root.tsx`, `./roots/cycle-root.tsx`, `./roots/module-root.tsx`,
 *     `./roots/project-view-root.tsx` — all instantiate this component with their context-specific
 *     `QuickActions` and (for cycle) `isCompletedCycle` + `canEditPropertiesBasedOnProject`.
 */

import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { EIssuesStoreType, IIssueDisplayFilterOptions } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// local imports
import { IssueLayoutHOC } from "../issue-layout-HOC";
import type { IQuickActionProps, TRenderQuickActions } from "../list/list-view-types";
import { SpreadsheetView } from "./spreadsheet-view";

/**
 * Subset of `EIssuesStoreType` that this base controller supports.
 *
 * Excludes WORKSPACE / GLOBAL / PROFILE store types because the workspace spreadsheet root
 * (`./roots/workspace-root.tsx`) uses a different orchestration path that hydrates workspace-level
 * issue properties and member rosters before delegating to `SpreadsheetView` directly.
 */
export type SpreadsheetStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

/** Props for `BaseSpreadsheetRoot`. */
interface IBaseSpreadsheetRoot {
  QuickActions: FC<IQuickActionProps>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  isCompletedCycle?: boolean;
  viewId?: string | undefined;
  isEpic?: boolean;
}

/** Spreadsheet-layout controller; see the module-level JSDoc for full semantics. */
export const BaseSpreadsheetRoot = observer(function BaseSpreadsheetRoot(props: IBaseSpreadsheetRoot) {
  const { QuickActions, canEditPropertiesBasedOnProject, isCompletedCycle = false, viewId, isEpic = false } = props;
  // router
  const { projectId } = useParams();
  // store hooks
  const storeType = useIssueStoreType() as SpreadsheetStoreType;
  const { allowPermissions } = useUserPermissions();
  const { issues, issuesFilter } = useIssues(storeType);
  const {
    fetchIssues,
    fetchNextIssues,
    quickAddIssue,
    updateIssue,
    removeIssue,
    removeIssueFromView,
    archiveIssue,
    restoreIssue,
    updateFilters,
  } = useIssuesActions(storeType);
  // derived values
  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};
  // user role validation
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  const issueIds = issues.groupedIssueIds?.[ALL_ISSUES] ?? [];
  const nextPageResults = issues.getPaginationData(ALL_ISSUES, undefined)?.nextPageResults;

  const handleDisplayFiltersUpdate = useCallback(
    (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
      updateFilters(projectId?.toString() ?? "", EIssueFilterType.DISPLAY_FILTERS, {
        ...updatedDisplayFilter,
      });
    },
    [projectId, updateFilters]
  );

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton, placement, portalElement }) => (
      <QuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => removeIssueFromView && removeIssueFromView(issue.project_id, issue.id)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        handleRestore={async () => restoreIssue && restoreIssue(issue.project_id, issue.id)}
        portalElement={portalElement}
        readOnly={!canEditProperties(issue.project_id ?? undefined) || isCompletedCycle}
        placements={placement}
      />
    ),
    [isCompletedCycle, canEditProperties, removeIssue, updateIssue, removeIssueFromView, archiveIssue, restoreIssue]
  );

  if (!Array.isArray(issueIds)) return null;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.SPREADSHEET}>
      <SpreadsheetView
        displayProperties={issuesFilter.issueFilters?.displayProperties ?? {}}
        displayFilters={issuesFilter.issueFilters?.displayFilters ?? {}}
        handleDisplayFilterUpdate={handleDisplayFiltersUpdate}
        issueIds={issueIds}
        quickActions={renderQuickActions}
        updateIssue={updateIssue}
        canEditProperties={canEditProperties}
        quickAddCallback={quickAddIssue}
        enableQuickCreateIssue={enableQuickAdd}
        disableIssueCreation={!enableIssueCreation || !isEditingAllowed || isCompletedCycle}
        canLoadMoreIssues={!!nextPageResults}
        loadMoreIssues={fetchNextIssues}
        isEpic={isEpic}
      />
    </IssueLayoutHOC>
  );
});
