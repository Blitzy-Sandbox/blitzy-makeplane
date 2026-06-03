/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the inline state/priority/assignees editor for a single related issue row.
 *
 * Rendered purpose: dispatches edits to a related issue's state, priority, and assignees through three
 * fixed-height dropdowns, funneling every mutation through a parent-supplied
 * `TRelationIssueOperations.update` callback so that toast emission and API dispatch live alongside the
 * caller's other relation operations.
 *
 * Required props:
 *   - workspaceSlug (string): identifies the workspace whose issue is being edited; forwarded to `update`.
 *   - issueId (string): the related issue id (the one being edited — not the parent issue that owns the
 *     relation).
 *   - disabled (boolean): when true, all three dropdowns are read-only.
 *   - issueOperations (TRelationIssueOperations): supplies the `update(workspaceSlug, projectId, issueId,
 *     data)` callback; sourced from `useRelationOperations(...)` in
 *     `../issue-detail-widgets/relations/helper`. Only `update` is consumed here; `copyLink` and `remove`
 *     are ignored.
 *
 * Optional props:
 *   - issueServiceType (TIssueServiceType, default `EIssueServiceType.ISSUES`): switches
 *     `useIssueDetail` between the work-item issue-detail store (`ISSUES`) and the epic issue-detail
 *     store (`EPICS`), so this single component drives both surfaces.
 *
 * MobX stores read:
 *   - useIssueDetail(issueServiceType) — reads `issue.getIssueById(issueId)` to resolve the related
 *     issue's current `state_id`, `priority`, `project_id`, and `assignee_ids`. Reactivity is opt-in via
 *     `observer`, so the row re-renders when any of these observable fields change.
 *
 * Side effects:
 *   - Three update paths, all funneled through `issueOperations.update`:
 *       - `state_id` (from `StateDropdown` in `@/components/dropdowns/state/dropdown`)
 *       - `priority` (from `PriorityDropdown` in `@/components/dropdowns/priority`)
 *       - `assignee_ids` (from `MemberDropdown` in `@/components/dropdowns/member/dropdown`, configured
 *         with `multiple`)
 *   - Each handler is gated on `issue.project_id` being truthy because the underlying issue-detail
 *     `updateIssue` action requires a project context — dispatch is suppressed otherwise.
 *   - Toast emission and the actual API call are encapsulated inside `useRelationOperations`
 *     (`apps/web/core/components/issues/issue-detail-widgets/relations/helper.tsx`), which wraps
 *     `useIssueDetail.updateIssue` with success/error toasts via `@plane/propel/toast`.
 *   - No navigations.
 *
 * Render gating: returns an empty fragment if the related issue cannot be resolved from the issue-detail
 * store (e.g. during a deletion race).
 *
 * Consumers:
 *   - `./issue-list-item.tsx` (`RelationIssueListItem`) — the only caller; renders one
 *     `RelationIssueProperty` inside each relation row to provide inline state/priority/assignee edits.
 */

import React from "react";
import { observer } from "mobx-react";
// components
import type { TIssuePriorities, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TRelationIssueOperations } from "../issue-detail-widgets/relations/helper";

type Props = {
  workspaceSlug: string;
  issueId: string;
  disabled: boolean;
  issueOperations: TRelationIssueOperations;
  issueServiceType?: TIssueServiceType;
};

export const RelationIssueProperty = observer(function RelationIssueProperty(props: Props) {
  const { workspaceSlug, issueId, disabled, issueOperations, issueServiceType = EIssueServiceType.ISSUES } = props;
  // hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail(issueServiceType);

  // derived value
  const issue = getIssueById(issueId);

  // if issue is not found, return empty
  if (!issue) return <></>;

  // handlers
  const handleStateChange = (val: string) =>
    issue.project_id &&
    issueOperations.update(workspaceSlug, issue.project_id, issueId, {
      state_id: val,
    });

  const handlePriorityChange = (val: TIssuePriorities) =>
    issue.project_id &&
    issueOperations.update(workspaceSlug, issue.project_id, issueId, {
      priority: val,
    });

  const handleAssigneeChange = (val: string[]) =>
    issue.project_id &&
    issueOperations.update(workspaceSlug, issue.project_id, issueId, {
      assignee_ids: val,
    });

  return (
    <div className="relative flex items-center gap-2">
      <div className="h-5 flex-shrink-0">
        <StateDropdown
          value={issue.state_id}
          projectId={issue.project_id ?? undefined}
          onChange={handleStateChange}
          disabled={disabled}
          buttonVariant="border-with-text"
        />
      </div>

      <div className="h-5 flex-shrink-0">
        <PriorityDropdown
          value={issue.priority}
          onChange={handlePriorityChange}
          disabled={disabled}
          buttonVariant="border-without-text"
          buttonClassName="border"
        />
      </div>

      <div className="h-5 flex-shrink-0">
        <MemberDropdown
          value={issue.assignee_ids}
          projectId={issue.project_id ?? undefined}
          onChange={handleAssigneeChange}
          disabled={disabled}
          multiple
          buttonVariant={(issue?.assignee_ids || []).length > 0 ? "transparent-without-text" : "border-without-text"}
          buttonClassName={(issue?.assignee_ids || []).length > 0 ? "hover:bg-transparent px-0" : ""}
        />
      </div>
    </div>
  );
});
