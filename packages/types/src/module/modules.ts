/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module entity contracts for the `@plane/types/module` subfolder.
 *
 * Models project modules — work-item sub-groups within a project that aggregate
 * issues by topic, milestone, or workstream. Mirrors the `Module` model in
 * `apps/api/plane/db/models/module.py` and the `ModuleSerializer` in
 * `apps/api/plane/app/serializers/module.py`.
 *
 * Consumers:
 *   - `apps/web/core/store/module.store.ts` — `moduleMap`, fetch/create/update/delete actions, link CRUD
 *   - `apps/web/core/components/modules/**` — list/board/gantt, form, modal, peek-overview, analytics-sidebar
 *   - `apps/web/core/store/module_filter.store.ts` — uses `IModule` for filtered selectors
 */

import type { ILinkDetails } from "../issues";
import type { TIssue } from "../issues/issue";
import type { IIssueFilterOptions } from "../view-props";

/**
 * Lifecycle status discriminator for a module. Mirrors `ModuleStatus.TextChoices`
 * in `apps/api/plane/db/models/module.py` (the choices tuple on the `status`
 * `CharField`) — keep this union in sync with the Python source if either changes.
 *
 * Valid values:
 * - `backlog` — created but not yet planned for execution.
 * - `planned` — scheduled (default state on create per the Django model).
 * - `in-progress` — work has begun; at least one issue is in a started state.
 * - `paused` — temporarily halted; distinct from `cancelled` in that work may resume.
 * - `completed` — all issues resolved; module is closed.
 * - `cancelled` — abandoned without completion.
 */
export type TModuleStatus = "backlog" | "planned" | "in-progress" | "paused" | "completed" | "cancelled";

/**
 * Date-indexed completion plot points for the module burndown/burnup chart.
 * Keys are ISO `YYYY-MM-DD` strings and values are the remaining issue count
 * (or remaining estimate points when wrapped inside `TModuleEstimateDistribution`);
 * a `null` value represents dates outside the module's `start_date`–`target_date` window.
 */
export type TModuleCompletionChartDistribution = {
  [key: string]: number | null;
};

/**
 * Per-bucket aggregate counts used by issue-count-based module analytics.
 * Composed onto each row of the assignees / labels breakdown inside
 * `TModuleDistribution`.
 */
export type TModuleDistributionBase = {
  total_issues: number;
  pending_issues: number;
  completed_issues: number;
};

/**
 * Per-bucket aggregate estimate-point totals used by points-based module analytics
 * (`TModulePlotType === "points"`). Composed onto each row of the assignees /
 * labels breakdown inside `TModuleEstimateDistribution`; only populated when the
 * owning project has estimates enabled.
 */
export type TModuleEstimateDistributionBase = {
  total_estimates: number;
  pending_estimates: number;
  completed_estimates: number;
};

/**
 * Assignee identity descriptor used as the dimension key in the assignees
 * breakdown of `TModuleDistribution` / `TModuleEstimateDistribution`.
 * A `null` `assignee_id` row aggregates unassigned issues.
 */
export type TModuleAssigneesDistribution = {
  assignee_id: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
};

/**
 * Label identity descriptor used as the dimension key in the labels breakdown of
 * `TModuleDistribution` / `TModuleEstimateDistribution`. A `null` `label_id` row
 * aggregates unlabelled issues.
 */
export type TModuleLabelsDistribution = {
  color: string | null;
  label_id: string | null;
  label_name: string | null;
};

/**
 * Issue-count breakdown for a single module across the assignees, labels, and
 * completion-chart dimensions. Returned by the module-detail endpoint when
 * `TModulePlotType` is `"burndown"`; consumed by the analytics sidebar in
 * `apps/web/core/components/modules/analytics-sidebar/`.
 */
export type TModuleDistribution = {
  assignees: (TModuleAssigneesDistribution & TModuleDistributionBase)[];
  completion_chart: TModuleCompletionChartDistribution;
  labels: (TModuleLabelsDistribution & TModuleDistributionBase)[];
};

/**
 * Estimate-point breakdown for a single module across the same dimensions as
 * `TModuleDistribution`. Returned by the module-detail endpoint when
 * `TModulePlotType` is `"points"` and the project has estimates enabled.
 */
export type TModuleEstimateDistribution = {
  assignees: (TModuleAssigneesDistribution & TModuleEstimateDistributionBase)[];
  completion_chart: TModuleCompletionChartDistribution;
  labels: (TModuleLabelsDistribution & TModuleEstimateDistributionBase)[];
};

/**
 * Canonical module entity as returned by the module API (`Module` model +
 * `ModuleSerializer` in `apps/api/plane/app/serializers/module.py`).
 *
 * Field semantics worth calling out (other fields are self-explanatory id /
 * timestamp / count pairs):
 * - `status` — lifecycle enum; see `TModuleStatus`. Optional because some
 *    analytics-only payloads omit it.
 * - `lead_id` — single user designated as module owner; `null` when no lead is set.
 * - `member_ids` — assignee user ids resolved from the `ModuleMember`
 *    through-table on the backend.
 * - `link_module` — associated reference URLs (docs, designs, tickets); shape
 *    inherited from `ILinkDetails` (`packages/types/src/issues.ts`).
 * - `start_date` / `target_date` — ISO `YYYY-MM-DD` strings, or `null` when
 *    the module has not yet been scheduled.
 * - `archived_at` — ISO datetime when the module was soft-archived; `null` for
 *    active modules. Archived modules surface under the archived-modules tab.
 * - `view_props.filters` — saved issue-list filter overlay (`IIssueFilterOptions`)
 *    that scopes the module's issue tab on the web UI.
 * - `total_estimate_points` / `completed_estimate_points` — optional because they
 *    are only emitted when project estimates are enabled.
 * - `distribution` / `estimate_distribution` — only populated on the module-detail
 *    endpoint, never on the list endpoint.
 * - `description_text` / `description_html` — JSON / HTML payloads from the
 *    rich-text editor; typed `any` because the editor schema is owned by
 *    `@plane/editor` rather than this types package.
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
 * Hydrated module ↔ issue association as returned by the module-issue relation
 * endpoints (`apps/api/plane/app/views/cycle/issue.py` analogue for modules).
 * Carries both flat foreign-key ids (`module`, `issue`) and the embedded
 * objects (`module_detail`, `issue_detail`) so the UI can render without an
 * extra fetch round-trip.
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
 * Minimal `title` + `url` payload accepted by the module-link create/update
 * endpoints (`createModuleLink` / `updateModuleLink` in `module.store.ts`).
 * The server expands this into a full `ILinkDetails` on the response.
 */
export type ModuleLink = {
  title: string;
  url: string;
};

/**
 * Selected-module UI state used to coordinate cross-component dialogs
 * (delete modal, edit modal, quick-create-issue). The `actionType`
 * discriminant tells the consumer which dialog the selection drives;
 * `undefined` means no module is currently selected.
 */
export type SelectModuleType = (IModule & { actionType: "edit" | "delete" | "create-issue" }) | undefined;

/**
 * Chart-mode discriminator for the module analytics sidebar — persisted per
 * module in `ModulesStore.plotType` (`apps/web/core/store/module.store.ts`).
 *
 * - `burndown` — plot remaining issue count over time.
 * - `points` — plot remaining estimate points over time (requires the project
 *    to have estimates enabled).
 */
export type TModulePlotType = "burndown" | "points";

/**
 * Minimal public projection of a module exposed to anonymous viewers
 * (e.g., Plane Spaces). Carries only identity (`id`, `name`) — no membership,
 * dates, or progress data — to prevent leakage of internal project state.
 */
export type TPublicModule = {
  id: string;
  name: string;
};
