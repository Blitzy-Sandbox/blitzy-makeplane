/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Activity & comment timeline body for the issue detail page.
 *
 * Rendered purpose: resolves the combined activity-and-comments collection for the current work
 * item from the issue-detail store (sorted ascending or descending per the caller-supplied
 * `sortOrder`), shows a skeleton (`IssueActivityLoader`) while the collection is still loading,
 * returns `null` when it is empty, otherwise applies the caller's `selectedFilters` and dispatches
 * each surviving entry to the appropriate specialized renderer in a single flat `<div>` feed.
 *
 * Props (TIssueActivityCommentRoot):
 *   - workspaceSlug (string, required): scopes the rendered links and reaction mutations
 *   - projectId (string, required): scopes the rendered cards
 *   - isIntakeIssue (boolean, required): when true, comment cards hide the "copy link" action
 *     (intake comments are private to the intake flow and the copy-link UX is not meaningful)
 *   - issueId (string, required): the work item whose feed is rendered
 *   - selectedFilters (TActivityFilters[], required): the currently active activity-type filters
 *     (e.g., ALL_ACTIVITY, COMMENTS, WORKLOG); used by `filterActivityOnSelectedFilters` from
 *     `@plane/constants` to suppress entries the user has toggled off
 *   - activityOperations (TCommentsOperations, required): comment & reaction operations contract
 *     (typically built via `useWorkItemCommentOperations` in `./root.tsx`)
 *   - showAccessSpecifier (boolean, optional): exposes the "external vs internal" comment toggle on
 *     each card — passed by `./root.tsx` as `!!project.anchor` (true only when the project is
 *     publicly published)
 *   - disabled (boolean, optional): when true, comment cards become read-only
 *   - sortOrder (E_SORT_ORDER, required): ASC | DESC — drives the store-side sort of the
 *     activity-and-comments collection
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `activity.getActivityAndCommentsByIssueId(issueId, sortOrder)` to fetch
 *     the merged sequence; `comment.getCommentById(activityComment.id)` to resolve the full
 *     comment record (with rich-text body + reactions) for `CommentCard`
 *
 * Backend provenance:
 *   - The activity rows surfaced through `getActivityAndCommentsByIssueId` originate from
 *     `IssueActivity` records persisted by `apps/api`. The `issue_activities_task.py` Celery task
 *     consumes signal-driven activity events and writes them via the 28-entry `ACTIVITY_MAPPER`
 *     dispatch table (one handler per event type — created, updated, state-changed, assignee-added,
 *     etc.). This component is the rendering surface for that pipeline; the activity payload shape
 *     follows the `ACTIVITY_MAPPER` handler output.
 *
 * Side effects: none directly — every child renderer carries its own mutation contract. The
 * comment cards mutate via `activityOperations`; the worklog card mutates via its own store hook;
 * the additional-properties activity card is purely presentational.
 *
 * Derived state notes:
 *   - The timeline edge metadata (`ends="top" | "bottom" | undefined`) is recomputed inside the
 *     `.map(...)` callback against the `filteredActivityAndComments` array — the first surviving
 *     entry is `"top"`, the last is `"bottom"`, everything in between is `undefined`. Child cards
 *     use this hint to draw the connecting vertical line in the stacked feed (the top entry omits
 *     the top connector; the bottom entry omits the bottom connector).
 *
 * Dispatch contract: the activity-type ternary chain inside `.map(...)` routes each entry to its
 * specialized renderer:
 *   - `"COMMENT"` → `<CommentCard>` (rich-text comment with reactions / replies)
 *   - any `BASE_ACTIVITY_FILTER_TYPES` value (state / priority / assignee / etc.) → `<IssueActivityItem>`
 *     (the dispatcher in `./activity/activity-list.tsx`)
 *   - `"ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY"` → `<IssueAdditionalPropertiesActivity>` (proprietary
 *     custom-properties activity card from the plane-web surface)
 *   - `"WORKLOG"` → `<IssueActivityWorklog>` (worklog activity card from the plane-web surface)
 *   - any other type → empty fragment (silently dropped — the surrounding key/index logic still
 *     advances so the `ends` metadata of preceding/following entries stays correct)
 *
 * Consumers: rendered by `./root.tsx` (`IssueActivityRoot`) as the activity timeline body of the
 * issue-detail page.
 */

import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById },
  } = useIssueDetail();
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

  return (
    <div>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        // Dispatch by activity_type: comments → CommentCard, base activity types →
        // IssueActivityItem (the ./activity/activity-list dispatcher), additional-properties events
        // → IssueAdditionalPropertiesActivity, worklog rows → IssueActivityWorklog. Unknown types
        // render an empty fragment so the surrounding `ends` metadata stays correct.
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
          <IssueAdditionalPropertiesActivity
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "WORKLOG" ? (
          <IssueActivityWorklog
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            activityComment={activityComment}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : (
          <></>
        );
      })}
    </div>
  );
});
