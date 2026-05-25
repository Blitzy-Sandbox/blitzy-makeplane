/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Authoritative source of typed analytics configuration for the workspace
 * analytics page — defines the insight-field catalog per tab, the chart axis
 * selectors, the duration filter presets, and the v2 date-key allowlist.
 *
 * Consumers: `apps/web/core/components/analytics/**` (insight cards, axis pickers,
 * duration dropdowns, chart configuration), `apps/web/core/store/analytics.store.ts`,
 * and re-exported through `packages/constants/src/analytics/index.ts`.
 */

import type { TAnalyticsTabsBase } from "@plane/types";
import { ChartXAxisProperty, ChartYAxisMetric } from "@plane/types";

/**
 * Shape of a single analytics insight item — a metric tile rendered in the
 * workspace analytics insight cards. Pairs a backend response `key` (the field
 * name used in the analytics payload) with an i18n translation key plus optional
 * interpolation props for entity-typed labels (e.g., "Total {entity}").
 *
 * Fields:
 * - `key`: Backend response field name (e.g., `"total_users"`, `"total_admins"`).
 *   Used to look up the metric value in the analytics API payload.
 * - `i18nKey`: Translation key resolved by the i18n provider (e.g., `"workspace_analytics.total"`).
 * - `i18nProps` (optional): Interpolation values for the translation template.
 *   `entity`/`entityPlural`/`prefix`/`suffix` are first-class named slots; the
 *   index signature `[key: string]: unknown` permits ad-hoc keys for future
 *   templates without changing the type.
 *
 * Consumers: `apps/web/core/components/analytics/total-insights.tsx`.
 */
export interface IInsightField {
  key: string;
  i18nKey: string;
  i18nProps?: {
    entity?: string;
    entityPlural?: string;
    prefix?: string;
    suffix?: string;
    [key: string]: unknown;
  };
}

/**
 * Insight field catalog keyed by analytics tab — the source of truth for which
 * metric tiles appear on each `TAnalyticsTabsBase` tab and how their labels are
 * resolved by the i18n provider.
 *
 * Current tabs:
 * - `overview`: Workspace-wide totals (users, admins, members, guests, projects,
 *   work items, cycles, intake) — all use the shared `"workspace_analytics.total"`
 *   template with an `entity` slot.
 * - `work-items`: Work-item lifecycle totals (total, started, backlog, un-started,
 *   completed) — each uses a fully-localized key with no interpolation slots.
 *
 * Consumers: `apps/web/core/components/analytics/total-insights.tsx` for tile
 * rendering and label resolution.
 */
export const ANALYTICS_INSIGHTS_FIELDS: Record<TAnalyticsTabsBase, IInsightField[]> = {
  overview: [
    {
      key: "total_users",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.users",
      },
    },
    {
      key: "total_admins",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.admins",
      },
    },
    {
      key: "total_members",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.members",
      },
    },
    {
      key: "total_guests",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.guests",
      },
    },
    {
      key: "total_projects",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.projects",
      },
    },
    {
      key: "total_work_items",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.work_items",
      },
    },
    {
      key: "total_cycles",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "common.cycles",
      },
    },
    {
      key: "total_intake",
      i18nKey: "workspace_analytics.total",
      i18nProps: {
        entity: "sidebar.intake",
      },
    },
  ],
  "work-items": [
    {
      key: "total_work_items",
      i18nKey: "workspace_analytics.total",
    },
    {
      key: "started_work_items",
      i18nKey: "workspace_analytics.started_work_items",
    },
    {
      key: "backlog_work_items",
      i18nKey: "workspace_analytics.backlog_work_items",
    },
    {
      key: "un_started_work_items",
      i18nKey: "workspace_analytics.un_started_work_items",
    },
    {
      key: "completed_work_items",
      i18nKey: "workspace_analytics.completed_work_items",
    },
  ],
};

/**
 * Preset date-range filter options for the analytics page duration dropdown.
 * Each entry's `value` is the analytics API's duration token; `name` is the
 * English display label resolved at the call site (i18n at the consumer layer).
 *
 * Values: `yesterday`, `last_7_days`, `last_30_days`, `last_3_months`.
 *
 * Consumers: `apps/web/core/components/analytics/select/duration.tsx` (dropdown
 * UI) and `apps/web/core/store/analytics.store.ts` (selected-duration state +
 * API parameter wiring).
 */
export const ANALYTICS_DURATION_FILTER_OPTIONS = [
  {
    name: "Yesterday",
    value: "yesterday",
  },
  {
    name: "Last 7 days",
    value: "last_7_days",
  },
  {
    name: "Last 30 days",
    value: "last_30_days",
  },
  {
    name: "Last 3 months",
    value: "last_3_months",
  },
];

/**
 * X-axis property options for the analytics chart configuration picker — pairs
 * each `ChartXAxisProperty` enum value with the English display label shown in
 * the axis selector dropdown.
 *
 * Covers categorical groupings (state, state group, priority, label, assignee,
 * estimate point, cycle, module) and date groupings (completed/target/start/
 * created dates). The `ChartXAxisProperty` enum is sourced from `@plane/types`
 * and mirrors the backend's accepted `x_axis` query parameter.
 *
 * Consumers: `apps/web/core/components/analytics/select/analytics-params.tsx`
 * (chart axis picker) and `apps/web/core/components/analytics/work-items/priority-chart.tsx`.
 */
export const ANALYTICS_X_AXIS_VALUES: { value: ChartXAxisProperty; label: string }[] = [
  {
    value: ChartXAxisProperty.STATES,
    label: "State name",
  },
  {
    value: ChartXAxisProperty.STATE_GROUPS,
    label: "State group",
  },
  {
    value: ChartXAxisProperty.PRIORITY,
    label: "Priority",
  },
  {
    value: ChartXAxisProperty.LABELS,
    label: "Label",
  },
  {
    value: ChartXAxisProperty.ASSIGNEES,
    label: "Assignee",
  },
  {
    value: ChartXAxisProperty.ESTIMATE_POINTS,
    label: "Estimate point",
  },
  {
    value: ChartXAxisProperty.CYCLES,
    label: "Cycle",
  },
  {
    value: ChartXAxisProperty.MODULES,
    label: "Module",
  },
  {
    value: ChartXAxisProperty.COMPLETED_AT,
    label: "Completed date",
  },
  {
    value: ChartXAxisProperty.TARGET_DATE,
    label: "Due date",
  },
  {
    value: ChartXAxisProperty.START_DATE,
    label: "Start date",
  },
  {
    value: ChartXAxisProperty.CREATED_AT,
    label: "Created date",
  },
];

/**
 * Y-axis metric options for the analytics chart configuration picker — pairs
 * each `ChartYAxisMetric` enum value with the English display label shown in
 * the metric selector dropdown.
 *
 * Supported metrics: work item count, estimate point count, epic work item count.
 * The `ChartYAxisMetric` enum is sourced from `@plane/types` and mirrors the
 * backend's accepted `y_axis` query parameter.
 *
 * Consumers: `apps/web/core/components/analytics/select/analytics-params.tsx`
 * (chart metric picker) and `apps/web/core/components/analytics/work-items/priority-chart.tsx`.
 */
export const ANALYTICS_Y_AXIS_VALUES: { value: ChartYAxisMetric; label: string }[] = [
  {
    value: ChartYAxisMetric.WORK_ITEM_COUNT,
    label: "Work item",
  },
  {
    value: ChartYAxisMetric.ESTIMATE_POINT_COUNT,
    label: "Estimate",
  },
  {
    value: ChartYAxisMetric.EPIC_WORK_ITEM_COUNT,
    label: "Epic",
  },
];

/**
 * Allowlist of date-typed field keys recognized by analytics-v2 — used by chart
 * x-axis logic to determine whether a selected property should be rendered with
 * date-aware tick formatting/grouping rather than a categorical axis.
 *
 * Mirrors the four date columns in the analytics payload: `completed_at`,
 * `target_date`, `start_date`, `created_at`.
 *
 * Consumers: re-exported through `packages/constants/src/analytics/index.ts`;
 * no in-repo consumer of the symbol was located at documentation-writing time.
 */
// INTENT UNCLEAR: No call site for ANALYTICS_V2_DATE_KEYS was found in apps/web, apps/admin, apps/space, apps/live, or sibling packages at documentation time; the value is exported through the package barrel but may be reserved for a future analytics-v2 surface.
export const ANALYTICS_V2_DATE_KEYS = ["completed_at", "target_date", "start_date", "created_at"];
