/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Common chart configuration types for the `@plane/types/charts` sub-package.
 *
 * Defines the foundational palette identifier (`TChartColorScheme`), the
 * row-level data shape (`TChartDatum`), and the top-level chart payload
 * contract (`TChart`) that are re-exported via `./index.ts` and consumed
 * by chart data builders in `apps/web/core/components/chart/`, analytics
 * dashboards in `apps/web/core/components/analytics/`, and chart renderers
 * in `packages/propel/src/charts/`.
 */

/**
 * Constrained palette identifier selecting the chart color scheme.
 *
 * Union values:
 * - `"modern"`
 * - `"horizon"`
 * - `"earthen"`
 *
 * Each value maps to a named entry in `CHART_COLOR_PALETTES`
 * (`packages/constants/src/chart.ts`) that carries the concrete light- and
 * dark-mode color arrays plus an i18n label (`dashboards.widget.color_palettes.*`)
 * for user-facing palette selection in dashboard widgets.
 */
export type TChartColorScheme = "modern" | "horizon" | "earthen";

/**
 * Base chart row shape combining three required identifying fields with an
 * open numeric series record.
 *
 * Required fields:
 * - `key`: stable identifier for the row (typically the categorical axis value).
 * - `name`: human-readable label for the row.
 * - `count`: primary numeric metric for the row.
 *
 * The `& Record<string, number>` intersection permits arbitrary additional
 * numeric series to be attached per row under caller-defined keys (e.g.,
 * per-state or per-priority issue counts in an analytics breakdown). The
 * open series keys are typically labeled separately via the sibling
 * `TChart.schema` lookup so that renderers do not need to hard-code the
 * series key set.
 *
 * Consumers: chart data builders in `apps/web/core/components/chart/utils.ts`
 * and analytics payload shapes in
 * `apps/web/core/components/analytics/work-items/priority-chart.tsx`.
 */
export type TChartDatum = {
  key: string;
  name: string;
  count: number;
} & Record<string, number>;

/**
 * Top-level chart payload combining a data array with a schema metadata map.
 *
 * Fields:
 * - `data`: ordered `TChartDatum[]` rendered along the categorical axis.
 * - `schema`: maps the dynamic series keys carried in each datum's open
 *   `Record<string, number>` to human-readable metadata strings (e.g., a
 *   display label), decoupling key naming from presentation so renderers
 *   need not hard-code the series key set.
 *
 * Consumers: wire-format type for chart API responses fetched by analytics
 * dashboards in `apps/web/core/components/analytics/` (see e.g.
 * `apps/web/core/components/chart/utils.ts` for the transform function and
 * `apps/web/core/components/analytics/work-items/priority-chart.tsx` for the
 * API call site).
 */
export type TChart = {
  data: TChartDatum[];
  schema: Record<string, string>;
};
