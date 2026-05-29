/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Scrollable list-view viewport that renders all grouped columns + bulk selection wrapper.
 *
 * Rendered purpose: receives the fully prepared grouped issue model from `BaseListRoot`, computes the
 * grouping column descriptors via `getGroupByColumns`, mounts a `MultipleSelectGroup` selection
 * coordinator over the scroll container, and renders one `<ListGroup>` per group plus
 * `<IssueBulkOperationsRoot>`.
 *
 * Props (IList):
 *   - groupedIssueIds (TGroupedIssues, required): issue ids partitioned by group; the canonical "ALL_ISSUES"
 *     key holds the flat list when grouping is disabled
 *   - issuesMap (TIssueMap, required): global issue-id → TIssue lookup map; passed-through to each ListGroup
 *   - group_by (TIssueGroupByOptions | null, required): the active group key; `null` means flat-list rendering
 *   - orderBy (TIssueOrderByOptions | undefined, required): the active sort key
 *   - updateIssue (callback, optional): per-issue update fn used by inline editors and quick actions
 *   - quickActions (TRenderQuickActions, required): the scope-specific quick-actions render function
 *   - displayProperties (IIssueDisplayProperties | undefined, required): visibility flags for columns
 *   - enableIssueQuickAdd (boolean, required): toggle for the sticky quick-add row at the bottom of a group
 *   - showEmptyGroup (boolean, optional): whether empty groups should still render their header
 *   - canEditProperties ((projectId) => boolean, required): per-project edit-permission predicate
 *   - quickAddCallback (optional): the store action invoked by the quick-add form when a user submits
 *   - disableIssueCreation (boolean, optional): hard-disables the quick-add affordance
 *   - handleOnDrop ((source, destination) => Promise<void>, required): the drag-end handler from
 *     `useGroupIssuesDragNDrop`
 *   - addIssuesToView (optional): callback for adding existing issues to the view (cycle/module scope)
 *   - isCompletedCycle (boolean, optional, default=false): when true, creates/edits are disabled
 *   - loadMoreIssues ((groupId?) => void, required): paginates the next page of issues for a group
 *   - handleCollapsedGroups ((groupId) => void, required): toggles a group's collapsed state in the
 *     kanban-filters slice
 *   - collapsedGroups (TIssueKanbanFilters, required): the currently collapsed group ids
 *   - isEpic (boolean, optional, default=false): switches identifiers/links to epic semantics
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the active store type for column scope computation
 *   - `useBulkOperationStatus()` (plane-web hook) gates the multi-select group on enterprise builds
 *
 * Side effects:
 *   - `useEffect` registers `autoScrollForElements({ element: containerRef.current })` from
 *     `@atlaskit/pragmatic-drag-and-drop-auto-scroll/element` so the scroll viewport auto-scrolls during
 *     drag operations; the cleanup unregisters the auto-scroll handler
 *
 * Consumers: `BaseListRoot` (this folder's parent shell).
 */

import { useEffect, useRef } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane constants
import { ALL_ISSUES } from "@plane/constants";
// types
import type {
  GroupByColumnTypes,
  TGroupedIssues,
  TIssue,
  IIssueDisplayProperties,
  TIssueMap,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  IGroupByColumn,
  TIssueKanbanFilters,
} from "@plane/types";
// components
import { MultipleSelectGroup } from "@/components/core/multiple-select";
// hooks
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// plane web components
import { IssueBulkOperationsRoot } from "@/plane-web/components/issues/bulk-operations";
// plane web hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";
// utils
import type { GroupDropLocation } from "../utils";
import { getGroupByColumns, isWorkspaceLevel, isSubGrouped } from "../utils";
import { ListGroup } from "./list-group";
import type { TRenderQuickActions } from "./list-view-types";

/** Props for `List`. See the module-level JSDoc for full semantics. */
export interface IList {
  groupedIssueIds: TGroupedIssues;
  issuesMap: TIssueMap;
  group_by: TIssueGroupByOptions | null;
  orderBy: TIssueOrderByOptions | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  enableIssueQuickAdd: boolean;
  showEmptyGroup?: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  disableIssueCreation?: boolean;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  isCompletedCycle?: boolean;
  loadMoreIssues: (groupId?: string) => void;
  handleCollapsedGroups: (value: string) => void;
  collapsedGroups: TIssueKanbanFilters;
  isEpic?: boolean;
}

/** Scrollable list-view viewport; see the module-level JSDoc for full semantics. */
export const List = observer(function List(props: IList) {
  const {
    groupedIssueIds,
    issuesMap,
    group_by,
    orderBy,
    updateIssue,
    quickActions,
    displayProperties,
    enableIssueQuickAdd,
    showEmptyGroup,
    canEditProperties,
    quickAddCallback,
    disableIssueCreation,
    handleOnDrop,
    addIssuesToView,
    isCompletedCycle = false,
    loadMoreIssues,
    handleCollapsedGroups,
    collapsedGroups,
    isEpic = false,
  } = props;

  const storeType = useIssueStoreType();
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();

  const containerRef = useRef<HTMLDivElement | null>(null);

  const groups = getGroupByColumns({
    groupBy: group_by as GroupByColumnTypes,
    includeNone: true,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
    isEpic: isEpic,
  });

  // Enable Auto Scroll for Main Kanban
  useEffect(() => {
    const element = containerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, [containerRef]);

  if (!groups) return null;

  const getGroupIndex = (groupId: string | undefined) => groups.findIndex(({ id }) => id === groupId);

  const is_list = group_by === null ? true : false;

  // create groupIds array and entities object for bulk ops
  const groupIds = groups.map((g) => g.id);
  const orderedGroups: Record<string, string[]> = {};
  groupIds.forEach((gID) => {
    orderedGroups[gID] = [];
  });
  let entities: Record<string, string[]> = {};

  // entities map for MultipleSelectGroup: list mode collapses to a single bucket keyed by the synthetic
  // group id; sub-grouped layouts intentionally fall through to an empty per-group map (bulk-select is
  // disabled across sub-groups); otherwise we use the grouped index as-is.
  if (is_list) {
    entities = Object.assign(orderedGroups, { [groupIds[0]]: groupedIssueIds[ALL_ISSUES] ?? [] });
  } else if (!isSubGrouped(groupedIssueIds)) {
    entities = Object.assign(orderedGroups, { ...groupedIssueIds });
  } else {
    entities = orderedGroups;
  }
  return (
    <div className="relative flex size-full flex-col">
      {groups && (
        <MultipleSelectGroup
          containerRef={containerRef}
          entities={entities}
          disabled={!isBulkOperationsEnabled || isEpic}
        >
          {(helpers) => (
            <>
              <div
                ref={containerRef}
                className="vertical-scrollbar relative scrollbar-lg size-full overflow-auto bg-surface-1"
              >
                {groups.map((group: IGroupByColumn) => (
                  <ListGroup
                    key={group.id}
                    groupIssueIds={groupedIssueIds?.[group.id]}
                    issuesMap={issuesMap}
                    group_by={group_by}
                    group={group}
                    updateIssue={updateIssue}
                    quickActions={quickActions}
                    orderBy={orderBy}
                    getGroupIndex={getGroupIndex}
                    handleOnDrop={handleOnDrop}
                    displayProperties={displayProperties}
                    enableIssueQuickAdd={enableIssueQuickAdd}
                    showEmptyGroup={showEmptyGroup}
                    canEditProperties={canEditProperties}
                    quickAddCallback={quickAddCallback}
                    disableIssueCreation={disableIssueCreation}
                    addIssuesToView={addIssuesToView}
                    isCompletedCycle={isCompletedCycle}
                    loadMoreIssues={loadMoreIssues}
                    containerRef={containerRef}
                    selectionHelpers={helpers}
                    handleCollapsedGroups={handleCollapsedGroups}
                    collapsedGroups={collapsedGroups}
                    isEpic={isEpic}
                  />
                ))}
              </div>

              <IssueBulkOperationsRoot selectionHelpers={helpers} />
            </>
          )}
        </MultipleSelectGroup>
      )}
    </div>
  );
});
