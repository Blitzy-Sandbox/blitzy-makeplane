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
 * Chart row with required `key` / `name` / `count` plus an open `Record<string, number>` for caller-defined extra series (per-state, per-priority, etc.) labeled via the sibling `TChart.schema` map.
 * Consumed by chart data builders in `apps/web/core/components/chart/utils.ts` and the analytics payload shapes under `apps/web/core/components/analytics/`.
 */
export type TChartDatum = {
  key: string;
  name: string;
  count: number;
} & Record<string, number>;

/**
 * Chart-API wire payload pairing `data: TChartDatum[]` with `schema: Record<string, string>` that labels each datum's dynamic series key for human display.
 * Consumed by analytics dashboards under `apps/web/core/components/analytics/` and the transform helper in `apps/web/core/components/chart/utils.ts`.
 */
export type TChart = {
  data: TChartDatum[];
  schema: Record<string, string>;
};
