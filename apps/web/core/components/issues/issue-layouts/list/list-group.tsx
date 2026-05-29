/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single grouped section renderer for the list layout (header + drag-target + rows + load-more + quick-add).
 *
 * Rendered purpose: owns the rendering of one column in the grouped list view. Renders the group
 * header (`HeaderGroupByCard`), registers itself as a pragmatic-DnD drop target for cross-group
 * issue moves, displays the drag overlay, mounts the per-group `IssueBlocksList`, paginates via an
 * intersection observer + manual "Load more" affordance, and renders the sticky quick-add form
 * when issue creation is permitted.
 *
 * Props (Props):
 *   - groupIssueIds (string[] | undefined, required): the issue ids in this group
 *   - group (IGroupByColumn, required): the column descriptor (id, name, icon, payload, isDropDisabled,
 *     dropErrorMessage) computed by `getGroupByColumns` in the parent
 *   - issuesMap (TIssueMap, required): forwarded into blocks for issue lookup
 *   - group_by (TIssueGroupByOptions | null, required): the active group key — also used to pre-populate
 *     quick-add form data
 *   - orderBy (TIssueOrderByOptions | undefined, required): the active sort key
 *   - getGroupIndex ((groupId) => number, required): resolves column positions for left/right drag-overlay alignment
 *   - updateIssue (optional callback): issue update fn used by inline editors
 *   - quickActions (TRenderQuickActions, required): scope-specific quick-action renderer forwarded to blocks
 *   - displayProperties (IIssueDisplayProperties | undefined): column visibility flags
 *   - enableIssueQuickAdd (boolean, required): toggle for the sticky quick-add form
 *   - canEditProperties ((projectId) => boolean, required): per-project edit predicate
 *   - containerRef (RefObject, required): the scroll container ref used by `useIntersectionObserver`
 *   - quickAddCallback (optional): the store action invoked when the quick-add form submits
 *   - handleOnDrop ((source, destination) => Promise<void>, required): the cross-group drop handler
 *   - disableIssueCreation (boolean, optional): hard-disables quick-add and add-existing
 *   - addIssuesToView (optional): forwarded into the header to enable add-existing
 *   - isCompletedCycle (boolean, optional): suppresses creation flows for completed cycles
 *   - showEmptyGroup (boolean, optional): when true, empty groups still render their header
 *   - loadMoreIssues ((groupId?) => void, required): paginates the next page for this group
 *   - selectionHelpers (TSelectionHelper, required): multi-select context propagated from `MultipleSelectGroup`
 *   - handleCollapsedGroups ((value) => void, required): toggles this group's collapsed state
 *   - collapsedGroups (TIssueKanbanFilters, required): the currently collapsed group ids
 *   - isEpic (boolean, optional, default=false): swaps work-item terminology for epic terminology
 *
 * MobX stores read:
 *   - `useProjectState()` provides `projectStates` used to seed `state_id` in `prePopulateQuickAddData`
 *   - `useIssuesStore()` exposes `issues.getGroupIssueCount`, `issues.getPaginationData`,
 *     `issues.getIssueLoader` for the active store type
 *   - `useWorkFlowFDragNDrop(group_by)` (plane-web) exposes `workflowDisabledSource`,
 *     `isWorkflowDropDisabled`, `handleWorkFlowState`, `getIsWorkflowWorkItemCreationDisabled` for the
 *     workflow gating overlay
 *
 * Side effects:
 *   - `useEffect` registers a `dropTargetForElements` on `groupRef.current` that:
 *       1. Tracks `isDraggingOverColumn` state via `onDragEnter`/`onDragLeave`/`onDragStart`
 *       2. Computes left/right drag-overlay orientation by comparing source vs. current column index
 *       3. On drop, extracts source + destination from the payload via `getSourceFromDropPayload`/
 *          `getDestinationFromDropPayload`, blocks dropping into workflow-disabled or group-disabled
 *          columns (emits a WARNING toast if a drop-error message is present), invokes `handleOnDrop`,
 *          flashes a highlight via `highlightIssueOnDrop(getIssueBlockId(...))`, and auto-expands the
 *          group if the drop happened while collapsed.
 *   - `useIntersectionObserver(containerRef, intersectionElement, loadMoreIssues, "100% 0% 100% 0%")`
 *     triggers `loadMoreIssues(group.id)` when the loader sentinel intersects the scroll container
 *     (only when not paginating)
 *   - `handleWorkFlowState(sourceGroupId, currentGroupId)` is called on every drag tick to update the
 *     workflow disabled visualization in real time
 *
 * Consumers: `default.tsx` (the list viewport — renders one `ListGroup` per column).
 */

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
// plane imports
import { DRAG_ALLOWED_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IGroupByColumn,
  TIssueMap,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  TIssue,
  IIssueDisplayProperties,
  TIssueKanbanFilters,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ListLoaderItemRow } from "@/components/ui/loader/layouts/list-layout-loader";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// Plane-web
import { useWorkFlowFDragNDrop } from "@/plane-web/components/workflow";
//
import { GroupDragOverlay } from "../group-drag-overlay";
import { ListQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import type { GroupDropLocation } from "../utils";
import {
  getDestinationFromDropPayload,
  getIssueBlockId,
  getSourceFromDropPayload,
  highlightIssueOnDrop,
} from "../utils";
import { IssueBlocksList } from "./blocks-list";
import { HeaderGroupByCard } from "./headers/group-by-card";
import type { TRenderQuickActions } from "./list-view-types";

/** Props for `ListGroup`. See the module-level JSDoc for full semantics. */
interface Props {
  groupIssueIds: string[] | undefined;
  group: IGroupByColumn;
  issuesMap: TIssueMap;
  group_by: TIssueGroupByOptions | null;
  orderBy: TIssueOrderByOptions | undefined;
  getGroupIndex: (groupId: string | undefined) => number;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  enableIssueQuickAdd: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  quickAddCallback?: ((projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>) | undefined;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  disableIssueCreation?: boolean;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  isCompletedCycle?: boolean;
  showEmptyGroup?: boolean;
  loadMoreIssues: (groupId?: string) => void;
  selectionHelpers: TSelectionHelper;
  handleCollapsedGroups: (value: string) => void;
  collapsedGroups: TIssueKanbanFilters;
  isEpic?: boolean;
}

/** Single grouped section renderer; see the module-level JSDoc for full semantics. */
export const ListGroup = observer(function ListGroup(props: Props) {
  const {
    groupIssueIds = [],
    group,
    issuesMap,
    group_by,
    orderBy,
    getGroupIndex,
    updateIssue,
    quickActions,
    displayProperties,
    enableIssueQuickAdd,
    canEditProperties,
    containerRef,
    quickAddCallback,
    handleOnDrop,
    disableIssueCreation,
    addIssuesToView,
    isCompletedCycle,
    showEmptyGroup,
    loadMoreIssues,
    selectionHelpers,
    handleCollapsedGroups,
    collapsedGroups,
    isEpic = false,
  } = props;

  const [isDraggingOverColumn, setIsDraggingOverColumn] = useState(false);
  const [dragColumnOrientation, setDragColumnOrientation] = useState<"justify-start" | "justify-end">("justify-start");
  const isExpanded = !collapsedGroups?.group_by.includes(group.id);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();
  const projectState = useProjectState();

  const {
    issues: { getGroupIssueCount, getPaginationData, getIssueLoader },
  } = useIssuesStore();

  const [intersectionElement, setIntersectionElement] = useState<HTMLDivElement | null>(null);

  const { workflowDisabledSource, isWorkflowDropDisabled, handleWorkFlowState, getIsWorkflowWorkItemCreationDisabled } =
    useWorkFlowFDragNDrop(group_by);
  const isWorkflowIssueCreationDisabled = getIsWorkflowWorkItemCreationDisabled(group.id);

  const groupIssueCount = getGroupIssueCount(group.id, undefined, false) ?? 0;
  const nextPageResults = getPaginationData(group.id, undefined)?.nextPageResults;
  const isPaginating = !!getIssueLoader(group.id);

  useIntersectionObserver(containerRef, isPaginating ? null : intersectionElement, loadMoreIssues, `100% 0% 100% 0%`);

  const shouldLoadMore =
    nextPageResults === undefined && groupIssueCount !== undefined && groupIssueIds
      ? groupIssueIds.length < groupIssueCount
      : !!nextPageResults;

  const loadMore = isPaginating ? (
    <ListLoaderItemRow />
  ) : (
    <div
      className={
        "relative flex h-11 cursor-pointer items-center gap-3 border border-transparent border-t-subtle-1 bg-surface-1 p-3 pl-8 text-13 font-medium text-accent-primary hover:text-accent-secondary hover:underline"
      }
      onClick={() => loadMoreIssues(group.id)}
    >
      {t("common.load_more")} &darr;
    </div>
  );

  /**
   * Returns true when the group should still render even with zero issues.
   *
   * WHY: when `showEmptyGroup` is off (the default), we intentionally hide empty groups so the page is
   * not cluttered with disabled headers. When `showEmptyGroup` is on (from filter store), all groups
   * render regardless of count.
   */
  const validateEmptyIssueGroups = (issueCount: number = 0) => {
    if (!showEmptyGroup && issueCount <= 0) return false;
    return true;
  };

  /**
   * Computes the partial issue payload that pre-fills the quick-add form for this group.
   *
   * WHY: when a user clicks "+ Add issue" inside a grouped column, the new issue must inherit the
   * group's value (e.g. dropping into the "In Progress" state column pre-sets `state_id`). For array
   * fields (labels, modules, assignees) the group value seeds a single-item array; the `"None"` sentinel
   * is treated as an absence and skipped. `state` defaults to the project's default state when no
   * specific state group is selected.
   */
  const prePopulateQuickAddData = (groupByKey: string | null, value: any) => {
    const defaultState = projectState.projectStates?.find((state) => state.default);
    let preloadedData: object = { state_id: defaultState?.id };

    if (groupByKey === null) {
      preloadedData = { ...preloadedData };
    } else {
      if (groupByKey === "state") {
        preloadedData = { ...preloadedData, state_id: value };
      } else if (groupByKey === "priority") {
        preloadedData = { ...preloadedData, priority: value };
      } else if (groupByKey === "labels" && value != "None") {
        preloadedData = { ...preloadedData, label_ids: [value] };
      } else if (groupByKey === "assignees" && value != "None") {
        preloadedData = { ...preloadedData, assignee_ids: [value] };
      } else if (groupByKey === "cycle" && value != "None") {
        preloadedData = { ...preloadedData, cycle_id: value };
      } else if (groupByKey === "module" && value != "None") {
        preloadedData = { ...preloadedData, module_ids: [value] };
      } else if (groupByKey === "created_by") {
        preloadedData = { ...preloadedData };
      } else {
        preloadedData = { ...preloadedData, [groupByKey]: value };
      }
    }

    return preloadedData;
  };

  useEffect(() => {
    const element = groupRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ groupId: group.id, type: "COLUMN" }),
        onDragEnter: () => {
          setIsDraggingOverColumn(true);
        },
        onDragLeave: () => {
          setIsDraggingOverColumn(false);
        },
        onDragStart: () => {
          setIsDraggingOverColumn(true);
        },
        onDrag: ({ source }) => {
          const sourceGroupId = source?.data?.groupId as string | undefined;
          const currentGroupId = group.id;

          sourceGroupId && handleWorkFlowState(sourceGroupId, currentGroupId);

          const sourceIndex = getGroupIndex(sourceGroupId);
          const currentIndex = getGroupIndex(currentGroupId);

          if (sourceIndex > currentIndex) {
            setDragColumnOrientation("justify-end");
          } else {
            setDragColumnOrientation("justify-start");
          }
        },
        onDrop: (payload) => {
          setIsDraggingOverColumn(false);
          const source = getSourceFromDropPayload(payload);
          const destination = getDestinationFromDropPayload(payload);

          if (!source || !destination) return;

          if (isWorkflowDropDisabled || group.isDropDisabled) {
            if (group.dropErrorMessage)
              setToast({
                type: TOAST_TYPE.WARNING,
                title: t("common.warning"),
                message: group.dropErrorMessage,
              });
            return;
          }

          handleOnDrop(source, destination);

          highlightIssueOnDrop(getIssueBlockId(source.id, destination?.groupId), orderBy !== "sort_order");

          if (!isExpanded) {
            handleCollapsedGroups(group.id);
          }
        },
      })
    );
  }, [
    groupRef?.current,
    group,
    orderBy,
    getGroupIndex,
    setDragColumnOrientation,
    setIsDraggingOverColumn,
    isWorkflowDropDisabled,
  ]);

  const isDragAllowed = group_by ? DRAG_ALLOWED_GROUPS.includes(group_by) : true;
  const canOverlayBeVisible = isWorkflowDropDisabled || orderBy !== "sort_order" || !!group.isDropDisabled;
  const isDropDisabled = isWorkflowDropDisabled || !!group.isDropDisabled;

  const isGroupByCreatedBy = group_by === "created_by";
  // shouldExpand: a group is treated as expanded for rendering when (a) it has issues and is not
  // user-collapsed, or (b) no grouping is active at all (flat-list mode — there is no header to collapse).
  const shouldExpand = (!!groupIssueCount && isExpanded) || !group_by;

  return validateEmptyIssueGroups(groupIssueCount) ? (
    <div
      ref={groupRef}
      className={cn(`relative flex flex-shrink-0 flex-col`, {
        "border-accent-strong": isDraggingOverColumn,
        "border-danger-subtle": isDraggingOverColumn && isDropDisabled,
      })}
    >
      <Row
        className={cn("w-full flex-shrink-0 border-b border-subtle bg-layer-1 py-1 pr-3 hover:bg-layer-1-hover", {
          "sticky top-0 z-[2]": isExpanded && groupIssueCount > 0,
        })}
      >
        <HeaderGroupByCard
          groupID={group.id}
          groupBy={group_by}
          icon={group.icon}
          title={group.name}
          count={groupIssueCount}
          issuePayload={group.payload}
          canEditProperties={canEditProperties}
          disableIssueCreation={
            disableIssueCreation || isGroupByCreatedBy || isCompletedCycle || isWorkflowIssueCreationDisabled
          }
          addIssuesToView={addIssuesToView}
          selectionHelpers={selectionHelpers}
          handleCollapsedGroups={handleCollapsedGroups}
          isEpic={isEpic}
        />
      </Row>
      {shouldExpand && (
        <div className="relative">
          <GroupDragOverlay
            dragColumnOrientation={dragColumnOrientation}
            canOverlayBeVisible={canOverlayBeVisible}
            isDropDisabled={isDropDisabled}
            workflowDisabledSource={workflowDisabledSource}
            dropErrorMessage={group.dropErrorMessage}
            orderBy={orderBy}
            isDraggingOverColumn={isDraggingOverColumn}
            isEpic={isEpic}
          />
          {groupIssueIds && (
            <IssueBlocksList
              issueIds={groupIssueIds}
              groupId={group.id}
              issuesMap={issuesMap}
              updateIssue={updateIssue}
              quickActions={quickActions}
              displayProperties={displayProperties}
              canEditProperties={canEditProperties}
              containerRef={containerRef}
              isDragAllowed={isDragAllowed}
              canDropOverIssue={!canOverlayBeVisible}
              selectionHelpers={selectionHelpers}
              isEpic={isEpic}
            />
          )}

          {shouldLoadMore &&
            (group_by ? (
              <>{loadMore}</>
            ) : (
              <>
                {Array.from({ length: 2 }).map((_, index) => (
                  <ListLoaderItemRow key={index} />
                ))}
                <ListLoaderItemRow ref={setIntersectionElement} />
              </>
            ))}

          {enableIssueQuickAdd &&
            !disableIssueCreation &&
            !isGroupByCreatedBy &&
            !isCompletedCycle &&
            !isWorkflowIssueCreationDisabled && (
              <div className="sticky bottom-0 z-[1] w-full flex-shrink-0">
                <QuickAddIssueRoot
                  layout={EIssueLayoutTypes.LIST}
                  QuickAddButton={ListQuickAddIssueButton}
                  prePopulatedData={prePopulateQuickAddData(group_by, group.id)}
                  containerClassName="border-b border-t border-subtle bg-surface-1 "
                  quickAddCallback={quickAddCallback}
                  isEpic={isEpic}
                />
              </div>
            )}
        </div>
      )}
    </div>
  ) : null;
});
