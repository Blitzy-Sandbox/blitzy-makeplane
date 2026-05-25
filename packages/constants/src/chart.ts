/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChartColorScheme } from "@plane/types";
import { ChartXAxisProperty } from "@plane/types";

/**
 * Shared Tailwind classes for axis/chart text labels — uppercase, muted color,
 * fixed 13px size, slight letter-spacing — applied across recharts visualizations
 * for visual consistency.
 *
 * Consumers: `apps/web/core/components/dashboards/**`, `apps/web/core/components/analytics/**`.
 */
export const LABEL_CLASSNAME = "uppercase text-tertiary/60 text-13 tracking-wide";

/**
 * Same uppercase/muted token used specifically by axis labels — kept as a separate
 * export so future axis-only tweaks don't disturb other label callsites.
 *
 * Consumers: chart axis components in `apps/web/core/components/dashboards/**`.
 */
export const AXIS_LABEL_CLASSNAME = "uppercase text-tertiary/60 text-13 tracking-wide";

/**
 * Time bucketing granularity for date-typed x-axes — selects how a date series
 * is aggregated before being plotted.
 *
 * Consumers: chart filter pickers in `apps/web/core/components/dashboards/**`,
 * `apps/web/core/components/analytics/**`.
 */
export enum ChartXAxisDateGrouping {
  DAY = "DAY",
  WEEK = "WEEK",
  MONTH = "MONTH",
  YEAR = "YEAR",
}

/**
 * X-axis property values whose tick labels should be capitalized at render time
 * (priority/state-group names are stored lowercase in the backend payload).
 *
 * Consumers: chart tick formatters in `apps/web/core/components/dashboards/**`.
 */
export const TO_CAPITALIZE_PROPERTIES: ChartXAxisProperty[] = [
  ChartXAxisProperty.PRIORITY,
  ChartXAxisProperty.STATE_GROUPS,
];

/**
 * X-axis properties that produce a date series and therefore need a
 * `ChartXAxisDateGrouping` selector + date-aware tick formatter.
 *
 * Consumers: chart axis-config selectors in `apps/web/core/components/dashboards/**`.
 */
export const CHART_X_AXIS_DATE_PROPERTIES: ChartXAxisProperty[] = [
  ChartXAxisProperty.START_DATE,
  ChartXAxisProperty.TARGET_DATE,
  ChartXAxisProperty.CREATED_AT,
  ChartXAxisProperty.COMPLETED_AT,
];

/**
 * Visual presentation modes available for a chart widget — chosen by the user in
 * the widget config form and mapped to the appropriate recharts composition.
 *
 * Values:
 * - BASIC: single series, single dimension
 * - STACKED: multi-series stacked along the x-axis
 * - GROUPED: multi-series side-by-side groups
 * - MULTI_LINE: multi-series line chart
 * - COMPARISON: paired comparison (e.g., this vs. last period)
 * - PROGRESS: progress-bar style toward a target
 *
 * Consumers: chart-widget config + renderers in `apps/web/core/components/dashboards/**`.
 */
export enum EChartModels {
  BASIC = "BASIC",
  STACKED = "STACKED",
  GROUPED = "GROUPED",
  MULTI_LINE = "MULTI_LINE",
  COMPARISON = "COMPARISON",
  PROGRESS = "PROGRESS",
}

/**
 * Curated chart color palettes used by dashboard widgets. Each entry exposes a
 * `light` and `dark` hex array tuned for theme contrast; the `key` matches the
 * `TChartColorScheme` discriminant persisted on the dashboard widget config.
 *
 * Palettes:
 * - modern: vivid jewel tones for general-purpose dashboards
 * - horizon: warm sunset-leaning palette for analytics widgets
 * - earthen: earth-tone palette emphasizing greens and warm browns
 *
 * Consumers: chart color resolver in `apps/web/core/components/dashboards/**`,
 * widget settings UI for picking a scheme.
 */
export const CHART_COLOR_PALETTES: {
  key: TChartColorScheme;
  i18n_label: string;
  light: string[];
  dark: string[];
}[] = [
  {
    key: "modern",
    i18n_label: "dashboards.widget.color_palettes.modern",
    light: [
      "#6172E8",
      "#8B6EDB",
      "#E05F99",
      "#29A383",
      "#CB8A37",
      "#3AA7C1",
      "#F1B24A",
      "#E84855",
      "#50C799",
      "#B35F9E",
    ],
    dark: [
      "#6B7CDE",
      "#8E9DE6",
      "#D45D9E",
      "#2EAF85",
      "#D4A246",
      "#29A7C1",
      "#B89F6A",
      "#D15D64",
      "#4ED079",
      "#A169A4",
    ],
  },
  {
    key: "horizon",
    i18n_label: "dashboards.widget.color_palettes.horizon",
    light: [
      "#E76E50",
      "#289D90",
      "#F3A362",
      "#E9C368",
      "#264753",
      "#8A6FA0",
      "#5B9EE5",
      "#7CC474",
      "#BA7DB5",
      "#CF8640",
    ],
    dark: [
      "#E05A3A",
      "#1D8A7E",
      "#D98B4D",
      "#D1AC50",
      "#3A6B7C",
      "#7D6297",
      "#4D8ACD",
      "#569C64",
      "#C16A8C",
      "#B77436",
    ],
  },
  {
    key: "earthen",
    i18n_label: "dashboards.widget.color_palettes.earthen",
    light: [
      "#386641",
      "#6A994E",
      "#A7C957",
      "#E97F4E",
      "#BC4749",
      "#9E2A2B",
      "#80CED1",
      "#5C3E79",
      "#526EAB",
      "#6B5B95",
    ],
    dark: [
      "#497752",
      "#7BAA5F",
      "#B8DA68",
      "#FA905F",
      "#CD585A",
      "#AF3B3C",
      "#91DFE2",
      "#6D4F8A",
      "#637FBC",
      "#7C6CA6",
    ],
  },
];
