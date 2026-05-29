/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Gantt issue layout composition root.
 *
 * Rendered purpose: top-level orchestrator for the gantt issue layout — wires MobX issue stores,
 * timeline initialization, permissions, quick-add, pagination, and date-update handlers into the shared
 * `GanttChartRoot` shell, then wraps the result in the layout HOC for loader / empty-state gating.
 *
 * Props (IBaseGanttRoot):
 *   - viewId (string, optional): the project-view id, when the gantt is rendered inside a saved view
 *     context (passed through to `fetchIssues` so the view-scoped query is honored)
 *   - isCompletedCycle (boolean, optional, default=false): suppresses the quick-add affordance because
 *     completed cycles MUST NOT accept new work items
 *   - isEpic (boolean, optional, default=false): switches the renderer to epic mode (epic-specific labels
 *     and the `IssueStats` overlay rendered by `IssueGanttBlock`)
 *
 * Exported type:
 *   - `GanttStoreType`: union of `EIssuesStoreType.PROJECT | MODULE | CYCLE | PROJECT_VIEW | EPIC` —
 *     the five contexts in which the gantt issue layout can be mounted. Consumed by `./blocks.tsx` to
 *     read the correct issues store for the sidebar block's display properties.
 *
 * MobX stores read (via the `useIssues(storeType)` hook, where `storeType` is resolved at runtime from
 * the route via `useIssueStoreType()`):
 *   - `issues` slice: `groupedIssueIds[ALL_ISSUES]`, `getPaginationData(...)`, `viewFlags`,
 *     `updateIssueDates` (action)
 *   - `issuesFilter` slice: `issueFilters.displayFilters.order_by` (controls reorder permission)
 *   - `useUserPermissions()` (user store): `allowPermissions()` for ADMIN/MEMBER at PROJECT level —
 *     gates resize / move / reorder / add-block affordances
 *
 * Other hook-driven state:
 *   - `useIssuesActions(storeType)`: `fetchIssues`, `fetchNextIssues`, `updateIssue`, `quickAddIssue`
 *   - `useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE)`: provides `initGantt` to bootstrap the timeline-chart
 *     store with the issue-typed view
 *   - `useBulkOperationStatus()` (plane-web): enables multi-select bulk operations when both the
 *     workspace feature flag is on AND permissions allow
 *
 * Side effects:
 *   - On mount / `storeType` / `viewId` change: `fetchIssues("init-loader", { canGroup: false,
 *     perPageCount: 100 }, viewId)` — async load of the first 100 issues; surfaces through the loader
 *     state read by `IssueLayoutHOC`
 *   - On mount only: `initGantt()` — primes the timeline chart store; intentional empty dep array
 *   - `updateIssueBlockStructure(issue, data)`: PATCH to `updateIssue(project_id, id, payload)` —
 *     converts `data.sort_order = { newSortOrder }` into the flat `sort_order: <number>` field expected
 *     by the API; runs only when `workspaceSlug` is resolved
 *   - `updateBlockDates(updates[])`: bulk PATCH via `issues.updateIssueDates(workspaceSlug, updates,
 *     projectId)` — used by drag-to-resize / drag-to-move; emits a `TOAST_TYPE.ERROR` toast on failure
 *   - `loadMoreIssues()`: page-advances via `fetchNextIssues()`
 *   - Quick-add: when allowed, mounts `QuickAddIssueRoot` with `start_date = today` and
 *     `target_date = today + 1 day` so the new block lands at the right edge of the chart
 *
 * Layout composition:
 *   - Wrapped in `IssueLayoutHOC` (sibling `../issue-layout-HOC.tsx`) for skeleton loader and empty
 *     state gating.
 *   - Provides `TimeLineTypeContext.Provider` with `GANTT_TIMELINE_TYPE.ISSUE` so descendant gantt
 *     components can disambiguate from epic / module gantt views.
 *   - `GanttChartRoot` is the shared timeline shell from `@/components/gantt-chart/root` — block renderer
 *     is `IssueGanttBlock` (from `./blocks`), sidebar renderer is `IssueGanttSidebar` from
 *     `@/components/gantt-chart/sidebar/issues/sidebar`.
 *
 * Permission rules:
 *   - `isAllowed = ADMIN | MEMBER` at PROJECT level
 *   - Reorder is additionally gated on `displayFilters.order_by === "sort_order"` because reorder
 *     semantics are only meaningful under explicit sort-order ordering.
 *   - Multi-select selection is additionally gated on the plane-web bulk-operations feature flag.
 */

import React, { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
// plane web hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";

import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { IssueGanttBlock } from "./blocks";

/** Props for {@link BaseGanttRoot}. */
interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

/**
 * Union of issues-store types under which the gantt issue layout can be mounted.
 *
 * Used by `./blocks.tsx` to read the appropriate `useIssues(storeType)` slice for display properties.
 */
export type GanttStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

/** Gantt issue layout composition root; see the module-level JSDoc for full state, actions, and consumers. */
export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // derived values
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);

  /** Re-fetches the initial page whenever the active issues store or the active view changes. */
  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  /** One-time gantt timeline bootstrap; intentionally has an empty dep array. */
  useEffect(() => {
    initGantt();
  }, []);

  const issuesIds = (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? [];
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  const { enableIssueCreation } = issues?.viewFlags || {};

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  /**
   * Persists a single block's structural change (sort_order or date range) by mapping the timeline-chart
   * `{ newSortOrder }` shape onto the flat `sort_order: number` field expected by the issues API.
   */
  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    updateIssue && (await updateIssue(issue.project_id, issue.id, payload));
  };

  const isAllowed = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const updateBlockDates = useCallback(
    (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) =>
      issues.updateIssueDates(workspaceSlug.toString(), updates, projectId.toString()).catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      }),
    [issues, projectId, workspaceSlug]
  );

  /**
   * Quick-add is only mounted when issue creation is enabled in `viewFlags`, the caller has ADMIN/MEMBER
   * permission, AND the cycle is not completed — completed cycles cannot accept new work items.
   */
  const quickAdd =
    enableIssueCreation && isAllowed && !isCompletedCycle ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={{
          start_date: renderFormattedPayloadDate(new Date()),
          target_date: renderFormattedPayloadDate(targetDate),
        }}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        <div className="h-full w-full">
          <GanttChartRoot
            border={false}
            title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            blockIds={issuesIds}
            blockUpdateHandler={updateIssueBlockStructure}
            blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
            sidebarToRender={(props) => <IssueGanttSidebar {...props} showAllBlocks isEpic={isEpic} />}
            enableBlockLeftResize={isAllowed}
            enableBlockRightResize={isAllowed}
            enableBlockMove={isAllowed}
            enableReorder={appliedDisplayFilters?.order_by === "sort_order" && isAllowed}
            enableAddBlock={isAllowed}
            enableSelection={isBulkOperationsEnabled && isAllowed}
            quickAdd={quickAdd}
            loadMoreBlocks={loadMoreIssues}
            canLoadMoreBlocks={nextPageResults}
            updateBlockDates={updateBlockDates}
            showAllBlocks
            enableDependency
            isEpic={isEpic}
          />
        </div>
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
