/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-aware shell that wires a calendar issue layout to its MobX issue store
 * stack and forwards drag/drop, pagination, quick-add, and edit-permission
 * concerns down to the presentational {@link CalendarChart}.
 *
 * State slice read:
 *   - issues, issuesFilter, issueMap from useIssues(storeType) — keyed by the
 *     resolved CalendarStoreType (PROJECT | MODULE | CYCLE | PROJECT_VIEW |
 *     TEAM | TEAM_VIEW | EPIC). When isEpic is true, storeType is overridden
 *     to EIssuesStoreType.EPIC, otherwise it falls back to the layout-context
 *     value from useIssueStoreType().
 *   - calendar window (startDate, endDate, layout) from useCalendarView().
 *   - allowPermissions from useUserPermissions() for the workspace-level
 *     editing gate at EUserPermissionsLevel.PROJECT.
 *
 * Actions invoked (all sourced from useIssuesActions(storeType)):
 *   - fetchIssues / fetchNextIssues — initial + pagination data load, scoped
 *     by start/end dates and grouped by target_date so each calendar cell
 *     receives its own bucket of issue IDs.
 *   - quickAddIssue, updateIssue, removeIssue, removeIssueFromView,
 *     archiveIssue, restoreIssue, updateFilters — surfaced through the
 *     QuickActions render prop and the calendar-level handlers.
 *   - handleDragDrop (./utils) — persistence path for drag-to-reschedule;
 *     mutates target_date via updateIssue.
 *
 * Side effects:
 *   - useEffect on [storeType, startDate, endDate, layout, viewId] issues an
 *     "init-loader" fetchIssues call with month layout = 4 items/page and
 *     week layout = 30 items/page (intentional asymmetry: month surfaces a
 *     summary per cell, week shows the long tail).
 *   - Drag/drop failures emit an ERROR toast via @plane/propel/toast; success
 *     path relies on store mutations from updateIssue to refresh the UI.
 *
 * Permission resolution:
 *   - canEditProperties(projectId) combines issues.viewFlags.enableInlineEditing
 *     with either the workspace-level allowPermissions check OR the optional
 *     per-project canEditPropertiesBasedOnProject override (used by
 *     project-root.tsx when the user has heterogeneous rights across projects).
 *   - readOnly={isCompletedCycle} additionally freezes editing for completed
 *     cycles regardless of permission state.
 *
 * Consumers:
 *   - ./roots/project-root.tsx, ./roots/module-root.tsx,
 *     ./roots/cycle-root.tsx, ./roots/project-view-root.tsx
 *   - Internally renders ./calendar.tsx (CalendarChart).
 */

import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssueGroupByToServerOptions, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TGroupedIssues } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useCalendarView } from "@/hooks/store/use-calendar-view";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// types
import type { IQuickActionProps } from "../list/list-view-types";
import { CalendarChart } from "./calendar";
import { handleDragDrop } from "./utils";

/**
 * Discriminant union of the issue stores that a calendar layout can bind to.
 * Resolved at runtime via useIssueStoreType() — with an EPIC override when the
 * isEpic prop is true — and then passed to useIssues / useIssuesActions.
 */
export type CalendarStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

/**
 * Props injected by route-scoped wrappers in ./roots/* to bind this shared
 * shell to a specific calendar context (project, module, cycle, view, or epic).
 *
 * @property QuickActions Route-specific quick-action renderer (e.g.
 *   ProjectIssueQuickActions / ModuleIssueQuickActions / CycleIssueQuickActions).
 * @property addIssuesToView Optional add-to-view callback supplied by
 *   module-root.tsx and cycle-root.tsx; absent for raw project roots.
 * @property isCompletedCycle When true, the entire calendar is rendered
 *   read-only (forwarded as readOnly to CalendarChart). Defaults to false.
 * @property viewId Optional fetch context (cycle/module/view id) used as the
 *   third argument to fetchIssues; undefined for plain project boards.
 * @property isEpic When true, swaps storeType to EIssuesStoreType.EPIC so
 *   useIssues / useIssuesActions resolve the epic store stack. Defaults to false.
 * @property canEditPropertiesBasedOnProject Optional per-project edit gate
 *   that overrides the workspace-level allowPermissions result; used by
 *   project-root.tsx where the user may have heterogeneous rights across projects.
 */
interface IBaseCalendarRoot {
  QuickActions: FC<IQuickActionProps>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  isCompletedCycle?: boolean;
  viewId?: string | undefined;
  isEpic?: boolean;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
}

/**
 * Resolves the active issue store from layout context (with EPIC override),
 * fetches the visible date window, and renders {@link CalendarChart} with
 * permission-aware drag/drop, pagination, and quick-action handlers.
 */
export const BaseCalendarRoot = observer(function BaseCalendarRoot(props: IBaseCalendarRoot) {
  const {
    QuickActions,
    addIssuesToView,
    isCompletedCycle = false,
    viewId,
    isEpic = false,
    canEditPropertiesBasedOnProject,
  } = props;

  // router
  const { workspaceSlug } = useParams();

  // hooks
  const fallbackStoreType = useIssueStoreType() as CalendarStoreType;
  const storeType = isEpic ? EIssuesStoreType.EPIC : fallbackStoreType;
  const { allowPermissions } = useUserPermissions();
  const { issues, issuesFilter, issueMap } = useIssues(storeType);
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

  const issueCalendarView = useCalendarView();

  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const { enableInlineEditing } = issues?.viewFlags || {};

  const displayFilters = issuesFilter.issueFilters?.displayFilters;

  const groupedIssueIds = (issues.groupedIssueIds ?? {}) as TGroupedIssues;

  const layout = displayFilters?.calendar?.layout ?? "month";
  const { startDate, endDate } = issueCalendarView.getStartAndEndDate(layout) ?? {};

  useEffect(() => {
    if (startDate && endDate && layout) {
      fetchIssues(
        "init-loader",
        {
          canGroup: true,
          perPageCount: layout === "month" ? 4 : 30,
          before: endDate,
          after: startDate,
          groupedBy: EIssueGroupByToServerOptions["target_date"],
        },
        viewId
      );
    }
  }, [fetchIssues, storeType, startDate, endDate, layout, viewId]);

  const handleDragAndDrop = async (
    issueId: string | undefined,
    issueProjectId: string | undefined,
    sourceDate: string | undefined,
    destinationDate: string | undefined
  ) => {
    if (!issueId || !destinationDate || !sourceDate || !issueProjectId) return;

    await handleDragDrop(
      issueId,
      sourceDate,
      destinationDate,
      workspaceSlug?.toString(),
      issueProjectId,
      updateIssue
    ).catch((err) => {
      setToast({
        title: "Error!",
        type: TOAST_TYPE.ERROR,
        message: err?.detail ?? "Failed to perform this action",
      });
    });
  };

  const loadMoreIssues = useCallback(
    (dateString: string) => {
      fetchNextIssues(dateString);
    },
    [fetchNextIssues]
  );

  const getPaginationData = useCallback(
    (groupId: string | undefined) => issues?.getPaginationData(groupId, undefined),
    [issues?.getPaginationData]
  );

  const getGroupIssueCount = useCallback(
    (groupId: string | undefined) => issues?.getGroupIssueCount(groupId, undefined, false),
    [issues?.getGroupIssueCount]
  );

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  return (
    <>
      <div className="h-full w-full overflow-hidden bg-surface-1 pt-4">
        <CalendarChart
          issuesFilterStore={issuesFilter}
          issues={issueMap}
          groupedIssueIds={groupedIssueIds}
          layout={displayFilters?.calendar?.layout}
          showWeekends={displayFilters?.calendar?.show_weekends ?? false}
          issueCalendarView={issueCalendarView}
          quickActions={({ issue, parentRef, customActionButton, placement }) => (
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
              placements={placement}
            />
          )}
          loadMoreIssues={loadMoreIssues}
          getPaginationData={getPaginationData}
          getGroupIssueCount={getGroupIssueCount}
          addIssuesToView={addIssuesToView}
          quickAddCallback={quickAddIssue}
          readOnly={isCompletedCycle}
          updateFilters={updateFilters}
          handleDragAndDrop={handleDragAndDrop}
          canEditProperties={canEditProperties}
          isEpic={isEpic}
        />
      </div>
    </>
  );
});
