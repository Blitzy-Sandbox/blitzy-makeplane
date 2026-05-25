/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module entity contracts mirroring `apps/api/plane/db/models/module.py::Module`
 * and `ModuleSerializer`; consumed by `apps/web/core/store/module.store.ts`,
 * `apps/web/core/store/module_filter.store.ts`, and `apps/web/core/components/modules/**`.
 */

import type { ILinkDetails } from "../issues";
import type { TIssue } from "../issues/issue";
import type { IIssueFilterOptions } from "../view-props";

/**
 * Module lifecycle status mirroring `ModuleStatus.TextChoices` on the Django
 * model; keep in sync with the backend choices tuple.
 */
export type TModuleStatus = "backlog" | "planned" | "in-progress" | "paused" | "completed" | "cancelled";

/**
 * Date-indexed burndown/burnup plot points keyed by `YYYY-MM-DD`; `null` marks
 * dates outside the module's `start_date`–`target_date` window.
 */
export type TModuleCompletionChartDistribution = {
  [key: string]: number | null;
};

/**
 * Per-bucket issue-count aggregates composed onto each row of the assignees /
 * labels breakdown inside `TModuleDistribution`.
 */
export type TModuleDistributionBase = {
  total_issues: number;
  pending_issues: number;
  completed_issues: number;
};

/**
 * Per-bucket estimate-point aggregates used when `TModulePlotType === "points"`;
 * only populated when the owning project has estimates enabled.
 */
export type TModuleEstimateDistributionBase = {
  total_estimates: number;
  pending_estimates: number;
  completed_estimates: number;
};

/**
 * Assignee dimension key for module breakdowns; a `null` `assignee_id` row
 * aggregates unassigned issues.
 */
export type TModuleAssigneesDistribution = {
  assignee_id: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
};

/**
 * Label dimension key for module breakdowns; a `null` `label_id` row aggregates
 * unlabelled issues.
 */
export type TModuleLabelsDistribution = {
  color: string | null;
  label_id: string | null;
  label_name: string | null;
};

/**
 * Issue-count breakdown across assignees, labels, and completion-chart
 * dimensions; returned only when `TModulePlotType === "burndown"`.
 */
export type TModuleDistribution = {
  assignees: (TModuleAssigneesDistribution & TModuleDistributionBase)[];
  completion_chart: TModuleCompletionChartDistribution;
  labels: (TModuleLabelsDistribution & TModuleDistributionBase)[];
};

/**
 * Estimate-point breakdown across the same dimensions as `TModuleDistribution`;
 * returned only when `TModulePlotType === "points"` and estimates are enabled.
 */
export type TModuleEstimateDistribution = {
  assignees: (TModuleAssigneesDistribution & TModuleEstimateDistributionBase)[];
  completion_chart: TModuleCompletionChartDistribution;
  labels: (TModuleLabelsDistribution & TModuleEstimateDistributionBase)[];
};

/**
 * Canonical module entity as returned by `ModuleSerializer`. Non-obvious
 * semantics: `status` is the `TModuleStatus` enum; `lead_id` is nullable;
 * `description_text`/`description_html` are typed `any` because the editor
 * schema is owned by `@plane/editor`; `distribution`/`estimate_distribution`
 * are populated only on the module-detail endpoint; estimate-point totals
 * are emitted only when project estimates are enabled.
 */
export interface IModule {
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
  distribution?: TModuleDistribution;
  estimate_distribution?: TModuleEstimateDistribution;

  id: string;
  name: string;
  description: string;
  description_text: any;
  description_html: any;
  workspace_id: string;
  project_id: string;
  lead_id: string | null;
  member_ids: string[];
  link_module?: ILinkDetails[];
  sub_issues?: number;
  is_favorite: boolean;
  sort_order: number;
  view_props: {
    filters: IIssueFilterOptions;
  };
  status?: TModuleStatus;
  archived_at: string | null;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

/**
 * Hydrated module ↔ issue association carrying both foreign-key ids and the
 * embedded objects so the UI can render without an extra fetch round-trip.
 */
export interface ModuleIssueResponse {
  created_at: Date;
  created_by: string;
  id: string;
  issue: string;
  issue_detail: TIssue;
  module: string;
  module_detail: IModule;
  project: string;
  updated_at: Date;
  updated_by: string;
  workspace: string;
  sub_issues_count: number;
}

/**
 * Minimal `title` + `url` payload for module-link create/update; the server
 * expands this into a full `ILinkDetails` on the response.
 */
export type ModuleLink = {
  title: string;
  url: string;
};

/**
 * Selected-module UI state coordinating cross-component dialogs; the
 * `actionType` discriminant tells the consumer which dialog to open.
 */
export type SelectModuleType = (IModule & { actionType: "edit" | "delete" | "create-issue" }) | undefined;

/**
 * Analytics chart-mode discriminator persisted per module in
 * `ModulesStore.plotType`; `"points"` requires project estimates enabled.
 */
export type TModulePlotType = "burndown" | "points";

/**
 * Minimal public projection (identity only) exposed to anonymous viewers in
 * Plane Spaces to prevent leakage of internal project state.
 */
export type TPublicModule = {
  id: string;
  name: string;
};
