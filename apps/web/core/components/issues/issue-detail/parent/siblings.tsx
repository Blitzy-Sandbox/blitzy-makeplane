/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sibling work-items panel rendered inside the parent overflow menu.
 *
 * Rendered purpose: when the user opens the parent-strip overflow menu, this panel lists every
 * sibling of the current work item — i.e., the other sub-issues that share the same parent.
 * Filters out the current issue so the user only sees navigable peers. Renders one of three
 * mutually-exclusive states: a "Loading" placeholder while the sub-issues fetch is in flight, a
 * list of `IssueParentSiblingItem` rows when at least one sibling exists, or a "No sibling work
 * items" placeholder when the parent has only this one child.
 *
 * Props (TIssueParentSiblings, exported):
 *   - workspaceSlug (string, required): scopes the sub-issues fetch and is propagated to each row
 *   - currentIssue (TIssue, required): the active work item — its id is the de-duplication key
 *     used to suppress the current issue from the sibling list
 *   - parentIssue (TIssue, required): the parent work item — its `id` and `project_id` are used
 *     both as the SWR cache key and the fetch parameters
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `fetchSubIssues` (action that hits the parent's sub-issues endpoint and
 *     populates the sub-issues map) and `subIssues.subIssuesByIssueId(parentIssue.id)` (resolver
 *     returning the array of sibling ids keyed by parent id).
 *
 * Side effects:
 *   - SWR-backed fetch via `useSWR(key, fetcher)` where:
 *       - Cache key (composed inline): `ISSUE_PARENT_CHILD_ISSUES_${workspaceSlug}_${parentIssue.project_id}_${parentIssue.id}` —
 *         intentionally namespaces the cache by workspace + parent project + parent id so that
 *         (a) different workspaces never collide, (b) parent moves between projects re-fetch, and
 *         (c) the cache is shareable across multiple `IssueParentSiblings` mounts for the same parent.
 *       - Fetcher: `() => fetchSubIssues(workspaceSlug, parentIssue.project_id!, parentIssue.id)` —
 *         this routes through the issue-detail store, which calls `IssueService.fetchSubIssues`
 *         against `apps/api`'s `/issues/<id>/sub-issues/` endpoint.
 *       - Both the key and fetcher short-circuit to `null` when `parentIssue` or
 *         `parentIssue.project_id` is missing — SWR skips the request in that case.
 *   - No mutations; this component is read-only.
 *   - No toasts; SWR error handling falls back to the empty-list rendering (`subIssueIds`
 *     remains `undefined`, the empty-state branch renders "No sibling work items").
 *
 * Conditional rendering:
 *   - `isLoading` (from SWR) drives the loading-state branch.
 *   - `subIssueIds && subIssueIds.length > 0` drives the list-rendering branch.
 *   - The list filters with `currentIssue.id != issueId` (loose-equality intentional — preserve
 *     verbatim) so the current issue never appears as a sibling of itself.
 *   - Falls through to the empty-state branch otherwise.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/parent/root.tsx` mounts this inside the
 *     `<CustomMenu>` overflow menu of the parent summary strip.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
import type { TIssue } from "@plane/types";
// components
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import { IssueParentSiblingItem } from "./sibling-item";

export type TIssueParentSiblings = {
  workspaceSlug: string;
  currentIssue: TIssue;
  parentIssue: TIssue;
};

export const IssueParentSiblings = observer(function IssueParentSiblings(props: TIssueParentSiblings) {
  const { workspaceSlug, currentIssue, parentIssue } = props;
  // hooks
  const {
    fetchSubIssues,
    subIssues: { subIssuesByIssueId },
  } = useIssueDetail();

  const { isLoading } = useSWR(
    parentIssue && parentIssue.project_id
      ? `ISSUE_PARENT_CHILD_ISSUES_${workspaceSlug}_${parentIssue.project_id}_${parentIssue.id}`
      : null,
    parentIssue && parentIssue.project_id
      ? () => fetchSubIssues(workspaceSlug, parentIssue.project_id!, parentIssue.id)
      : null
  );

  const subIssueIds = (parentIssue && subIssuesByIssueId(parentIssue.id)) || undefined;

  return (
    <div className="my-1">
      {isLoading ? (
        <div className="flex items-center gap-2 px-1 py-1 text-left text-11 whitespace-nowrap text-secondary">
          Loading
        </div>
      ) : subIssueIds && subIssueIds.length > 0 ? (
        subIssueIds.map(
          (issueId) =>
            currentIssue.id != issueId && (
              <IssueParentSiblingItem key={issueId} workspaceSlug={workspaceSlug} issueId={issueId} />
            )
        )
      ) : (
        <div className="flex items-center gap-2 px-1 py-1 text-left text-11 whitespace-nowrap text-secondary">
          No sibling work items
        </div>
      )}
    </div>
  );
});
