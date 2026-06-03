/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sub-issue hierarchy contracts modeling the parent/child tree (`TIssue.parent_id`
 * self-reference on `apps/api/plane/db/models/issue.py::Issue`), the state-group
 * rollup from `apps/api/plane/app/views/issue/sub_issue.py`, and the panel
 * operations callback used by `apps/web/core/store/issue/issue-details/sub_issues.store.ts`
 * and `apps/web/core/components/issues/issue-detail-widgets/sub-issues/`.
 */

import type { TIssue } from "./issue";

/**
 * Child issue ids bucketed by workflow state group (bound to `TStateGroups`),
 * used to render the multi-segment progress bar; buckets hold ids rather than
 * counts so the UI can deep-link from a segment back to its contributing issues.
 */
export type TSubIssuesStateDistribution = {
  /** Backlog (newly created, untriaged). */
  backlog: string[];
  /** Unstarted (triaged but not started). */
  unstarted: string[];
  /** Started (work in progress). */
  started: string[];
  /** Completed (work finished and accepted). */
  completed: string[];
  /** Cancelled (closed without completion). */
  cancelled: string[];
};

/**
 * Combined sub-issue payload returned by `GET /sub-issues/`, embedding both the
 * state-distribution rollup and the child issue records in one round trip.
 */
export type TIssueSubIssues = {
  state_distribution: TSubIssuesStateDistribution;
  sub_issues: TSubIssueResponse;
};

/**
 * Sub-issues list response: either a flat array (ungrouped view) or a record
 * keyed by an arbitrary group discriminator; consumers MUST narrow with a
 * runtime check (e.g. `Array.isArray`) before iterating.
 */
export type TSubIssueResponse = TIssue[] | { [key: string]: TIssue[] };

/**
 * Memoization map of `issue_id → TSubIssuesStateDistribution` so re-opening a
 * parent's sub-issue panel skips the rollup fetch when not invalidated.
 */
export type TIssueSubIssuesStateDistributionMap = {
  [issue_id: string]: TSubIssuesStateDistribution;
};

/**
 * Memoization map of `issue_id → ordered child id list`, joined with the flat
 * issue store at render time to keep state normalized.
 */
export type TIssueSubIssuesIdMap = {
  [issue_id: string]: string[];
};

/**
 * Action-handler bundle the issue detail page passes to the sub-issue panel so
 * the panel stays container-agnostic across detail/peek/modal surfaces. NOTE:
 * `removeSubIssue` un-links by nulling `parent_id` (issue preserved), while
 * `deleteSubIssue` performs a DB-level destroy (irreversible).
 */
export type TSubIssueOperations = {
  /** Copies the canonical sub-issue link path to the clipboard. */
  copyLink: (path: string) => void;
  /** Fetches the sub-issues for a parent; state mutation lives in the consuming store. */
  fetchSubIssues: (workspaceSlug: string, projectId: string, parentIssueId: string) => Promise<void>;
  /** Bulk-links existing issues as children of the parent. */
  addSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueIds: string[]) => Promise<void>;
  /**
   * Updates a child issue through the parent panel; `oldIssue` enables
   * optimistic rollback and `fromModal` toggles activity-log behavior server-side.
   */
  updateSubIssue: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue?: Partial<TIssue>,
    fromModal?: boolean
  ) => Promise<void>;
  /** Un-links a child (nulls `parent_id`, preserves the issue); distinct from `deleteSubIssue`. */
  removeSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
  /** Destroys the child issue entirely (DB DELETE, irreversible); distinct from `removeSubIssue`. */
  deleteSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
};
