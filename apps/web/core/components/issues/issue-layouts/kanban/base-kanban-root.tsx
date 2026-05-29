/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestrator for the Kanban issue layout.
 *
 * Rendered purpose: resolves the active issues-store context from the URL, fetches grouped issues,
 * wires permission-gated edit/quick-action callbacks, manages the global drag-to-delete drop zone,
 * persists collapsed group state via the kanban filters, and renders either the flat KanBan board
 * (`./default`) or the swimlane variant (`./swimlanes`) based on whether `sub_group_by` is active.
 *
 * Props (`IBaseKanBanLayout`):
 *   - QuickActions (FC<IQuickActionProps>, required): scope-specific quick-action menu component
 *     supplied by the route-aware root in `./roots/` (project, cycle, module, profile, view, team).
 *   - addIssuesToView (issueIds => Promise<any>, optional): mutation invoked when existing issues
 *     are attached to the current scope from the column header (cycles, modules, project views).
 *   - canEditPropertiesBasedOnProject ((projectId) => boolean, optional): per-project edit gate
 *     used for workspace-level boards where individual issues span multiple projects.
 *   - isCompletedCycle (boolean, optional, default=false): when true, disables inline edits, quick
 *     adds, and quick-action mutations because completed cycles are immutable.
 *   - viewId (string | undefined, optional): the cycle/module/view id used for fetch + paginate
 *     scoping; propagated to `fetchIssues` and `fetchNextIssues`.
 *   - isEpic (boolean, optional, default=false): swaps the issue service from ISSUES to EPICS for
 *     `useIssueDetail` and feeds through to the inner board for epic-specific behavior.
 *
 * MobX stores read (via React-context hooks):
 *   - `useIssueStoreType()` resolves the active `EIssuesStoreType` from the URL.
 *   - `useIssues(storeType)` exposes `issueMap`, `issuesFilter`, and `issues` (grouped IDs, loader,
 *     pagination).
 *   - `useIssueDetail(EPICS | ISSUES)` exposes `issue.getIssueById` for resolving the dragged
 *     issue before opening the delete-confirmation modal.
 *   - `useUserPermissions()` exposes `allowPermissions` for ADMIN/MEMBER project-level edit gating.
 *   - `useKanbanView()` exposes `isDragging` driving the visibility of the global delete drop zone.
 *   - `useIssuesActions(storeType)` exposes scope-bound mutators (`fetchIssues`, `fetchNextIssues`,
 *     `quickAddIssue`, `updateIssue`, `removeIssue`, `removeIssueFromView`, `archiveIssue`,
 *     `restoreIssue`, `updateFilters`).
 *
 * Side effects:
 *   - Calls `fetchIssues("init-loader", { canGroup: true, perPageCount })` on mount and whenever
 *     `storeType`, `group_by`, `sub_group_by`, or `viewId` change. `perPageCount` is 10 when
 *     `sub_group_by` is active (smaller pages for the nested layout) and 30 otherwise — a tuned
 *     trade-off between initial payload size and column scroll density.
 *   - Registers a Pragmatic DnD `dropTargetForElements` on the delete drop zone via a `useEffect`
 *     that sets local `isDragOverDelete` / `draggedIssueId` state and opens `DeleteIssueModal`.
 *     This is the only drop target registered directly in this file; column-level drop targets
 *     live in `./kanban-group.tsx`.
 *   - Registers Pragmatic DnD `autoScrollForElements` on the scrollable container so the board
 *     auto-scrolls during drag.
 *   - `handleOnDrop` (from `useGroupIssuesDragNDrop`) ultimately invokes the shared
 *     `handleGroupDragDrop` utility in `../utils.tsx` which calls `updateIssue` to persist the move.
 *   - `handleDeleteIssue` calls the store `removeIssue` mutator (DELETE API call via
 *     `apps/web/core/services/issue/*.service.ts`).
 *   - `handleCollapsedGroups` calls `updateFilters` with `EIssueFilterType.KANBAN_FILTERS` to
 *     persist the collapsed-group lists.
 *   - `renderQuickActions` produces quick-action handlers that close over store mutators
 *     (`removeIssue`, `updateIssue`, `removeIssueFromView`, `archiveIssue`, `restoreIssue`); the
 *     `&&` short-circuits exist because the latter four mutators are declared optional on
 *     `IssueActions` and therefore may be undefined for stores that do not implement them.
 *
 * Layout switching:
 *   - `KanBanView = sub_group_by ? KanBanSwimLanes : KanBan` — the choice of board shell is purely
 *     a function of whether the user has activated a sub-group-by display filter. The inner board
 *     is wrapped in `<IssueLayoutHOC layout={EIssueLayoutTypes.KANBAN}>` from `../issue-layout-HOC`
 *     which handles loader and empty-state gating.
 *
 * Consumers: every route-aware root in `./roots/` (`project-root`, `cycle-root`, `module-root`,
 * `profile-issues-root`, `project-view-root`) plus team/epic roots from the plane-web overlay.
 */
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { EIssuesStoreType } from "@plane/types";
import { EIssueServiceType, EIssueLayoutTypes } from "@plane/types";
//hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useKanbanView } from "@/hooks/store/use-kanban-view";
import { useUserPermissions } from "@/hooks/store/user";
import { useGroupIssuesDragNDrop } from "@/hooks/use-group-dragndrop";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// store
// ui
// types
import { DeleteIssueModal } from "../../delete-issue-modal";
import { IssueLayoutHOC } from "../issue-layout-HOC";
import type { IQuickActionProps, TRenderQuickActions } from "../list/list-view-types";
//components
import { getSourceFromDropPayload } from "../utils";
import { KanBan } from "./default";
import { KanBanSwimLanes } from "./swimlanes";

/**
 * The set of `EIssuesStoreType` values that are valid for the Kanban layout.
 *
 * Restricted to scopes that expose a grouped-issues board: project, module, cycle, project view,
 * profile, team, team view, and epic. Workspace-level all-issues views (Global, Workspace Draft,
 * Archived) are intentionally excluded because they ship a list-only experience.
 */
export type KanbanStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

/** Props for `BaseKanBanRoot`; see the module-level JSDoc for full per-prop semantics. */
export interface IBaseKanBanLayout {
  QuickActions: FC<IQuickActionProps>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  isCompletedCycle?: boolean;
  viewId?: string | undefined;
  isEpic?: boolean;
}

/** Top-level orchestrator for the Kanban issue layout; see the module-level JSDoc for full semantics. */
export const BaseKanBanRoot = observer(function BaseKanBanRoot(props: IBaseKanBanLayout) {
  const {
    QuickActions,
    addIssuesToView,
    canEditPropertiesBasedOnProject,
    isCompletedCycle = false,
    viewId,
    isEpic = false,
  } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const storeType = useIssueStoreType() as KanbanStoreType;
  const { allowPermissions } = useUserPermissions();
  const { issueMap, issuesFilter, issues } = useIssues(storeType);
  const {
    issue: { getIssueById },
  } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
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

  const deleteAreaRef = useRef<HTMLDivElement | null>(null);
  const [isDragOverDelete, setIsDragOverDelete] = useState(false);

  const { isDragging } = useKanbanView();

  const displayFilters = issuesFilter?.issueFilters?.displayFilters;
  const displayProperties = issuesFilter?.issueFilters?.displayProperties;

  const sub_group_by = displayFilters?.sub_group_by;
  const group_by = displayFilters?.group_by;

  const orderBy = displayFilters?.order_by;

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: true, perPageCount: sub_group_by ? 10 : 30 }, viewId);
  }, [fetchIssues, storeType, group_by, sub_group_by, viewId]);

  const fetchMoreIssues = useCallback(
    (groupId?: string, subgroupId?: string) => {
      if (issues?.getIssueLoader(groupId, subgroupId) !== "pagination") {
        fetchNextIssues(groupId, subgroupId);
      }
    },
    [fetchNextIssues]
  );

  const groupedIssueIds = issues?.groupedIssueIds;

  const userDisplayFilters = displayFilters || null;

  const KanBanView = sub_group_by ? KanBanSwimLanes : KanBan;

  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};

  const scrollableContainerRef = useRef<HTMLDivElement | null>(null);

  // states
  const [draggedIssueId, setDraggedIssueId] = useState<string | undefined>(undefined);
  const [deleteIssueModal, setDeleteIssueModal] = useState(false);

  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const handleOnDrop = useGroupIssuesDragNDrop(storeType, orderBy, group_by, sub_group_by);

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  // Enable Auto Scroll for Main Kanban
  useEffect(() => {
    const element = scrollableContainerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, []);

  // Make the Issue Delete Box a Drop Target
  useEffect(() => {
    const element = deleteAreaRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ columnId: "issue-trash-box", groupId: "issue-trash-box", type: "DELETE" }),
        onDragEnter: () => {
          setIsDragOverDelete(true);
        },
        onDragLeave: () => {
          setIsDragOverDelete(false);
        },
        onDrop: (payload) => {
          setIsDragOverDelete(false);
          const source = getSourceFromDropPayload(payload);

          if (!source) return;

          setDraggedIssueId(source.id);
          setDeleteIssueModal(true);
        },
      })
    );
  }, [setIsDragOverDelete, setDraggedIssueId, setDeleteIssueModal]);

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton }) => (
      <QuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
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

  const handleDeleteIssue = async () => {
    const draggedIssue = getIssueById(draggedIssueId ?? "");

    if (!draggedIssueId || !draggedIssue) return;

    try {
      await removeIssue(draggedIssue.project_id, draggedIssueId);
      setDeleteIssueModal(false);
      setDraggedIssueId(undefined);
    } catch (_error) {
      setDeleteIssueModal(false);
      setDraggedIssueId(undefined);
    }
  };

  const handleCollapsedGroups = useCallback(
    (toggle: "group_by" | "sub_group_by", value: string) => {
      if (workspaceSlug) {
        let collapsedGroups = issuesFilter?.issueFilters?.kanbanFilters?.[toggle] || [];
        if (collapsedGroups.includes(value)) {
          collapsedGroups = collapsedGroups.filter((_value) => _value != value);
        } else {
          collapsedGroups.push(value);
        }
        updateFilters(projectId?.toString() ?? "", EIssueFilterType.KANBAN_FILTERS, {
          [toggle]: collapsedGroups,
        });
      }
    },
    [workspaceSlug, issuesFilter, projectId, updateFilters]
  );

  const collapsedGroups = issuesFilter?.issueFilters?.kanbanFilters || { group_by: [], sub_group_by: [] };

  return (
    <>
      <DeleteIssueModal
        dataId={draggedIssueId}
        isOpen={deleteIssueModal}
        handleClose={() => setDeleteIssueModal(false)}
        onSubmit={handleDeleteIssue}
        isEpic={isEpic}
      />
      {/* drag and delete component */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 ${
          isDragging ? "z-40" : ""
        } top-3 mx-3 flex w-72 items-center justify-center`}
        ref={deleteAreaRef}
      >
        <div
          className={`${
            isDragging ? `opacity-100` : `opacity-0`
          } flex w-full items-center justify-center rounded-sm border-2 border-danger-strong/20 bg-surface-1 px-3 py-5 text-11 font-medium text-danger-primary italic ${
            isDragOverDelete ? "bg-danger-primary blur-2xl" : ""
          } transition duration-300`}
        >
          Drop here to delete the work item.
        </div>
      </div>
      <IssueLayoutHOC layout={EIssueLayoutTypes.KANBAN}>
        <div
          className={`horizontal-scrollbar relative flex scrollbar-lg h-full w-full bg-surface-2 ${sub_group_by ? "vertical-scrollbar overflow-y-auto" : "overflow-x-auto overflow-y-hidden"}`}
          ref={scrollableContainerRef}
        >
          <div className="relative h-full w-max min-w-full bg-surface-2">
            <div className="h-full w-max">
              <KanBanView
                issuesMap={issueMap}
                groupedIssueIds={groupedIssueIds ?? {}}
                getGroupIssueCount={issues.getGroupIssueCount}
                displayProperties={displayProperties}
                sub_group_by={sub_group_by}
                group_by={group_by}
                orderBy={orderBy}
                updateIssue={updateIssue}
                quickActions={renderQuickActions}
                handleCollapsedGroups={handleCollapsedGroups}
                collapsedGroups={collapsedGroups}
                enableQuickIssueCreate={enableQuickAdd}
                showEmptyGroup={userDisplayFilters?.show_empty_groups ?? true}
                quickAddCallback={quickAddIssue}
                disableIssueCreation={!enableIssueCreation || !isEditingAllowed || isCompletedCycle}
                canEditProperties={canEditProperties}
                addIssuesToView={addIssuesToView}
                scrollableContainerRef={scrollableContainerRef}
                handleOnDrop={handleOnDrop}
                loadMoreIssues={fetchMoreIssues}
                isEpic={isEpic}
              />
            </div>
          </div>
        </div>
      </IssueLayoutHOC>
    </>
  );
});
