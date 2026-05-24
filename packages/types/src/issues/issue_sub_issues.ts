/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sub-issue hierarchy contracts for the `@plane/types/issues` subfolder.
 *
 * This module models three related concepts that together describe how Plane represents
 * parent/child relationships between work items:
 *
 *  1. The parent/child issue tree itself, expressed via `TIssue.parent_id` as a
 *     self-reference (mirrors the `parent` self-FK on
 *     `apps/api/plane/db/models/issue.py::Issue`).
 *  2. The rollup of child issues bucketed by workflow state group — used to render
 *     the multi-segment progress bar on the parent issue card (mirrors the
 *     aggregation logic in `apps/api/plane/app/views/issue/sub_issue.py`).
 *  3. The `TSubIssueOperations` callback contract — a single object of action
 *     handlers that the issue detail page passes down to the sub-issue panel so the
 *     panel can stay context-agnostic when reused in modals, peek overviews, etc.
 *
 * Consumers:
 *  - `apps/web/core/store/issue/issue-details/sub_issues.store.ts` (sub-issue state)
 *  - `apps/web/core/components/issues/issue-detail-widgets/sub-issues/` (panel UI)
 *  - `apps/web/core/services/issue/issue.service.ts` (HTTP layer)
 *
 * Re-exported through the folder barrel at `./base.ts`, which is in turn surfaced by
 * `packages/types/src/index.ts` as part of the public `@plane/types` API.
 */

import type { TIssue } from "./issue";

/**
 * Rollup of child issue ids bucketed by workflow state group, used to render the
 * multi-segment progress bar on the parent issue (e.g. "3 backlog, 2 started,
 * 5 completed").
 *
 * Each bucket holds the array of child issue ids in that state group — NOT a numeric
 * count. The displayed count is `array.length`; holding ids (instead of just counts)
 * lets the UI deep-link from a progress segment back to the contributing issues.
 *
 * The five group names are bound to `TStateGroups` in `packages/types/src/state.ts`
 * and are the canonical workflow categories used end-to-end by the backend.
 */
export type TSubIssuesStateDistribution = {
  /** Child issue ids whose state belongs to the `backlog` group (newly created, untriaged). */
  backlog: string[];
  /** Child issue ids whose state belongs to the `unstarted` group (triaged but not started). */
  unstarted: string[];
  /** Child issue ids whose state belongs to the `started` group (work in progress). */
  started: string[];
  /** Child issue ids whose state belongs to the `completed` group (work finished and accepted). */
  completed: string[];
  /** Child issue ids whose state belongs to the `cancelled` group (closed without completion). */
  cancelled: string[];
};

/**
 * Combined sub-issue payload returned by `GET /sub-issues/`.
 *
 * Embeds both the state-distribution rollup AND the full child issue records in a
 * single response so the panel can render its header counts and its list body from
 * one fetch round trip.
 */
export type TIssueSubIssues = {
  /** Bucketed child ids grouped by workflow state — see `TSubIssuesStateDistribution`. */
  state_distribution: TSubIssuesStateDistribution;
  /** Child issue records, either flat or grouped — see `TSubIssueResponse`. */
  sub_issues: TSubIssueResponse;
};

/**
 * Response shape for the sub-issues list endpoint.
 *
 * A deliberate union of two shapes that mirrors whatever grouping the request
 * specified: (a) a flat array of child issues for ungrouped views, OR (b) a record
 * keyed by an arbitrary group discriminator (e.g. a state group label) for grouped
 * views. Consumers MUST narrow with a runtime check (e.g. `Array.isArray`) before
 * iterating — the union is not narrowable from typing alone.
 */
export type TSubIssueResponse = TIssue[] | { [key: string]: TIssue[] };

/**
 * Memoization map: parent `issue_id` → its `TSubIssuesStateDistribution`.
 *
 * Allows the sub-issue store to cache per-parent rollups so that re-opening a
 * parent's sub-issue panel does not require an extra fetch when the rollup has not
 * been invalidated by an upstream mutation.
 */
export type TIssueSubIssuesStateDistributionMap = {
  [issue_id: string]: TSubIssuesStateDistribution;
};

/**
 * Memoization map: parent `issue_id` → ordered list of child issue ids.
 *
 * Paired with the flat issue store (which stores full `TIssue` records keyed by id),
 * this enables a normalized state shape: the child ids live here, the child bodies
 * live in the issue store, and the two are joined at render time.
 */
export type TIssueSubIssuesIdMap = {
  [issue_id: string]: string[];
};

/**
 * Callback contract passed down from the issue detail page to the sub-issue panel.
 *
 * Defining every action the panel can trigger as a single object keeps the panel's
 * props surface stable when it is reused in different containers (issue detail page,
 * peek overview, modal, etc.) — each container builds its own `TSubIssueOperations`
 * object and the panel does not need to know which container it lives inside.
 *
 * IMPORTANT — `remove` vs. `delete` distinction:
 *  - `removeSubIssue` un-links a child from the parent by setting its `parent_id`
 *    to null. The issue itself is preserved and continues to exist as a top-level
 *    issue in the project.
 *  - `deleteSubIssue` destroys the child issue entirely (DB-level DELETE). The
 *    operation is irreversible and removes the issue from the project.
 *
 * UI affordances and backend permission requirements differ between the two; the
 * two operations are intentionally separate to make that distinction explicit at
 * every call site.
 */
export type TSubIssueOperations = {
  /** Copies the canonical sub-issue link path to the clipboard; pure side effect, returns `void`. */
  copyLink: (path: string) => void;
  /** GET the sub-issues for a parent; state mutation lives in the consuming store, so the promise resolves with `void`. */
  fetchSubIssues: (workspaceSlug: string, projectId: string, parentIssueId: string) => Promise<void>;
  /** Bulk-link existing issues as children of the parent; the backend sets `parent_id` on each child. */
  addSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueIds: string[]) => Promise<void>;
  /**
   * Update a child issue's properties through the parent panel.
   *
   * `oldIssue` is passed so the store can roll back optimistic updates if the API
   * call fails; `fromModal` toggles activity-log behavior on the backend (modal
   * edits are logged differently than inline edits).
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
  /** UN-link a child from the parent (sets `parent_id` to null but preserves the issue); distinct from `deleteSubIssue`. */
  removeSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
  /** Destroy the child issue entirely (DB DELETE, irreversible); distinct from `removeSubIssue` which only un-links. */
  deleteSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
};
