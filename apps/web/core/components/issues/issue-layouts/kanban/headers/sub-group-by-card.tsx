/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky subgroup row header for the Kanban swimlane variant.
 *
 * Rendered purpose: renders the title, count, optional icon, collapse/expand affordance, and the
 * nested workflow tree for one subgroup row inside the two-dimensional swimlane board. The entire
 * header card is itself the click target for the collapse toggle.
 *
 * Props (`IHeaderSubGroupByCard`):
 *   - column_id (string, required): the subgroup's canonical id (state id, priority enum,
 *     assignee id, etc.) used for collapse-state lookups and the workflow tree.
 *   - title (string, required): the human-readable subgroup label rendered in the header.
 *   - count (number, required): the issue count to display next to the title; falls back to 0 if
 *     falsy at render time.
 *   - icon (React.ReactNode, optional): custom icon for this subgroup; when absent falls back to
 *     `Circle` from `lucide-react`.
 *   - sub_group_by (TIssueGroupByOptions | undefined, required): the active sub-grouping mode;
 *     forwarded into `WorkFlowGroupTree` so the workflow context matches the row's grouping.
 *   - collapsedGroups (TIssueKanbanFilters, required): the collapsed-group state slice from the
 *     kanban filters, consulted to determine chevron direction.
 *   - handleCollapsedGroups ((toggle, value) => void, required): collapse toggle callback wired
 *     up by `base-kanban-root.tsx` which persists the toggle via `updateFilters`.
 *
 * MobX stores read: none directly — the component is purely presentational based on its props.
 * It is wrapped in `mobx-react`'s `observer` solely so re-renders propagate when the parent passes
 * MobX-managed props (e.g. `collapsedGroups`) that mutate observably.
 *
 * Side effects:
 *   - Clicking the entire row invokes `handleCollapsedGroups("sub_group_by", column_id)` which is
 *     ultimately persisted via `updateFilters(EIssueFilterType.KANBAN_FILTERS, …)` upstream.
 *   - No mutations, navigations, or API calls beyond the collapse callback.
 *
 * Conditional rendering details (the WHY):
 *   - The chevron switches between `ChevronDownIcon` (when this subgroup id is in
 *     `collapsedGroups.sub_group_by` — i.e. collapsed) and `ChevronUpIcon` (when expanded), both
 *     from `@plane/propel/icons`. The direction reflects the action the click would take
 *     ("expand downward to reveal" when collapsed; "collapse upward to hide" when expanded).
 *   - The icon slot falls back to a `Circle` outline from `lucide-react` when no custom `icon` is
 *     supplied, keeping the row's visual rhythm consistent regardless of source group type.
 *
 * Consumers:
 *   - `../swimlanes.tsx` (`SubGroupSwimlane`) — instantiates one `HeaderSubGroupByCard` per
 *     `sub_group_by` row above the nested `KanBan` board for that subgroup.
 */

import React from "react";
import { observer } from "mobx-react";
import { Circle } from "lucide-react";
import { ChevronDownIcon, ChevronUpIcon } from "@plane/propel/icons";
// Plane
import type { TIssueGroupByOptions, TIssueKanbanFilters } from "@plane/types";
// Plane-web
import { WorkFlowGroupTree } from "@/plane-web/components/workflow";
// mobx

/**
 * Props for `HeaderSubGroupByCard`.
 *
 * Strictly presentational; all collapse state mutation is delegated to the parent via
 * `handleCollapsedGroups`.
 */
interface IHeaderSubGroupByCard {
  icon?: React.ReactNode;
  title: string;
  count: number;
  column_id: string;
  collapsedGroups: TIssueKanbanFilters;
  sub_group_by: TIssueGroupByOptions | undefined;
  handleCollapsedGroups: (toggle: "group_by" | "sub_group_by", value: string) => void;
}

/** Sticky subgroup row header for the Kanban swimlane variant; see the module-level JSDoc for full semantics. */
export const HeaderSubGroupByCard = observer(function HeaderSubGroupByCard(props: IHeaderSubGroupByCard) {
  const { icon, title, count, column_id, collapsedGroups, sub_group_by, handleCollapsedGroups } = props;
  return (
    <div
      className={`relative flex w-full flex-shrink-0 cursor-pointer flex-row items-center gap-1 rounded-xs py-1.5`}
      onClick={() => handleCollapsedGroups("sub_group_by", column_id)}
    >
      <div className="flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xs transition-all hover:bg-layer-1">
        {collapsedGroups?.sub_group_by.includes(column_id) ? (
          <ChevronDownIcon width={14} strokeWidth={2} />
        ) : (
          <ChevronUpIcon width={14} strokeWidth={2} />
        )}
      </div>

      <div className="flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xs">
        {icon ? icon : <Circle width={14} strokeWidth={2} />}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 text-13">
        <div className="line-clamp-1 text-primary">{title}</div>
        <div className="pl-2 text-13 font-medium text-tertiary">{count || 0}</div>
      </div>

      <WorkFlowGroupTree groupBy={sub_group_by} groupId={column_id} />
    </div>
  );
});
