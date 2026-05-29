/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Adapter that converts an ordered list of issue IDs into `KanbanIssueBlock` children.
 *
 * Rendered purpose: iterates `issueIds`, skips falsy IDs defensively (server payloads can yield
 * sparse arrays during optimistic updates), and emits one `KanbanIssueBlock` per id with a stable
 * composite `draggableId`.
 *
 * MobX stores read: none directly — wrapped in `observer` solely because the parent passes
 * MobX-managed `issuesMap` and the component re-renders when `issueIds` changes.
 *
 * Side effects: none — purely structural.
 *
 * Composite `draggableId` construction (the WHY):
 *   - Base id is the `issueId`.
 *   - When `groupId` is present, appends `__<groupId>`.
 *   - When `sub_group_id` is present, appends `__<sub_group_id>`.
 *   The composite id ensures the same issue rendered in multiple lanes (e.g. an issue with multiple
 *   labels showing up in each label column) has a distinct DnD identity per lane.
 *
 * Lazy-render hint: the first 10 items pass `shouldRenderByDefault={index <= 10}` so their inner
 * `RenderIfVisible` in `./block.tsx` mounts immediately; items 11+ defer until intersection.
 *
 * Consumers:
 *   - `./kanban-group.tsx` — instantiates one `KanbanIssueBlocksList` per column to render the
 *     column's cards.
 */

import type { MutableRefObject } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { KanbanIssueBlock } from "./block";

/** Props for `KanbanIssueBlocksList`. */
interface IssueBlocksListProps {
  sub_group_id: string;
  groupId: string;
  issuesMap: IIssueMap;
  issueIds: string[];
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  isEpic?: boolean;
}

/** Adapter from issue IDs to `KanbanIssueBlock` children; see the module-level JSDoc. */
export const KanbanIssueBlocksList = observer(function KanbanIssueBlocksList(props: IssueBlocksListProps) {
  const {
    sub_group_id,
    groupId,
    issuesMap,
    issueIds,
    displayProperties,
    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    isEpic = false,
  } = props;

  return (
    <>
      {issueIds && issueIds.length > 0 ? (
        <>
          {issueIds.map((issueId, index) => {
            if (!issueId) return null;

            let draggableId = issueId;
            if (groupId) draggableId = `${draggableId}__${groupId}`;
            if (sub_group_id) draggableId = `${draggableId}__${sub_group_id}`;

            return (
              <KanbanIssueBlock
                key={draggableId}
                issueId={issueId}
                groupId={groupId}
                subGroupId={sub_group_id}
                shouldRenderByDefault={index <= 10}
                issuesMap={issuesMap}
                displayProperties={displayProperties}
                updateIssue={updateIssue}
                quickActions={quickActions}
                draggableId={draggableId}
                canDropOverIssue={canDropOverIssue}
                canDragIssuesInCurrentGrouping={canDragIssuesInCurrentGrouping}
                canEditProperties={canEditProperties}
                scrollableContainerRef={scrollableContainerRef}
                isEpic={isEpic}
              />
            );
          })}
        </>
      ) : null}
    </>
  );
});
