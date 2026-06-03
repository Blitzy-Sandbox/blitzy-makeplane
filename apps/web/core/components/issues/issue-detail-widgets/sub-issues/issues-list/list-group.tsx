/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * SubIssuesListGroup — collapsible container for a single bucket of sub-issues inside the sub-issues list. Renders
 * a clickable group header (chevron + group icon + name + count) for named groups, suppresses the header entirely
 * for the aggregate `ALL_ISSUES` bucket, and delegates row rendering to one `SubIssuesListItem` per work-item id.
 *
 * Props (see `TSubIssuesListGroupProps` below):
 *   - workItemIds: string[] (required) — the sub-issue ids that belong to this group; if empty the component
 *     short-circuits to `null` so `root.tsx` can map over every group bucket without filtering empties first.
 *   - projectId: string (required) — project that owns the sub-issues; forwarded down to each row for store scoping.
 *   - workspaceSlug: string (required) — workspace slug from the URL; forwarded down for routing and API calls.
 *   - group: IGroupByColumn (required) — group metadata (id, name, icon) used to render the header. `group.id` is
 *     compared against the `ALL_ISSUES` sentinel to decide whether to suppress the header.
 *   - serviceType: TIssueServiceType (required) — selects the issue-detail store variant (issues vs. epics) used
 *     by child rows.
 *   - canEdit: boolean (required) — gates mutation affordances; forwarded down so each row's overflow menu and
 *     inline property dropdowns reflect the same permission.
 *   - parentIssueId: string (required) — id of the immediate parent issue in the recursion.
 *   - rootIssueId: string (required) — id of the topmost issue for filter scoping (used by the recursion
 *     anti-loop check inside `SubIssuesListItem`).
 *   - handleIssueCrudState: ("create" | "existing" | "update" | "delete", issueId, issue?) => void (required) —
 *     upstream CRUD modal state toggler owned by `../content.tsx`; forwarded down to row actions unchanged.
 *   - subIssueOperations: TSubIssueOperations (required) — sub-issue mutation bundle (copyLink, removeSubIssue,
 *     updateSubIssue, fetchSubIssues, …); forwarded down to row actions unchanged.
 *   - storeType?: EIssuesStoreType (optional, defaults to `EIssuesStoreType.PROJECT`) — forwarded down for store
 *     selection in nested recursive mounts.
 *   - spacingLeft?: number (optional, defaults to `0`) — pixel indent forwarded down to each row; nested recursion
 *     levels increment this inside `SubIssuesListItem`.
 *
 * MobX stores read:
 *   None directly. This component is purely presentational/layout — all store reads happen in the parent
 *   (`SubIssuesListRoot` in `./root.tsx`) and the child (`SubIssuesListItem` in `./list-item.tsx`). The
 *   `observer` HOC wraps the component only for consistency with the surrounding tree so that re-renders
 *   triggered by descendants are not blocked by an opaque parent.
 *
 * Side effects:
 *   - Local UI state only: `isCollapsibleOpen` (initialised to `true`, i.e. groups open on first mount) is
 *     flipped by `Collapsible.onToggle` to expand/collapse the group.
 *   - No API calls, no MobX mutations, no navigation triggered here. All such effects are deferred to
 *     `SubIssuesListItem` via the `subIssueOperations` and `handleIssueCrudState` prop forwards.
 *
 * `ALL_ISSUES` aggregate behavior:
 *   When `group.id === ALL_ISSUES` (the sentinel from `@plane/constants` used when no grouping is active or at
 *   nested recursion levels where grouping is intentionally disabled), the header block is suppressed by passing
 *   `false` as the `Collapsible.title` prop and the toggle button is hidden via `buttonClassName`. The
 *   `Collapsible` itself remains rendered as a transparent wrapper so the rows render flush — this lets the
 *   "no group_by selected" and "nested recursion" call paths share this component without a separate branch
 *   in `root.tsx`.
 *
 * Empty group handling:
 *   When `workItemIds.length === 0` the component returns `null` — no header, no empty placeholder, no toggle
 *   button. This intentionally keeps the consumer in `root.tsx` free to render every bucket returned by
 *   `getGroupByColumns` without pre-filtering.
 *
 * Consumers:
 *   - Rendered exclusively from `apps/web/core/components/issues/issue-detail-widgets/sub-issues/issues-list/root.tsx`
 *     (inside the `SubIssuesListRoot` group-mapping `groups.map(...)` block) — one instance per group bucket
 *     returned by `getGroupByColumns`.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { CircleDashed } from "lucide-react";
import { ALL_ISSUES } from "@plane/constants";
import { ChevronRightIcon } from "@plane/propel/icons";
import type { IGroupByColumn, TIssue, TIssueServiceType, TSubIssueOperations } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { Collapsible } from "@plane/ui";
import { cn } from "@plane/utils";
import { SubIssuesListItem } from "./list-item";

interface TSubIssuesListGroupProps {
  workItemIds: string[];
  projectId: string;
  workspaceSlug: string;
  group: IGroupByColumn;
  serviceType: TIssueServiceType;
  canEdit: boolean;
  parentIssueId: string;
  rootIssueId: string;
  handleIssueCrudState: (
    key: "create" | "existing" | "update" | "delete",
    issueId: string,
    issue?: TIssue | null
  ) => void;
  subIssueOperations: TSubIssueOperations;
  storeType?: EIssuesStoreType;
  spacingLeft?: number;
}

export const SubIssuesListGroup = observer(function SubIssuesListGroup(props: TSubIssuesListGroupProps) {
  const {
    group,
    serviceType,
    canEdit,
    parentIssueId,
    rootIssueId,
    projectId,
    workspaceSlug,
    handleIssueCrudState,
    subIssueOperations,
    workItemIds,
    storeType = EIssuesStoreType.PROJECT,
    spacingLeft = 0,
  } = props;

  const isAllIssues = group.id === ALL_ISSUES;

  // states
  const [isCollapsibleOpen, setIsCollapsibleOpen] = useState(true);

  if (!workItemIds.length) return null;

  return (
    <>
      <Collapsible
        isOpen={isCollapsibleOpen}
        onToggle={() => setIsCollapsibleOpen(!isCollapsibleOpen)}
        title={
          !isAllIssues && (
            <div className="flex items-center gap-2 p-3">
              <ChevronRightIcon
                className={cn("size-3.5 text-placeholder transition-all", {
                  "rotate-90": isCollapsibleOpen,
                })}
                strokeWidth={2.5}
              />
              <div className="grid flex-shrink-0 place-items-center overflow-hidden">
                {group.icon ?? <CircleDashed className="size-3.5" strokeWidth={2} />}
              </div>
              <span className="text-13 font-medium text-primary">{group.name}</span>
              <span className="text-13 text-placeholder">{workItemIds.length}</span>
            </div>
          )
        }
        buttonClassName={cn("hidden", !isAllIssues && "block")}
      >
        {workItemIds?.map((workItemId) => (
          <SubIssuesListItem
            key={workItemId}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            parentIssueId={parentIssueId}
            rootIssueId={rootIssueId}
            issueId={workItemId}
            canEdit={canEdit}
            handleIssueCrudState={handleIssueCrudState}
            subIssueOperations={subIssueOperations}
            issueServiceType={serviceType}
            spacingLeft={spacingLeft}
            storeType={storeType}
          />
        ))}
      </Collapsible>
    </>
  );
});
