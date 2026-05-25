/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle entity contracts mirroring `apps/api/plane/db/models/cycle.py` and
 * `apps/api/plane/app/serializers/cycle.py`; consumed by `cycle.store.ts`
 * and `apps/web/core/components/cycles/**`.
 */

import type { TIssue } from "../issues/issue";
import type { IIssueFilterOptions } from "../view-props";

/**
 * Server-computed lifecycle group derived from start/end dates and draft
 * status (`apps/api/plane/app/serializers/cycle.py:L57`) — surfaces as
 * `ICycle.status` and `TCycleFilters.status`.
 */
export type TCycleGroups = "current" | "upcoming" | "completed" | "draft";

/**
 * Date-keyed completion ratio map for the burndown/burnup chart; keys are ISO
 * date strings, values are per-day completion percentages or `null` for
 * future dates with no recorded data.
 */
export type TCycleCompletionChartDistribution = {
  [key: string]: number | null;
};

/**
 * Issue-count breakdown used as the right-hand side of cycle distribution rows
 * (one row per assignee or per label).
 */
export type TCycleDistributionBase = {
  total_issues: number;
  pending_issues: number;
  completed_issues: number;
};

/**
 * Estimate-point breakdown used as the right-hand side of cycle estimate distribution
 * rows when the cycle is configured to track points instead of issue counts.
 */
export type TCycleEstimateDistributionBase = {
  total_estimates: number;
  pending_estimates: number;
  completed_estimates: number;
};

/**
 * Assignee identity row used as the left-hand side of cycle distribution entries.
 *
 * Every field is nullable so unassigned issues collapse into a single anonymous row.
 */
export type TCycleAssigneesDistribution = {
  assignee_id: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
};

/**
 * Label identity row used as the left-hand side of label-based cycle distribution entries.
 *
 * All fields nullable so unlabeled issues collapse into a single anonymous row.
 */
export type TCycleLabelsDistribution = {
  color: string | null;
  label_id: string | null;
  label_name: string | null;
};

/**
 * Issue-count distribution payload returned by the cycle distribution endpoint —
 * one entry per assignee and one entry per label, plus the per-date completion chart.
 *
 * Each assignee/label row intersects the identity (`TCycleAssigneesDistribution` /
 * `TCycleLabelsDistribution`) with the count breakdown (`TCycleDistributionBase`).
 */
export type TCycleDistribution = {
  assignees: (TCycleAssigneesDistribution & TCycleDistributionBase)[];
  completion_chart: TCycleCompletionChartDistribution;
  labels: (TCycleLabelsDistribution & TCycleDistributionBase)[];
};

/**
 * Estimate-point distribution payload — same shape as `TCycleDistribution` but with
 * estimate-point breakdowns instead of issue counts. Used when the cycle is being
 * tracked in story points (controlled by `TCycleEstimateType = "points"`).
 */
export type TCycleEstimateDistribution = {
  assignees: (TCycleAssigneesDistribution & TCycleEstimateDistributionBase)[];
  completion_chart: TCycleCompletionChartDistribution;
  labels: (TCycleLabelsDistribution & TCycleEstimateDistributionBase)[];
};
/**
 * Single day's progress data point for the burndown/burnup timeline; `scope`
 * may grow mid-cycle when issues are added, and `ideal` is `null` outside
 * the active cycle window.
 */
export type TCycleProgress = {
  date: string;
  started: number;
  actual: number;
  pending: number;
  ideal: number | null;
  scope: number;
  completed: number;
  unstarted: number;
  backlog: number;
  cancelled: number;
};

/**
 * Aggregate progress counters embedded directly on `ICycle` and surfaced by the
 * cycle list endpoint to avoid an extra round-trip.
 *
 * The estimate-point counters and the `distribution` blobs are optional because they
 * are only populated when a cycle is configured for estimate tracking or when the
 * caller explicitly requests the distribution payload. `total_estimate_points` and
 * `completed_estimate_points` are optional for the same reason.
 */
export type TProgressSnapshot = {
  total_issues: number;
  completed_issues: number;
  backlog_issues: number;
  started_issues: number;
  unstarted_issues: number;
  cancelled_issues: number;
  total_estimate_points?: number;
  completed_estimate_points?: number;
  backlog_estimate_points: number;
  started_estimate_points: number;
  unstarted_estimate_points: number;
  cancelled_estimate_points: number;
  distribution?: TCycleDistribution;
  estimate_distribution?: TCycleEstimateDistribution;
};

/**
 * Minimal project projection embedded on `ICycle.project_detail` — only the project
 * id is exposed at this layer; richer project metadata is fetched separately.
 */
export interface IProjectDetails {
  id: string;
}

/**
 * Cycle entity (time-boxed sprint/iteration) mirroring `apps/api/plane/db/models/cycle.py`
 * and `CycleSerializer`; `progress_snapshot` is a server-frozen snapshot at completion
 * while the inline `TProgressSnapshot` fields are the live values, and `version` is the
 * monotonic optimistic-concurrency counter.
 */
export interface ICycle extends TProgressSnapshot {
  progress_snapshot: TProgressSnapshot | undefined;

  created_at?: string;
  created_by?: string;
  description: string;
  /** ISO date string; `null` until the cycle's start date is set (cycle is in draft). */
  end_date: string | null;
  id: string;
  /** Per-viewer favorite flag set by the cycle list endpoint for the requesting user. */
  is_favorite?: boolean;
  name: string;
  owned_by_id: string;
  project_id: string;
  /** Server-computed lifecycle group; one of `current | upcoming | completed | draft`. Not user-settable. */
  status?: TCycleGroups;
  sort_order: number;
  /** ISO date string; `null` until the cycle's start date is set (cycle is in draft). */
  start_date: string | null;
  sub_issues?: number;
  updated_at?: string;
  updated_by?: string;
  /** `null` while the cycle is active; ISO timestamp set when the cycle is archived. */
  archived_at: string | null;
  /** User ids assigned to issues in the cycle (denormalized for listing; not the owner). */
  assignee_ids?: string[];
  /** Persisted view configuration; `filters` mirrors `Cycle.view_props` JSONField default. */
  view_props: {
    filters: IIssueFilterOptions;
  };
  workspace_id: string;
  project_detail: IProjectDetails;
  /** Opaque per-day aggregation series consumed by the burndown / burnup chart. */
  progress: any[];
  /** Monotonic version counter incremented on every server-side mutation (optimistic concurrency). */
  version: number;
}

/**
 * Cycle-issue link response returned when listing issues attached to a cycle.
 *
 * The `issue_detail` field carries the full `TIssue` payload nested inside the link so
 * consumers do not need a second request. `cycle` and `issue` are foreign-key id strings.
 */
export interface CycleIssueResponse {
  id: string;
  issue_detail: TIssue;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  project: string;
  workspace: string;
  issue: string;
  cycle: string;
  sub_issues_count: number;
}

/**
 * UI selection union for a cycle picked for `"edit"` / `"delete"` /
 * `"create-issue"` actions, or `undefined` when no cycle is selected.
 */
export type SelectCycleType = (ICycle & { actionType: "edit" | "delete" | "create-issue" }) | undefined;

/**
 * Request payload for the cycle date-overlap validation endpoint.
 *
 * `cycle_id` is optional so it can be sent during cycle creation (when no id exists yet)
 * and during edit (where the id excludes the cycle being edited from the overlap check).
 */
export type CycleDateCheckData = {
  start_date: string;
  end_date: string;
  cycle_id?: string;
};

/**
 * Per-viewer numeric scale for cycle progress charts: `"issues"` counts issues
 * and `"points"` sums estimate points (requires an estimate scheme); persisted
 * in `cycle.store.ts:estimatedType`.
 */
export type TCycleEstimateType = "issues" | "points";
/**
 * Per-viewer chart shape for cycle progress: `"burndown"` (remaining work
 * decreases toward zero) or `"burnup"` (completed work increases toward
 * scope, exposing scope changes); persisted in `cycle.store.ts:plotType`.
 */
export type TCyclePlotType = "burndown" | "burnup";

/**
 * Public, unauthenticated projection of a cycle exposed via `apps/api/plane/space/**`
 * for the Plane Spaces site (no member-only metadata).
 *
 * `status` is left as the broad `string` type here because the public surface may include
 * server-defined lifecycle labels that have not yet been encoded into `TCycleGroups`.
 */
export type TPublicCycle = {
  id: string;
  name: string;
  status: string;
};

/**
 * Densified per-date progress series used directly by the burndown / burnup chart renderer.
 *
 * Same fields as `TCycleProgress` but with `ideal` always a `number` (the chart treats
 * gaps as zero rather than null), and represented as an array rather than a single point.
 */
export type TProgressChartData = {
  date: string;
  scope: number;
  completed: number;
  backlog: number;
  started: number;
  unstarted: number;
  cancelled: number;
  pending: number;
  ideal: number;
  actual: number;
}[];
