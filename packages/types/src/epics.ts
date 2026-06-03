/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Epic analytics contracts for the `@plane/types` package.
 *
 * Models the count distribution shown in the epic detail sidebar/analytics panel.
 * Epics are top-level work-item containers that group regular issues; the analytics
 * here count issues in the epic by lifecycle state plus overdue.
 */

/**
 * Discriminator key identifying which analytics bucket a count corresponds to.
 *
 * Union values:
 * - `backlog_issues`: issues in backlog state
 * - `unstarted_issues`: not yet started (state group "unstarted")
 * - `started_issues`: in progress (state group "started")
 * - `completed_issues`: done (state group "completed")
 * - `cancelled_issues`: cancelled (state group "cancelled")
 * - `overdue_issues`: past target_date and not yet completed/cancelled
 */
export type TEpicAnalyticsGroup =
  | "backlog_issues"
  | "unstarted_issues"
  | "started_issues"
  | "completed_issues"
  | "cancelled_issues"
  | "overdue_issues";

/**
 * Count breakdown of issues belonging to a single epic, partitioned by lifecycle state.
 *
 * Each field is a non-negative integer count; the keys map 1:1 to `TEpicAnalyticsGroup` values.
 * Consumers: epic detail sidebar/charts in `apps/web/core/components/issues/issue-detail/`.
 */
export type TEpicAnalytics = {
  backlog_issues: number;
  unstarted_issues: number;
  started_issues: number;
  completed_issues: number;
  cancelled_issues: number;
  overdue_issues: number;
};
