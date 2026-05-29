/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single Kanban lane (column) with full drag-and-drop, pagination, and quick-add wiring.
 *
 * Rendered purpose: renders the contents of one group-by column — the drag overlay, the issue
 * blocks list, the load-more / pagination skeleton, and the optional quick-add form. Registers the
 * column as a Pragmatic DnD drop target so issues can be moved into it.
 *
 * Module exports:
 *   - `KanbanGroup` — used by `./default.tsx` (and indirectly by `./swimlanes.tsx`) to render each
 *     column inside a `RenderIfVisible` lazy mount.
 *
 * MobX stores read:
 *   - `useProjectState()` exposes `projectStates`, used to resolve the default state for new
 *     issues created via the in-column quick-add form.
 *   - `useIssuesStore()` exposes `issues.getGroupIssueCount`, `issues.getPaginationData`, and
 *     `issues.getIssueLoader` (loader state, pagination cursor, total count for this column).
 *   - `useWorkFlowFDragNDrop(group_by, sub_group_by)` (plane-web) exposes
 *     `workflowDisabledSource`, `isWorkflowDropDisabled`, `handleWorkFlowState`, and
 *     `getIsWorkflowWorkItemCreationDisabled` — workflow-aware drop blocking + creation gating.
 *
 * Side effects (registered via `useEffect`):
 *   1. Registers the column DOM node as a Pragmatic DnD `dropTargetForElements` with payload
 *      `{ groupId, subGroupId, columnId: '<groupId>__<subGroupId>', type: 'COLUMN' }`.
 *      On `onDragEnter`/`onDragStart` it calls `handleWorkFlowState` (workflow context update),
 *      and on `onDrop` it either emits a warning toast (when workflow- or column-disabled) or
 *      invokes `handleOnDrop(source, destination)` and then `highlightIssueOnDrop(...)` to flash
 *      the moved card after persistence.
 *   2. Registers `autoScrollForElements` on the column so vertical scroll auto-engages near edges
 *      during a drag.
 *   3. Subscribes to `useIntersectionObserver(containerRef, intersectionElement, loadMoreIssues, ...)`
 *      so reaching the bottom skeleton card triggers pagination (`loadMoreIssues(groupId, subGroupId)`)
 *      UNLESS the loader is already in a pagination state.
 *
 * Quick-add prepopulation (`prePopulateQuickAddData`):
 *   - Maps the current `group_by` and `sub_group_by` values to issue-creation defaults so a new
 *     issue created from this lane lands inside it. Handles state, priority, cycle, module, labels,
 *     assignees, and created_by, plus arbitrary scalar group keys.
 *   - The `created_by` branch intentionally falls through to just the default state because the
 *     creator id is set server-side from the auth context.
 *
 * Drop-overlay logic (the WHY):
 *   - `canOverlayBeVisible = isWorkflowDropDisabled || orderBy !== "sort_order" || isDropDisabled` —
 *     the overlay only appears when the drop would either be rejected (workflow / column-level) or
 *     would change the sort order in a non-manual sort context (drops in non-`sort_order` views
 *     would not be persistable as ordering moves).
 *   - `canDragIssuesInCurrentGrouping` checks `DRAG_ALLOWED_GROUPS` for both `group_by` and
 *     `sub_group_by` — only specific group keys (e.g. state, priority) support drag-to-move.
 *
 * Consumers:
 *   - `./default.tsx` — instantiates one `KanbanGroup` per column (wrapped in `RenderIfVisible`).
 */

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane constants
import { DRAG_ALLOWED_GROUPS } from "@plane/constants";
// i18n
import { useTranslation } from "@plane/i18n";
//types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TGroupedIssues,
  TIssue,
  IIssueDisplayProperties,
  IIssueMap,
  TSubGroupedIssues,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import { cn } from "@plane/utils";
import type { GroupDropLocation } from "@/components/issues/issue-layouts/utils";
import {
  highlightIssueOnDrop,
  getSourceFromDropPayload,
  getDestinationFromDropPayload,
  getIssueBlockId,
} from "@/components/issues/issue-layouts/utils";
import { KanbanIssueBlockLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
// Plane-web
import { useWorkFlowFDragNDrop } from "@/plane-web/components/workflow";
//
import { GroupDragOverlay } from "../group-drag-overlay";
import type { TRenderQuickActions } from "../list/list-view-types";
import { KanbanQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { KanbanIssueBlocksList } from "./blocks-list";

/**
 * Props for `KanbanGroup`.
 *
 * The `isDragDisabled` / `isDropDisabled` flags are caller-computed (in `./default.tsx`) and
 * forwarded here so this component can render the appropriate overlay state without re-reading
 * the kanban-view store directly.
 */
interface IKanbanGroup {
  groupId: string;
  issuesMap: IIssueMap;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
  displayProperties: IIssueDisplayProperties | undefined;
  sub_group_by: TIssueGroupByOptions | undefined;
  group_by: TIssueGroupByOptions | undefined;
  sub_group_id: string;
  isDragDisabled: boolean;
  isDropDisabled: boolean;
  dropErrorMessage: string | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  enableQuickIssueCreate?: boolean;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  loadMoreIssues: (groupId?: string, subGroupId?: string) => void;
  disableIssueCreation?: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
  groupByVisibilityToggle?: boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  orderBy: TIssueOrderByOptions | undefined;
  isEpic?: boolean;
}

/** Single Kanban lane with DnD, pagination, and quick-add wiring; see the module-level JSDoc. */
export const KanbanGroup = observer(function KanbanGroup(props: IKanbanGroup) {
  const {
    groupId,
    sub_group_id,
    group_by,
    orderBy,
    sub_group_by,
    issuesMap,
    displayProperties,
    groupedIssueIds,
    isDropDisabled,
    dropErrorMessage,
    updateIssue,
    quickActions,
    canEditProperties,
    loadMoreIssues,
    enableQuickIssueCreate,
    disableIssueCreation,
    quickAddCallback,
    scrollableContainerRef,
    handleOnDrop,
    isEpic = false,
  } = props;
  // i18n
  const { t } = useTranslation();
  // hooks
  const projectState = useProjectState();

  const {
    issues: { getGroupIssueCount, getPaginationData, getIssueLoader },
  } = useIssuesStore();

  const [intersectionElement, setIntersectionElement] = useState<HTMLSpanElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);

  const containerRef = sub_group_by && scrollableContainerRef ? scrollableContainerRef : columnRef;

  const loadMoreIssuesInThisGroup = useCallback(() => {
    loadMoreIssues(groupId, sub_group_id === "null" ? undefined : sub_group_id);
  }, [loadMoreIssues, groupId, sub_group_id]);

  const isPaginating = !!getIssueLoader(groupId, sub_group_id);

  useIntersectionObserver(
    containerRef,
    isPaginating ? null : intersectionElement,
    loadMoreIssuesInThisGroup,
    `0% 100% 100% 100%`
  );
  const [isDraggingOverColumn, setIsDraggingOverColumn] = useState(false);

  const { workflowDisabledSource, isWorkflowDropDisabled, handleWorkFlowState, getIsWorkflowWorkItemCreationDisabled } =
    useWorkFlowFDragNDrop(group_by, sub_group_by);

  // Enable Kanban Columns as Drop Targets
  useEffect(() => {
    const element = columnRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ groupId, subGroupId: sub_group_id, columnId: `${groupId}__${sub_group_id}`, type: "COLUMN" }),
        onDragEnter: (payload) => {
          const source = getSourceFromDropPayload(payload);
          setIsDraggingOverColumn(true);
          // handle if dragging a workflowState
          if (source) {
            handleWorkFlowState(source?.groupId, groupId, source?.subGroupId, sub_group_id);
          }
        },
        onDragLeave: () => {
          setIsDraggingOverColumn(false);
        },
        onDragStart: (payload) => {
          const source = getSourceFromDropPayload(payload);
          setIsDraggingOverColumn(true);
          // handle if dragging a workflowState
          if (source) {
            handleWorkFlowState(source?.groupId, groupId, source?.subGroupId, sub_group_id);
          }
        },
        onDrop: (payload) => {
          setIsDraggingOverColumn(false);
          const source = getSourceFromDropPayload(payload);
          const destination = getDestinationFromDropPayload(payload);

          if (!source || !destination) return;

          if ((isWorkflowDropDisabled || isDropDisabled) && dropErrorMessage) {
            setToast({
              type: TOAST_TYPE.WARNING,
              title: t("common.warning"),
              message: dropErrorMessage,
            });
            return;
          }

          handleOnDrop(source, destination);

          highlightIssueOnDrop(
            getIssueBlockId(source.id, destination?.groupId, destination?.subGroupId),
            orderBy !== "sort_order"
          );
        },
      }),
      autoScrollForElements({
        element,
      })
    );
  }, [
    columnRef,
    groupId,
    sub_group_id,
    setIsDraggingOverColumn,
    orderBy,
    isDropDisabled,
    isWorkflowDropDisabled,
    dropErrorMessage,
    handleOnDrop,
  ]);

  /**
   * Builds the seed payload for the in-column quick-add form so a newly created issue lands inside
   * this lane (or sub-lane) automatically.
   *
   * Returns a merged object containing the default state plus any group/subgroup field assignments;
   * sentinel values of "None" for labels/assignees are filtered out because the backend expects an
   * absent field, not a "None"-labelled record.
   */
  const prePopulateQuickAddData = (
    groupByKey: string | undefined,
    subGroupByKey: string | undefined | null,
    groupValue: string,
    subGroupValue: string
  ) => {
    const defaultState = projectState.projectStates?.find((state) => state.default);
    let preloadedData: object = { state_id: defaultState?.id };

    if (groupByKey) {
      if (groupByKey === "state") {
        preloadedData = { ...preloadedData, state_id: groupValue };
      } else if (groupByKey === "priority") {
        preloadedData = { ...preloadedData, priority: groupValue };
      } else if (groupByKey === "cycle") {
        preloadedData = { ...preloadedData, cycle_id: groupValue };
      } else if (groupByKey === "module") {
        preloadedData = { ...preloadedData, module_ids: [groupValue] };
      } else if (groupByKey === "labels" && groupValue != "None") {
        preloadedData = { ...preloadedData, label_ids: [groupValue] };
      } else if (groupByKey === "assignees" && groupValue != "None") {
        preloadedData = { ...preloadedData, assignee_ids: [groupValue] };
      } else if (groupByKey === "created_by") {
        preloadedData = { ...preloadedData };
      } else {
        preloadedData = { ...preloadedData, [groupByKey]: groupValue };
      }
    }

    if (subGroupByKey) {
      if (subGroupByKey === "state") {
        preloadedData = { ...preloadedData, state_id: subGroupValue };
      } else if (subGroupByKey === "priority") {
        preloadedData = { ...preloadedData, priority: subGroupValue };
      } else if (subGroupByKey === "cycle") {
        preloadedData = { ...preloadedData, cycle_id: subGroupValue };
      } else if (subGroupByKey === "module") {
        preloadedData = { ...preloadedData, module_ids: [subGroupValue] };
      } else if (subGroupByKey === "labels" && subGroupValue != "None") {
        preloadedData = { ...preloadedData, label_ids: [subGroupValue] };
      } else if (subGroupByKey === "assignees" && subGroupValue != "None") {
        preloadedData = { ...preloadedData, assignee_ids: [subGroupValue] };
      } else if (subGroupByKey === "created_by") {
        preloadedData = { ...preloadedData };
      } else {
        preloadedData = { ...preloadedData, [subGroupByKey]: subGroupValue };
      }
    }

    return preloadedData;
  };

  const isSubGroup = !!sub_group_id && sub_group_id !== "null";

  const issueIds = isSubGroup
    ? ((groupedIssueIds as TSubGroupedIssues)?.[groupId]?.[sub_group_id] ?? [])
    : ((groupedIssueIds as TGroupedIssues)?.[groupId] ?? []);

  const groupIssueCount = getGroupIssueCount(groupId, sub_group_id, false) ?? 0;

  const nextPageResults = getPaginationData(groupId, sub_group_id)?.nextPageResults;

  const loadMore = isPaginating ? (
    <KanbanIssueBlockLoader />
  ) : (
    <div
      className="sticky bottom-0 w-full cursor-pointer p-3 text-13 font-medium text-accent-primary hover:text-accent-secondary hover:underline"
      onClick={loadMoreIssuesInThisGroup}
    >
      {t("common.load_more")} &darr;
    </div>
  );

  const shouldLoadMore = nextPageResults === undefined ? issueIds?.length < groupIssueCount : !!nextPageResults;
  const canOverlayBeVisible = isWorkflowDropDisabled || orderBy !== "sort_order" || isDropDisabled;
  const shouldOverlayBeVisible = isDraggingOverColumn && canOverlayBeVisible;
  const canDragIssuesInCurrentGrouping =
    !!group_by &&
    DRAG_ALLOWED_GROUPS.includes(group_by) &&
    (sub_group_by ? DRAG_ALLOWED_GROUPS.includes(sub_group_by) : true);

  return (
    <div
      id={`${groupId}__${sub_group_id}`}
      className={cn(
        "relative h-full min-h-[120px] transition-all",
        { "rounded-sm bg-layer-1": isDraggingOverColumn },
        { "vertical-scrollbar scrollbar-md": !sub_group_by && !shouldOverlayBeVisible }
      )}
      ref={columnRef}
    >
      <GroupDragOverlay
        dragColumnOrientation={sub_group_by ? "justify-start" : "justify-center"}
        canOverlayBeVisible={canOverlayBeVisible}
        isDropDisabled={isWorkflowDropDisabled || isDropDisabled}
        workflowDisabledSource={workflowDisabledSource}
        dropErrorMessage={dropErrorMessage}
        orderBy={orderBy}
        isDraggingOverColumn={isDraggingOverColumn}
        isEpic={isEpic}
      />
      <KanbanIssueBlocksList
        sub_group_id={sub_group_id}
        groupId={groupId}
        issuesMap={issuesMap}
        issueIds={issueIds || []}
        displayProperties={displayProperties}
        updateIssue={updateIssue}
        quickActions={quickActions}
        canEditProperties={canEditProperties}
        scrollableContainerRef={scrollableContainerRef}
        canDropOverIssue={!canOverlayBeVisible}
        canDragIssuesInCurrentGrouping={canDragIssuesInCurrentGrouping}
        isEpic={isEpic}
      />

      {shouldLoadMore &&
        (isSubGroup ? (
          <>{loadMore}</>
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <KanbanIssueBlockLoader key={index} />
            ))}
            <KanbanIssueBlockLoader ref={setIntersectionElement} />
          </div>
        ))}

      {enableQuickIssueCreate &&
        !disableIssueCreation &&
        !getIsWorkflowWorkItemCreationDisabled(groupId, sub_group_id) && (
          <div className="sticky bottom-0 w-full bg-surface-2 py-0.5">
            <QuickAddIssueRoot
              layout={EIssueLayoutTypes.KANBAN}
              QuickAddButton={KanbanQuickAddIssueButton}
              prePopulatedData={{
                ...(group_by && prePopulateQuickAddData(group_by, sub_group_by, groupId, sub_group_id)),
              }}
              quickAddCallback={quickAddCallback}
              isEpic={isEpic}
            />
          </div>
        )}
    </div>
  );
});
