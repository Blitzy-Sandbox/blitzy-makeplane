/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Swimlane variant of the Kanban issue layout.
 *
 * Rendered purpose: composes a two-dimensional grouped board when BOTH `group_by` and `sub_group_by`
 * display filters are active. Renders a sticky header row showing the primary `group_by` columns
 * (e.g. states), then renders a `SubGroupSwimlane` per `sub_group_by` value (e.g. priorities) where
 * each subgroup contains a nested `KanBan` instance from `./default`.
 *
 * Module exports:
 *   - `KanBanSwimLanes` (default export shape used by `base-kanban-root.tsx` via the
 *     `KanBanView = sub_group_by ? KanBanSwimLanes : KanBan` switch)
 *   - `IKanBanSwimLanes` interface — the full prop contract forwarded down to nested boards
 *
 * Composition:
 *   - `KanBanSwimLanes` resolves the column lists via `getGroupByColumns` for both `group_by` and
 *     `sub_group_by`, then renders:
 *       1. `SubGroupSwimlaneHeader` — the horizontally-scrolling primary group header row
 *       2. `SubGroupSwimlane` — one row per subgroup, each containing a full nested `KanBan` board
 *          scoped to that subgroup id.
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the active `EIssuesStoreType` from the URL; used to determine
 *     workspace-scoped vs. project-scoped column construction via `isWorkspaceLevel(storeType)`.
 *   - `useWorkFlowFDragNDrop(group_by, sub_group_by)` (from plane-web) exposes
 *     `getIsWorkflowWorkItemCreationDisabled` for workflow-aware quick-add gating.
 *
 * Side effects: none directly — all mutations (`updateIssue`, `quickAddCallback`, `handleOnDrop`,
 * `addIssuesToView`, `handleCollapsedGroups`, `loadMoreIssues`) are forwarded into the nested
 * `KanBan` instances which register the actual Pragmatic DnD drop targets and call store mutators.
 *
 * Consumers:
 *   - `./base-kanban-root.tsx` — selects this variant whenever `sub_group_by` is truthy.
 */

import type { MutableRefObject } from "react";
import { observer } from "mobx-react";
// plane imports
import type {
  GroupByColumnTypes,
  IGroupByColumn,
  TGroupedIssues,
  TIssue,
  IIssueDisplayProperties,
  IIssueMap,
  TSubGroupedIssues,
  TIssueKanbanFilters,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
} from "@plane/types";
import { Row } from "@plane/ui";
// hooks
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// plane web imports
import { useWorkFlowFDragNDrop } from "@/plane-web/components/workflow";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import type { GroupDropLocation } from "../utils";
import { getGroupByColumns, isWorkspaceLevel } from "../utils";
import { KanBan } from "./default";
import { HeaderGroupByCard } from "./headers/group-by-card";
import { HeaderSubGroupByCard } from "./headers/sub-group-by-card";

/**
 * Props for the internal `SubGroupSwimlaneHeader` component.
 *
 * Encapsulates the inputs needed to render the sticky top header strip of primary `group_by`
 * columns above the swimlane rows.
 */
interface ISubGroupSwimlaneHeader {
  collapsedGroups: TIssueKanbanFilters;
  group_by: TIssueGroupByOptions | undefined;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  handleCollapsedGroups: (toggle: "group_by" | "sub_group_by", value: string) => void;
  isEpic?: boolean;
  list: IGroupByColumn[];
  showEmptyGroup: boolean;
  sub_group_by: TIssueGroupByOptions | undefined;
}

/**
 * Determines whether a primary-group column header should render in the swimlane header strip.
 *
 * Returns false ONLY when `showEmptyGroup` is false AND the column has zero issues — otherwise
 * always returns true so the header remains visible even when toggled to "show empty groups".
 */
const visibilitySubGroupByGroupCount = (subGroupIssueCount: number, showEmptyGroup: boolean): boolean => {
  let subGroupHeaderVisibility = true;

  if (showEmptyGroup) subGroupHeaderVisibility = true;
  else {
    if (subGroupIssueCount > 0) subGroupHeaderVisibility = true;
    else subGroupHeaderVisibility = false;
  }

  return subGroupHeaderVisibility;
};

/**
 * Renders the sticky primary `group_by` header strip at the top of the swimlane board.
 *
 * Side effects: none — purely presentational. Collapse toggles are delegated to the parent via
 * `handleCollapsedGroups`.
 */
const SubGroupSwimlaneHeader = observer(function SubGroupSwimlaneHeader({
  collapsedGroups,
  getGroupIssueCount,
  group_by,
  handleCollapsedGroups,
  isEpic = false,
  list,
  showEmptyGroup,
  sub_group_by,
}: ISubGroupSwimlaneHeader) {
  const { getIsWorkflowWorkItemCreationDisabled } = useWorkFlowFDragNDrop(group_by, sub_group_by);

  return (
    <div className="relative flex h-max min-h-full w-full items-center gap-4">
      {list &&
        list.length > 0 &&
        list.map((_list: IGroupByColumn) => {
          const groupCount = getGroupIssueCount(_list?.id, undefined, false) ?? 0;

          const subGroupByVisibilityToggle = visibilitySubGroupByGroupCount(groupCount, showEmptyGroup);

          if (subGroupByVisibilityToggle === false) return <></>;

          return (
            <div key={`${sub_group_by}_${_list.id}`} className="flex w-[350px] flex-shrink-0 flex-col">
              <HeaderGroupByCard
                sub_group_by={sub_group_by}
                group_by={group_by}
                column_id={_list.id}
                icon={_list.icon}
                title={_list.name}
                count={groupCount}
                collapsedGroups={collapsedGroups}
                handleCollapsedGroups={handleCollapsedGroups}
                issuePayload={_list.payload}
                disableIssueCreation={getIsWorkflowWorkItemCreationDisabled(_list.id)}
                isEpic={isEpic}
              />
            </div>
          );
        })}
    </div>
  );
});

/**
 * Props for the internal `SubGroupSwimlane` component.
 *
 * Extends `ISubGroupSwimlaneHeader` with the full set of board controls forwarded to each nested
 * `KanBan` instance (one per `sub_group_by` value).
 */
interface ISubGroupSwimlane extends ISubGroupSwimlaneHeader {
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  canEditProperties: (projectId: string | undefined) => boolean;
  collapsedGroups: TIssueKanbanFilters;
  disableIssueCreation?: boolean;
  displayProperties: IIssueDisplayProperties | undefined;
  enableQuickIssueCreate: boolean;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
  handleCollapsedGroups: (toggle: "group_by" | "sub_group_by", value: string) => void;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  isEpic?: boolean;
  issuesMap: IIssueMap;
  loadMoreIssues: (groupId?: string, subGroupId?: string) => void;
  orderBy: TIssueOrderByOptions | undefined;
  quickActions: TRenderQuickActions;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  showEmptyGroup: boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
}

/**
 * Renders one swimlane row per `sub_group_by` value, each containing a sticky subgroup header
 * (`HeaderSubGroupByCard`) and a nested `KanBan` board scoped to that subgroup id.
 *
 * Visibility logic (`visibilitySubGroupBy`):
 *   - When `showEmptyGroup` is true, the subgroup row always renders.
 *   - When `showEmptyGroup` is false, the row renders only if the cumulative issue count for that
 *     subgroup is > 0.
 *   - Issue rendering is suppressed (the nested `KanBan` is hidden) when the subgroup is collapsed
 *     via `collapsedGroups.sub_group_by`.
 */
const SubGroupSwimlane = observer(function SubGroupSwimlane(props: ISubGroupSwimlane) {
  const {
    addIssuesToView,
    canEditProperties,
    collapsedGroups,
    disableIssueCreation,
    displayProperties,
    enableQuickIssueCreate,
    getGroupIssueCount,
    group_by,
    groupedIssueIds,
    handleCollapsedGroups,
    handleOnDrop,
    isEpic = false,
    issuesMap,
    list,
    loadMoreIssues,
    orderBy,
    quickActions,
    quickAddCallback,
    scrollableContainerRef,
    showEmptyGroup,
    sub_group_by,
    updateIssue,
  } = props;

  const visibilitySubGroupBy = (
    _list: IGroupByColumn,
    subGroupCount: number
  ): { showGroup: boolean; showIssues: boolean } => {
    const subGroupVisibility = {
      showGroup: true,
      showIssues: true,
    };
    if (showEmptyGroup) subGroupVisibility.showGroup = true;
    else {
      if (subGroupCount > 0) subGroupVisibility.showGroup = true;
      else subGroupVisibility.showGroup = false;
    }
    if (collapsedGroups?.sub_group_by.includes(_list.id)) subGroupVisibility.showIssues = false;
    return subGroupVisibility;
  };

  return (
    <div className="relative h-max min-h-full w-full">
      {list &&
        list.length > 0 &&
        list.map((_list: IGroupByColumn, subGroupIndex) => {
          const issueCount = getGroupIssueCount(undefined, _list.id, true) ?? 0;
          const subGroupByVisibilityToggle = visibilitySubGroupBy(_list, issueCount);
          if (subGroupByVisibilityToggle.showGroup === false) return <></>;
          return (
            <div key={_list.id} className="flex flex-shrink-0 flex-col">
              <div className="sticky top-[50px] z-[3] flex w-full items-center border-y-[0.5px] border-subtle bg-layer-1 py-1">
                <Row className="sticky left-0 flex-shrink-0">
                  <HeaderSubGroupByCard
                    column_id={_list.id}
                    icon={_list.icon}
                    title={_list.name}
                    count={issueCount}
                    collapsedGroups={collapsedGroups}
                    handleCollapsedGroups={handleCollapsedGroups}
                    sub_group_by={sub_group_by}
                  />
                </Row>
              </div>

              {subGroupByVisibilityToggle.showIssues && (
                <div className="relative">
                  <KanBan
                    issuesMap={issuesMap}
                    groupedIssueIds={groupedIssueIds}
                    getGroupIssueCount={getGroupIssueCount}
                    displayProperties={displayProperties}
                    sub_group_by={sub_group_by}
                    group_by={group_by}
                    sub_group_id={_list.id}
                    subGroupIndex={subGroupIndex}
                    updateIssue={updateIssue}
                    quickActions={quickActions}
                    collapsedGroups={collapsedGroups}
                    handleCollapsedGroups={handleCollapsedGroups}
                    showEmptyGroup={showEmptyGroup}
                    enableQuickIssueCreate={enableQuickIssueCreate}
                    disableIssueCreation={disableIssueCreation}
                    canEditProperties={canEditProperties}
                    addIssuesToView={addIssuesToView}
                    quickAddCallback={quickAddCallback}
                    scrollableContainerRef={scrollableContainerRef}
                    loadMoreIssues={loadMoreIssues}
                    handleOnDrop={handleOnDrop}
                    orderBy={orderBy}
                    isDropDisabled={_list.isDropDisabled}
                    dropErrorMessage={_list.dropErrorMessage}
                    isEpic={isEpic}
                  />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
});

/** Props for `KanBanSwimLanes`; full set of board controls forwarded from `BaseKanBanRoot`. */
export interface IKanBanSwimLanes {
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  canEditProperties: (projectId: string | undefined) => boolean;
  collapsedGroups: TIssueKanbanFilters;
  disableIssueCreation?: boolean;
  displayProperties: IIssueDisplayProperties | undefined;
  enableQuickIssueCreate: boolean;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  group_by: TIssueGroupByOptions | undefined;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
  handleCollapsedGroups: (toggle: "group_by" | "sub_group_by", value: string) => void;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  isEpic?: boolean;
  issuesMap: IIssueMap;
  loadMoreIssues: (groupId?: string, subGroupId?: string) => void;
  orderBy: TIssueOrderByOptions | undefined;
  quickActions: TRenderQuickActions;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  showEmptyGroup: boolean;
  sub_group_by: TIssueGroupByOptions | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
}

/** Swimlane variant of the Kanban layout; see the module-level JSDoc for full semantics. */
export const KanBanSwimLanes = observer(function KanBanSwimLanes(props: IKanBanSwimLanes) {
  const {
    issuesMap,
    groupedIssueIds,
    getGroupIssueCount,
    displayProperties,
    sub_group_by,
    group_by,
    orderBy,
    updateIssue,
    quickActions,
    collapsedGroups,
    handleCollapsedGroups,
    loadMoreIssues,
    showEmptyGroup,
    handleOnDrop,
    disableIssueCreation,
    enableQuickIssueCreate,
    canEditProperties,
    addIssuesToView,
    quickAddCallback,
    scrollableContainerRef,
    isEpic = false,
  } = props;
  // store hooks
  const storeType = useIssueStoreType();
  // derived values
  const groupByList = getGroupByColumns({
    groupBy: group_by as GroupByColumnTypes,
    includeNone: true,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
    isEpic: isEpic,
  });
  const subGroupByList = getGroupByColumns({
    groupBy: sub_group_by as GroupByColumnTypes,
    includeNone: true,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
    isEpic: isEpic,
  });

  if (!groupByList || !subGroupByList) return null;

  return (
    <div className="relative">
      <Row className="sticky top-0 z-[4] h-[50px] bg-surface-2">
        <SubGroupSwimlaneHeader
          getGroupIssueCount={getGroupIssueCount}
          group_by={group_by}
          sub_group_by={sub_group_by}
          collapsedGroups={collapsedGroups}
          handleCollapsedGroups={handleCollapsedGroups}
          list={groupByList}
          showEmptyGroup={showEmptyGroup}
          isEpic={isEpic}
        />
      </Row>

      {sub_group_by && (
        <SubGroupSwimlane
          issuesMap={issuesMap}
          list={subGroupByList}
          groupedIssueIds={groupedIssueIds}
          getGroupIssueCount={getGroupIssueCount}
          displayProperties={displayProperties}
          group_by={group_by}
          sub_group_by={sub_group_by}
          orderBy={orderBy}
          updateIssue={updateIssue}
          quickActions={quickActions}
          collapsedGroups={collapsedGroups}
          handleCollapsedGroups={handleCollapsedGroups}
          loadMoreIssues={loadMoreIssues}
          showEmptyGroup={showEmptyGroup}
          handleOnDrop={handleOnDrop}
          disableIssueCreation={disableIssueCreation}
          enableQuickIssueCreate={enableQuickIssueCreate}
          addIssuesToView={addIssuesToView}
          canEditProperties={canEditProperties}
          quickAddCallback={quickAddCallback}
          scrollableContainerRef={scrollableContainerRef}
          isEpic={isEpic}
        />
      )}
    </div>
  );
});
