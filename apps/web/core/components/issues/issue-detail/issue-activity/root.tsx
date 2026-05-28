/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestrator for the issue detail activity panel.
 *
 * Rendered purpose: assembles the header (activity title + worklog create button + sort toggle +
 * filter selector) and body (memoized comment composer + the activity/comment feed via
 * `IssueActivityCommentRoot`) for a single work item. Persists user filter and sort preferences
 * to local storage so they survive page navigation, enforces a "≥ 1 filter must always be selected"
 * invariant via `uniq` + length checks in `toggleFilter`, and gates the worklog create button by
 * project role + assignee status. Renders nothing until the project has resolved.
 *
 * Props (TIssueActivity):
 *   - workspaceSlug (string, required): scopes mutations and resolves the project
 *   - projectId (string, required): scopes mutations and resolves the project
 *   - issueId (string, required): the work item whose activity is rendered
 *   - disabled (boolean, optional, default=false): when true, the comment composer is suppressed
 *     and individual feed cards become read-only via `IssueActivityCommentRoot`
 *   - isIntakeIssue (boolean, optional, default=false): when true, suppresses the worklog button
 *     and tells `IssueActivityCommentRoot` to hide the per-comment "copy link" action
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` for the work item snapshot (used by the
 *     worklog-button permission gate)
 *   - `useUserPermissions()` — `getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId)`
 *     to derive `isAdmin` / `isGuest`
 *   - `useProject()` — `getProjectById(projectId)` for the project record (and its `anchor` field
 *     used to drive the comment access specifier)
 *   - `useUser()` — `data: currentUser` for the assignee membership check
 *
 * Side effects:
 *   - `useLocalStorage("issue_activity_filters", defaultActivityFilters)` — read + write of
 *     persisted filter set (browser localStorage; key is intentionally global across workspaces
 *     so the user's preference follows them).
 *   - `useLocalStorage("activity_sort_order", E_SORT_ORDER.ASC)` — read + write of persisted
 *     sort order (same storage layer; same global key).
 *   - All comment / reaction mutations and asset uploads are delegated to the
 *     `useWorkItemCommentOperations(...)` hook (which routes through the issue-detail store).
 *   - No direct toast emissions here; the operations contract emits toasts on completion.
 *
 * Derived state notes:
 *   - `isWorklogButtonEnabled = !isIntakeIssue && !isGuest && (isAdmin || isAssigned)` — guests
 *     can never log work; admins always can; non-admin members can only if they are an assignee.
 *   - `toggleFilter(filter)` always passes the new list through `uniq(...)` to defend against
 *     duplicated entries from the storage layer.
 *   - `renderCommentCreationBox` is memoized so the comment composer (which mounts a `@plane/editor`
 *     instance) is not torn down + remounted when the surrounding feed re-renders on every new
 *     activity entry.
 *
 * Imperative DOM / structural notes:
 *   - The comment composer is rendered EITHER above the feed (when `sortOrder === DESC`, so the
 *     composer is adjacent to the most recent entry) OR below the feed (when `sortOrder === ASC`,
 *     where the most recent entry is at the bottom) — never both. When `disabled` is true neither
 *     placement renders. Preserve this conditional structure exactly.
 *   - The header uses `ActivityFilterRoot` from `@/plane-web/components/issues/worklog/activity/filter-root`
 *     (the proprietary EE surface), NOT the sibling `./activity-filter.tsx`. The latter is the
 *     reusable presentational primitive used by `ActivityFilterRoot`.
 */

import { useMemo } from "react";
import uniq from "lodash-es/uniq";
import { observer } from "mobx-react";
// plane package imports
import type { TActivityFilters } from "@plane/constants";
import { E_SORT_ORDER, defaultActivityFilters, EUserPermissions } from "@plane/constants";
import { useLocalStorage } from "@plane/hooks";
// i18n
import { useTranslation } from "@plane/i18n";
//types
import type { TFileSignedURLResponse, TIssueComment } from "@plane/types";
// components
import { CommentCreate } from "@/components/comments/comment-create";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// plane web components
import { ActivityFilterRoot } from "@/plane-web/components/issues/worklog/activity/filter-root";
import { IssueActivityWorklogCreateButton } from "@/plane-web/components/issues/worklog/activity/worklog-create-button";
import { IssueActivityCommentRoot } from "./activity-comment-root";
import { useWorkItemCommentOperations } from "./helper";
import { ActivitySortRoot } from "./sort-root";

type TIssueActivity = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
  isIntakeIssue?: boolean;
};

/**
 * Legacy comment-operations contract retained for backward compatibility.
 *
 * NOTE: the active runtime contract used throughout this folder is `TCommentsOperations` from
 * `@plane/types` (constructed by `useWorkItemCommentOperations` in `./helper.tsx`). `TActivityOperations`
 * is the older shape that some consumer files may still import as a type alias. Both contracts are
 * structurally compatible for the four methods listed here; preserve the export verbatim — the
 * system boundary forbids removing public symbols.
 */
export type TActivityOperations = {
  createComment: (data: Partial<TIssueComment>) => Promise<TIssueComment>;
  updateComment: (commentId: string, data: Partial<TIssueComment>) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
  uploadCommentAsset: (blockId: string, file: File, commentId?: string) => Promise<TFileSignedURLResponse>;
};

export const IssueActivity = observer(function IssueActivity(props: TIssueActivity) {
  const { workspaceSlug, projectId, issueId, disabled = false, isIntakeIssue = false } = props;
  // i18n
  const { t } = useTranslation();
  // hooks
  const { setValue: setFilterValue, storedValue: selectedFilters } = useLocalStorage(
    "issue_activity_filters",
    defaultActivityFilters
  );
  const { setValue: setSortOrder, storedValue: sortOrder } = useLocalStorage("activity_sort_order", E_SORT_ORDER.ASC);
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();

  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  const { getProjectById } = useProject();
  const { data: currentUser } = useUser();
  // derived values
  const issue = issueId ? getIssueById(issueId) : undefined;
  const currentUserProjectRole = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
  const isAdmin = currentUserProjectRole === EUserPermissions.ADMIN;
  const isGuest = currentUserProjectRole === EUserPermissions.GUEST;
  const isAssigned = issue?.assignee_ids && currentUser?.id ? issue?.assignee_ids.includes(currentUser?.id) : false;
  const isWorklogButtonEnabled = !isIntakeIssue && !isGuest && (isAdmin || isAssigned);
  // toggle filter
  const toggleFilter = (filter: TActivityFilters) => {
    if (!selectedFilters) return;
    let _filters = [];
    if (selectedFilters.includes(filter)) {
      if (selectedFilters.length === 1) return selectedFilters; // Ensure at least one filter is applied
      _filters = selectedFilters.filter((f) => f !== filter);
    } else {
      _filters = [...selectedFilters, filter];
    }

    setFilterValue(uniq(_filters));
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === E_SORT_ORDER.ASC ? E_SORT_ORDER.DESC : E_SORT_ORDER.ASC);
  };

  // helper hooks
  const activityOperations = useWorkItemCommentOperations(workspaceSlug, projectId, issueId);

  const project = getProjectById(projectId);
  const renderCommentCreationBox = useMemo(
    () => (
      <CommentCreate
        workspaceSlug={workspaceSlug}
        entityId={issueId}
        activityOperations={activityOperations}
        showToolbarInitially
        projectId={projectId}
      />
    ),
    [workspaceSlug, issueId, activityOperations, projectId]
  );
  if (!project) return <></>;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="text-h5-medium text-primary">{t("common.activity")}</div>
        <div className="flex items-center gap-2">
          {isWorklogButtonEnabled && (
            <IssueActivityWorklogCreateButton
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              disabled={disabled}
            />
          )}
          <ActivitySortRoot sortOrder={sortOrder || E_SORT_ORDER.ASC} toggleSort={toggleSortOrder} />
          <ActivityFilterRoot
            selectedFilters={selectedFilters || defaultActivityFilters}
            toggleFilter={toggleFilter}
            isIntakeIssue={isIntakeIssue}
            projectId={projectId}
          />
        </div>
      </div>

      {/* rendering activity */}
      <div className="space-y-3">
        <div className="min-h-[200px]">
          <div className="space-y-3">
            {!disabled && sortOrder === E_SORT_ORDER.DESC && renderCommentCreationBox}
            <IssueActivityCommentRoot
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              isIntakeIssue={isIntakeIssue}
              issueId={issueId}
              selectedFilters={selectedFilters || defaultActivityFilters}
              activityOperations={activityOperations}
              showAccessSpecifier={!!project.anchor}
              disabled={disabled}
              sortOrder={sortOrder || E_SORT_ORDER.ASC}
            />
            {!disabled && sortOrder === E_SORT_ORDER.ASC && renderCommentCreationBox}
          </div>
        </div>
      </div>
    </div>
  );
});
