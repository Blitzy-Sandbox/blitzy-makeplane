/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * List-view shell coordinator for every issue list page.
 *
 * Rendered purpose: resolves the active issue store from route context, fetches the initial page of
 * grouped issues, derives permissions, wires quick-action callbacks, manages collapsed-group state, and
 * mounts `<IssueLayoutHOC layout={LIST}>` wrapping the `<List>` viewport. This is the single shared
 * entry point used by every scope-specific list root in `./roots/` (project, cycle, module, archived,
 * profile, project-view).
 *
 * Props (IBaseListRoot):
 *   - QuickActions (FC<IQuickActionProps>, required): the scope-specific quick-action component injected
 *     by the parent root (e.g. `ProjectIssueQuickActions`, `CycleIssueQuickActions`)
 *   - addIssuesToView ((issueIds: string[]) => Promise<any>, optional): callback for adding existing
 *     issues to the current view (used by module/cycle scopes); forwarded to the `List`/header
 *   - canEditPropertiesBasedOnProject ((projectId: string) => boolean, optional): per-project permission
 *     predicate; combined with the workspace-level ADMIN/MEMBER check below
 *   - viewId (string, optional): the active view identifier (cycle id, module id, project-view id,
 *     profile id) used by the store to scope fetches
 *   - isCompletedCycle (boolean, optional, default=false): when true, disables edits and creates
 *   - isEpic (boolean, optional, default=false): switches the row identifier/links/peek to epic semantics
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the current `ListStoreType` from React context (route-aware)
 *   - `useIssues(storeType)` exposes `issuesFilter` (display filters, kanban filters used for collapsed
 *     groups, display properties) and `issues` (groupedIssueIds, viewFlags); plus `useIssues()` (no arg)
 *     returns the global `issueMap`
 *   - `useIssuesActions(storeType)` exposes `fetchIssues`, `fetchNextIssues`, `quickAddIssue`,
 *     `updateIssue`, `removeIssue`, `removeIssueFromView`, `archiveIssue`, `restoreIssue`, `updateFilters`
 *   - `useUserPermissions()` exposes `allowPermissions(roles[], level)` for the ADMIN/MEMBER workspace
 *     project-level edit check
 *
 * Side effects:
 *   - `useEffect` calls `fetchIssues("init-loader", { canGroup: true, perPageCount: group_by ? 50 : 100 }, viewId)`
 *     on mount and whenever `group_by`, `storeType`, or `viewId` changes (initial fetch + grouping reset)
 *   - `useGroupIssuesDragNDrop(storeType, orderBy, group_by)` returns the drag-and-drop drop handler that
 *     mutates issue group membership and ordering via the issue store
 *   - `renderQuickActions` produces a memoised render function that triggers `removeIssue`,
 *     `updateIssue`, `removeIssueFromView`, `archiveIssue`, `restoreIssue` on the issues store when
 *     invoked by quick-action UI
 *   - `loadMoreIssues(groupId?)` triggers `fetchNextIssues(groupId)` for pagination
 *   - `handleCollapsedGroups(value)` patches kanban-style collapsed groups into the filter store via
 *     `updateFilters(projectId, EIssueFilterType.KANBAN_FILTERS, ...)`
 *
 * Consumers (route-scope wrappers in `./roots/`):
 *   - `archived-issue-root.tsx`, `cycle-root.tsx`, `module-root.tsx`, `profile-issues-root.tsx`,
 *     `project-root.tsx`, `project-view-root.tsx`
 */

import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane constants
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// types
import type { EIssuesStoreType, GroupByColumnTypes, TGroupedIssues, TIssueKanbanFilters } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// constants
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// hooks
import { useGroupIssuesDragNDrop } from "@/hooks/use-group-dragndrop";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// components
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { List } from "./default";
// types
import type { IQuickActionProps, TRenderQuickActions } from "./list-view-types";

/**
 * The set of issue store types that the list layout supports. Excludes profile-store types that are
 * NOT exposed via the list shell (the workspace-level draft store is included because the WORKSPACE_DRAFT
 * surface ships its own list layout that reuses this root).
 */
type ListStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.ARCHIVED
  | EIssuesStoreType.WORKSPACE_DRAFT
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

/** Props for `BaseListRoot`. See the module-level JSDoc for full semantics. */
interface IBaseListRoot {
  QuickActions: FC<IQuickActionProps>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}
/** List-view shell coordinator; see the module-level JSDoc for full semantics. */
export const BaseListRoot = observer(function BaseListRoot(props: IBaseListRoot) {
  const {
    QuickActions,
    viewId,
    addIssuesToView,
    canEditPropertiesBasedOnProject,
    isCompletedCycle = false,
    isEpic = false,
  } = props;
  // router
  const storeType = useIssueStoreType() as ListStoreType;
  //stores
  const { issuesFilter, issues } = useIssues(storeType);
  const {
    fetchIssues,
    fetchNextIssues,
    quickAddIssue,
    updateIssue,
    removeIssue,
    removeIssueFromView,
    archiveIssue,
    restoreIssue,
  } = useIssuesActions(storeType);
  // mobx store
  const { allowPermissions } = useUserPermissions();
  const { issueMap } = useIssues();

  const displayFilters = issuesFilter?.issueFilters?.displayFilters;
  const displayProperties = issuesFilter?.issueFilters?.displayProperties;
  const orderBy = displayFilters?.order_by || undefined;

  const group_by = (displayFilters?.group_by || null) as GroupByColumnTypes | null;
  const showEmptyGroup = displayFilters?.show_empty_groups ?? false;

  const { workspaceSlug, projectId } = useParams();
  const { updateFilters } = useIssuesActions(storeType);
  const collapsedGroups =
    issuesFilter?.issueFilters?.kanbanFilters || ({ group_by: [], sub_group_by: [] } as TIssueKanbanFilters);

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: true, perPageCount: group_by ? 50 : 100 }, viewId);
  }, [fetchIssues, storeType, group_by, viewId]);

  const groupedIssueIds = issues?.groupedIssueIds as TGroupedIssues | undefined;
  // auth
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );
  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return !!enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  const handleOnDrop = useGroupIssuesDragNDrop(storeType, orderBy, group_by);

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef }) => (
      <QuickActions
        parentRef={parentRef}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => removeIssueFromView && removeIssueFromView(issue.project_id, issue.id)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        handleRestore={async () => restoreIssue && restoreIssue(issue.project_id, issue.id)}
        readOnly={!canEditProperties(issue.project_id ?? undefined) || isCompletedCycle}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCompletedCycle, canEditProperties, removeIssue, updateIssue, removeIssueFromView, archiveIssue, restoreIssue]
  );

  const loadMoreIssues = useCallback(
    (groupId?: string) => {
      fetchNextIssues(groupId);
    },
    [fetchNextIssues]
  );

  // kanbanFilters and EIssueFilterType.KANBAN_FILTERS are used because the state is shared between kanban view and list view
  const handleCollapsedGroups = useCallback(
    (value: string) => {
      if (workspaceSlug) {
        let collapsedGroups = issuesFilter?.issueFilters?.kanbanFilters?.group_by || [];
        if (collapsedGroups.includes(value)) {
          collapsedGroups = collapsedGroups.filter((_value) => _value != value);
        } else {
          collapsedGroups.push(value);
        }
        updateFilters(projectId?.toString() ?? "", EIssueFilterType.KANBAN_FILTERS, {
          group_by: collapsedGroups,
        } as TIssueKanbanFilters);
      }
    },
    [workspaceSlug, issuesFilter, projectId, updateFilters]
  );

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.LIST}>
      <div className={`relative size-full bg-surface-2`}>
        <List
          issuesMap={issueMap}
          displayProperties={displayProperties}
          group_by={group_by}
          orderBy={orderBy}
          updateIssue={updateIssue}
          quickActions={renderQuickActions}
          groupedIssueIds={groupedIssueIds ?? {}}
          loadMoreIssues={loadMoreIssues}
          showEmptyGroup={showEmptyGroup}
          quickAddCallback={quickAddIssue}
          enableIssueQuickAdd={!!enableQuickAdd}
          canEditProperties={canEditProperties}
          disableIssueCreation={!enableIssueCreation || !isEditingAllowed}
          addIssuesToView={addIssuesToView}
          isCompletedCycle={isCompletedCycle}
          handleOnDrop={handleOnDrop}
          handleCollapsedGroups={handleCollapsedGroups}
          collapsedGroups={collapsedGroups}
          isEpic={isEpic}
        />
      </div>
    </IssueLayoutHOC>
  );
});
