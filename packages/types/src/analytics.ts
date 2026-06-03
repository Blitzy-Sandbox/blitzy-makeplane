/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Analytics chart contracts for the `@plane/types` package.
 *
 * Models the axis property and metric vocabularies, filter parameters, response
 * envelopes, and table data shapes consumed by the workspace analytics dashboards
 * in `apps/web/core/components/analytics/` and served by `apps/api/plane/app/views/analytic/`.
 */

import type { TChartData } from "./charts";

/**
 * X-axis grouping properties available for analytics charts.
 *
 * Each value names a dimension to bucket issues by. Used in the `x_axis` field of
 * `IAnalyticsParams` and rendered in the analytics dashboard filter row.
 */
export enum ChartXAxisProperty {
  STATES = "STATES",
  STATE_GROUPS = "STATE_GROUPS",
  LABELS = "LABELS",
  ASSIGNEES = "ASSIGNEES",
  ESTIMATE_POINTS = "ESTIMATE_POINTS",
  CYCLES = "CYCLES",
  MODULES = "MODULES",
  PRIORITY = "PRIORITY",
  START_DATE = "START_DATE",
  TARGET_DATE = "TARGET_DATE",
  CREATED_AT = "CREATED_AT",
  COMPLETED_AT = "COMPLETED_AT",
  CREATED_BY = "CREATED_BY",
  WORK_ITEM_TYPES = "WORK_ITEM_TYPES",
  PROJECTS = "PROJECTS",
  EPICS = "EPICS",
}

/**
 * Y-axis aggregation metrics available for analytics charts.
 *
 * Values measure either work-item count (raw count of issues) or estimate-point sum
 * (sum of per-issue estimate_point values). Each suffix narrows by lifecycle state
 * (pending, completed, in-progress, due-this-week, due-today, blocked).
 */
export enum ChartYAxisMetric {
  WORK_ITEM_COUNT = "WORK_ITEM_COUNT",
  ESTIMATE_POINT_COUNT = "ESTIMATE_POINT_COUNT",
  PENDING_WORK_ITEM_COUNT = "PENDING_WORK_ITEM_COUNT",
  COMPLETED_WORK_ITEM_COUNT = "COMPLETED_WORK_ITEM_COUNT",
  IN_PROGRESS_WORK_ITEM_COUNT = "IN_PROGRESS_WORK_ITEM_COUNT",
  WORK_ITEM_DUE_THIS_WEEK_COUNT = "WORK_ITEM_DUE_THIS_WEEK_COUNT",
  WORK_ITEM_DUE_TODAY_COUNT = "WORK_ITEM_DUE_TODAY_COUNT",
  BLOCKED_WORK_ITEM_COUNT = "BLOCKED_WORK_ITEM_COUNT",
  EPIC_WORK_ITEM_COUNT = "EPIC_WORK_ITEM_COUNT",
}

/**
 * Top-level analytics dashboard tab identifier.
 *
 * Union values:
 * - `overview`: aggregate workspace KPIs
 * - `work-items`: detailed work-item charts and tables
 */
export type TAnalyticsTabsBase = "overview" | "work-items";

/**
 * Sub-graph identifier within the analytics dashboard.
 *
 * Union values:
 * - `projects`: cross-project comparison
 * - `work-items`: workspace-wide work-item analytics
 * - `custom-work-items`: user-filtered work-item analytics
 */
export type TAnalyticsGraphsBase = "projects" | "work-items" | "custom-work-items";

/**
 * Analytics dashboard tab descriptor.
 *
 * Fields:
 * - `key`: tab identifier (matches one of `TAnalyticsTabsBase`)
 * - `label`: localized display name
 * - `content`: React component rendered when the tab is active
 * - `isDisabled`: true to gray out the tab (e.g. plan gating)
 */
export interface AnalyticsTab {
  key: TAnalyticsTabsBase;
  label: string;
  content: React.FC;
  isDisabled: boolean;
}

/**
 * Optional filter parameters narrowing analytics queries.
 *
 * Fields (all optional):
 * - `project_ids`: comma-separated project ids to include
 * - `cycle_id`: scope to a single cycle
 * - `module_id`: scope to a single module
 *
 * When omitted, queries span the full workspace.
 */
export type TAnalyticsFilterParams = {
  project_ids?: string;
  cycle_id?: string;
  module_id?: string;
};

// service types

/**
 * Generic catch-all analytics response envelope (shape varies per endpoint).
 *
 * Each top-level key is a property name; the value depends on `x_axis`/`y_axis` choice.
 * Consumers should narrow via the relevant typed wrapper or `IChartResponse`.
 */
export interface IAnalyticsResponse {
  [key: string]: any;
}

/**
 * Aggregate counts attached to analytics responses.
 *
 * Fields:
 * - `count`: number of issues matching the query before filters
 * - `filter_count`: number matching after the user-supplied filters
 */
export interface IAnalyticsResponseFields {
  count: number;
  filter_count: number;
}

// chart types

/**
 * Tabular chart response with row schema + ordered rows.
 *
 * Fields:
 * - `schema`: maps column key → column human-readable label
 * - `data`: rows in the order they should be rendered (X-axis values along rows)
 */
export interface IChartResponse {
  schema: Record<string, string>;
  data: TChartData<string, string>[];
}

// table types

/**
 * Single row of the work-item insights table.
 *
 * Fields:
 * - `project_id` / `project__name`: project bucket (peek-view variant uses `display_name`+`avatar_url`+`assignee_id`)
 * - `cancelled_work_items` / `completed_work_items` / `backlog_work_items` / `un_started_work_items` / `started_work_items`:
 *   counts per lifecycle state group
 */
export interface WorkItemInsightColumns {
  project_id?: string;
  project__name?: string;
  cancelled_work_items: number;
  completed_work_items: number;
  backlog_work_items: number;
  un_started_work_items: number;
  started_work_items: number;
  // in case of peek view, we will display the display_name instead of project__name
  display_name?: string;
  avatar_url?: string;
  assignee_id?: string;
}

/**
 * Map from analytics graph identifier to its row shape (currently only `work-items`).
 */
export type AnalyticsTableDataMap = {
  "work-items": WorkItemInsightColumns;
};

/**
 * Required query parameters for analytics chart endpoints.
 *
 * Fields:
 * - `x_axis`: dimension to bucket on (see `ChartXAxisProperty`)
 * - `y_axis`: metric to aggregate (see `ChartYAxisMetric`)
 * - `group_by`: optional secondary dimension (creates stacked/grouped bars)
 */
export interface IAnalyticsParams {
  x_axis: ChartXAxisProperty;
  y_axis: ChartYAxisMetric;
  group_by?: ChartXAxisProperty;
}
