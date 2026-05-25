/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Chart type vocabulary for the `@plane/types/charts` sub-package.
 *
 * Re-exports the foundational chart row/payload contracts from `./common`
 * (`TChartColorScheme`, `TChartDatum`, `TChart`) and defines the
 * chart-family-specific generic contracts for bar, line, scatter, area,
 * pie, treemap, and radar charts.
 *
 * Consumers: chart renderers in `packages/propel/src/charts/` (one
 * `root.tsx` per family plus the shared `components/legend.tsx`),
 * analytics dashboards in `apps/web/core/components/analytics/`, the
 * chart utility helpers in `apps/web/core/components/chart/utils.ts`,
 * and the sibling `packages/types/src/analytics.ts` which imports
 * `TChartData` directly.
 *
 * Generic parameter convention used throughout this file:
 * - `K extends string`: union of required (categorical/axis) row keys
 *   that every datum must carry.
 * - `T extends string`: union of dynamic series keys that attach
 *   additional numeric/any values per row (e.g., per-priority counts).
 */

// ============================================================
// Chart Base
// ============================================================
export * from "./common";
/**
 * Legend placement and layout configuration for chart components.
 *
 * Consumers: `packages/propel/src/charts/components/legend.tsx` and every
 * chart `root.tsx` in `packages/propel/src/charts/`.
 *
 * `align` is the horizontal anchor, `verticalAlign` is the vertical
 * anchor, and `layout` controls whether legend items flow horizontally
 * or vertically — these three dimensions are independent. `wrapperStyles`
 * is forwarded to the legend container's inline style for ad-hoc layout
 * overrides.
 */
export type TChartLegend = {
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  layout: "horizontal" | "vertical";
  wrapperStyles?: React.CSSProperties;
};

/**
 * Pixel margins applied around the chart plotting area.
 *
 * Consumers: every chart `root.tsx` in `packages/propel/src/charts/`.
 *
 * All four sides are optional — undefined values fall back to the
 * underlying Recharts default margins for the corresponding chart family.
 */
export type TChartMargin = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/**
 * Generic chart row shape combining a required key field with an open
 * record of additional series values.
 *
 * Consumers: `packages/types/src/analytics.ts` (imports `TChartData`
 * directly), every chart `root.tsx` in `packages/propel/src/charts/`, and
 * the analytics chart data builders in `apps/web/core/components/chart/`
 * and `apps/web/core/components/analytics/`.
 *
 * The intersection enforces that every datum carries the categorical
 * axis key(s) named by `K` while still permitting arbitrary additional
 * dynamic series under keys named by `T` — together they form the
 * complete row schema rendered by a chart family.
 */
export type TChartData<K extends string, T extends string> = {
  // required key
  [key in K]: string | number;
} & Record<T, any>;

/**
 * Shared props inherited (directly or via `Pick`) by every chart family
 * component — the common data + presentation contract.
 *
 * Consumers: extended by `TAxisChartProps` (bar/line/scatter/area) and
 * `Pick`-ed by `TPieChartProps` and `TRadarChartProps`; transitively
 * consumed by every chart `root.tsx` in `packages/propel/src/charts/`.
 *
 * Supplying `customTooltipContent` overrides the default Recharts
 * tooltip rendering; the callback receives the live tooltip payload
 * (`active` hover state, `label`, raw `payload`) and may return any
 * React node.
 */
export type TBaseChartProps<K extends string, T extends string> = {
  data: TChartData<K, T>[];
  className?: string;
  legend?: TChartLegend;
  margin?: TChartMargin;
  showTooltip?: boolean;
  customTooltipContent?: (props: { active?: boolean; label: string; payload: any }) => React.ReactNode;
};

// Props specific to charts with X and Y axes
/**
 * Extension of `TBaseChartProps` for chart families that render
 * Cartesian X and Y axes (bar, line, scatter, area).
 *
 * Consumers: extended by `TBarChartProps`, `TLineChartProps`,
 * `TScatterChartProps`, and `TAreaChartProps`.
 *
 * `xAxis.key` and `yAxis.key` are constrained to `keyof TChartData<K, T>`
 * so axis assignment is statically validated against the row shape.
 * `customTicks.{x,y}` are React component types that replace the default
 * tick renderer; `tickCount.{x,y}` request an approximate tick count
 * from Recharts; `yAxis.domain` pins the value range when present
 * (otherwise Recharts derives it from `data`).
 */
export type TAxisChartProps<K extends string, T extends string> = TBaseChartProps<K, T> & {
  xAxis: {
    key: keyof TChartData<K, T>;
    label?: string;
    strokeColor?: string;
    dy?: number;
  };
  yAxis: {
    allowDecimals?: boolean;
    domain?: [number, number];
    key: keyof TChartData<K, T>;
    label?: string;
    strokeColor?: string;
    offset?: number;
    dx?: number;
  };
  tickCount?: {
    x?: number;
    y?: number;
  };
  customTicks?: {
    x?: React.ComponentType<unknown>;
    y?: React.ComponentType<unknown>;
  };
};

// ============================================================
// Bar Chart
// ============================================================

/**
 * Render-shape variant selector for individual bars in a bar chart.
 *
 * Consumers: `packages/propel/src/charts/bar-chart/bar.tsx` switches on
 * this value to choose the per-bar SVG primitive.
 *
 * Union values:
 * - `"bar"`: standard rectangular bar.
 * - `"lollipop"`: thin stem with a solid circular head.
 * - `"lollipop-dotted"`: thin stem with a dotted/outlined head.
 */
export type TBarChartShapeVariant = "bar" | "lollipop" | "lollipop-dotted";

/**
 * Per-series configuration for a single bar in a bar chart.
 *
 * Consumers: `packages/propel/src/charts/bar-chart/root.tsx` and
 * `packages/propel/src/charts/bar-chart/bar.tsx`.
 *
 * `fill` accepts either a static color string OR a function that derives
 * the color from the row payload (used for conditional/threshold
 * coloring). `stackId` groups bars into stacked clusters when shared
 * across multiple entries. `showTopBorderRadius` / `showBottomBorderRadius`
 * are predicates evaluated per-bar so rounded corners can be applied only
 * to the outermost bar in a stacked cluster.
 */
export type TBarItem<T extends string> = {
  key: T;
  label: string;
  fill: string | ((payload: any) => string);
  textClassName: string;
  showPercentage?: boolean;
  stackId: string;
  showTopBorderRadius?: (barKey: string, payload: any) => boolean;
  showBottomBorderRadius?: (barKey: string, payload: any) => boolean;
  shapeVariant?: TBarChartShapeVariant;
};

/**
 * Public props for the bar chart family.
 *
 * Consumers: `packages/propel/src/charts/bar-chart/root.tsx`, and
 * analytics dashboards including
 * `apps/web/core/components/analytics/work-items/priority-chart.tsx`
 * and `apps/web/core/components/analytics/overview/project-insights.tsx`.
 *
 * `barSize` sets the pixel width of each bar; leaving it undefined
 * defers width sizing to Recharts' auto-layout.
 */
export type TBarChartProps<K extends string, T extends string> = TAxisChartProps<K, T> & {
  bars: TBarItem<T>[];
  barSize?: number;
};

// ============================================================
// Line Chart
// ============================================================

/**
 * Per-series configuration for a single line in a line chart.
 *
 * Consumers: `packages/propel/src/charts/line-chart/root.tsx`.
 *
 * `dashedLine` toggles the dashed stroke pattern; `smoothCurves` toggles
 * monotone-curve interpolation versus linear segments; `style` is
 * forwarded to the underlying SVG path element for ad-hoc attribute
 * overrides.
 */
export type TLineItem<T extends string> = {
  key: T;
  label: string;
  dashedLine: boolean;
  fill: string;
  showDot: boolean;
  smoothCurves: boolean;
  stroke: string;
  style?: Record<string, string | number>;
};

/**
 * Public props for the line chart family.
 *
 * Consumers: `packages/propel/src/charts/line-chart/root.tsx`,
 * `apps/web/core/components/analytics/work-items/created-vs-resolved.tsx`,
 * and `apps/web/core/components/core/sidebar/progress-chart.tsx`.
 */
export type TLineChartProps<K extends string, T extends string> = TAxisChartProps<K, T> & {
  lines: TLineItem<T>[];
};

// ============================================================
// Scatter Chart
// ============================================================

/**
 * Per-series configuration for a scatter chart point set.
 *
 * Consumers: `packages/propel/src/charts/scatter-chart/root.tsx`.
 */
export type TScatterPointItem<T extends string> = {
  key: T;
  label: string;
  fill: string;
  stroke: string;
};

/**
 * Public props for the scatter chart family.
 *
 * Consumers: `packages/propel/src/charts/scatter-chart/root.tsx`.
 */
export type TScatterChartProps<K extends string, T extends string> = TAxisChartProps<K, T> & {
  scatterPoints: TScatterPointItem<T>[];
};

// ============================================================
// Area Chart
// ============================================================

/**
 * Per-series configuration for a single area in an area chart.
 *
 * Consumers: `packages/propel/src/charts/area-chart/root.tsx`.
 *
 * `fillOpacity` and `strokeOpacity` are unit-interval values in the
 * range `[0, 1]`; `stackId` groups areas into stacked clusters when
 * shared across multiple entries; `style` is forwarded to the underlying
 * SVG path element.
 */
export type TAreaItem<T extends string> = {
  key: T;
  label: string;
  stackId: string;
  fill: string;
  fillOpacity: number;
  showDot: boolean;
  smoothCurves: boolean;
  strokeColor: string;
  strokeOpacity: number;
  style?: Record<string, string | number>;
};

/**
 * Public props for the area chart family.
 *
 * Consumers: `packages/propel/src/charts/area-chart/root.tsx`.
 *
 * Supplying `comparisonLine` overlays a horizontal reference line across
 * the plotting area (e.g., a target threshold or baseline value) with
 * the supplied stroke color and optional dashed pattern.
 */
export type TAreaChartProps<K extends string, T extends string> = TAxisChartProps<K, T> & {
  areas: TAreaItem<T>[];
  comparisonLine?: {
    dashedLine: boolean;
    strokeColor: string;
  };
};

// ============================================================
// Pie Chart
// ============================================================

/**
 * Color-fill assignment for a single pie chart cell (one wedge).
 *
 * Consumers: `packages/propel/src/charts/pie-chart/root.tsx`.
 */
export type TCellItem<T extends string> = {
  key: T;
  fill: string;
};

/**
 * Public props for the pie chart family — picks the subset of base props
 * that apply to pies (no Cartesian axis configuration).
 *
 * Consumers: `packages/propel/src/charts/pie-chart/root.tsx`.
 *
 * Setting `innerRadius > 0` produces a donut chart; `cornerRadius`
 * rounds the outer wedge corners; `paddingAngle` inserts angular gaps
 * between adjacent wedges. `centerLabel` renders text in the donut's
 * hollow center (only meaningful when `innerRadius > 0`). `customLegend`
 * overrides the default Recharts legend renderer with a caller-supplied
 * React component.
 */
export type TPieChartProps<K extends string, T extends string> = Pick<
  TBaseChartProps<K, T>,
  "className" | "data" | "showTooltip" | "legend" | "margin"
> & {
  dataKey: T;
  cells: TCellItem<T>[];
  innerRadius?: number | string;
  outerRadius?: number | string;
  cornerRadius?: number;
  paddingAngle?: number;
  showLabel: boolean;
  customLabel?: (value: any) => string;
  centerLabel?: {
    className?: string;
    fill: string;
    style?: React.CSSProperties;
    text?: string | number;
  };
  tooltipLabel?: string | ((payload: any) => string);
  customLegend?: (props: any) => React.ReactNode;
};

// ============================================================
// Tree Map
// ============================================================

/**
 * A single rectangle in a treemap chart, sized proportionally by `value`.
 *
 * Consumers: `packages/propel/src/charts/tree-map/root.tsx`.
 *
 * The trailing intersection is a **discriminated union**: each item must
 * carry EITHER `fillColor` (a literal color string) OR `fillClassName`
 * (a Tailwind class name), but never both. This enforces a single source
 * of truth for the fill styling decision at the type level so callers
 * cannot accidentally supply both kinds of fill at once.
 */
export type TreeMapItem = {
  name: string;
  value: number;
  label?: string;
  textClassName?: string;
  icon?: React.ReactElement;
} & (
  | {
      fillColor: string;
    }
  | {
      fillClassName: string;
    }
);

/**
 * Public props for the treemap chart family.
 *
 * Consumers: `packages/propel/src/charts/tree-map/root.tsx`.
 *
 * Treemap data is hierarchical/categorical rather than Cartesian, so
 * this type intentionally does NOT extend `TBaseChartProps` — it defines
 * its own minimal contract instead.
 */
export type TreeMapChartProps = {
  data: TreeMapItem[];
  className?: string;
  isAnimationActive?: boolean;
  showTooltip?: boolean;
};

/**
 * Visibility flags for the top section of a treemap rectangle (icon and
 * primary name placement).
 *
 * Consumers: combined into `TContentVisibility` and applied by
 * `packages/propel/src/charts/tree-map/root.tsx`.
 */
export type TTopSectionConfig = {
  showIcon: boolean;
  showName: boolean;
  nameTruncated: boolean;
};

/**
 * Visibility flags for the bottom section of a treemap rectangle
 * (numeric value and supplementary label).
 *
 * Consumers: combined into `TContentVisibility` and applied by
 * `packages/propel/src/charts/tree-map/root.tsx`.
 *
 * `show` is the master toggle for the entire bottom section; the
 * remaining flags refine which sub-elements render when `show` is true.
 */
export type TBottomSectionConfig = {
  show: boolean;
  showValue: boolean;
  showLabel: boolean;
  labelTruncated: boolean;
};

/**
 * Aggregate visibility configuration combining the top
 * (`TTopSectionConfig`) and bottom (`TBottomSectionConfig`) section
 * configs for a treemap rectangle.
 *
 * Consumers: `packages/propel/src/charts/tree-map/root.tsx`.
 */
export type TContentVisibility = {
  top: TTopSectionConfig;
  bottom: TBottomSectionConfig;
};

// ============================================================
// Radar Chart
// ============================================================

/**
 * Per-series configuration for a single radar polygon.
 *
 * Consumers: `packages/propel/src/charts/radar-chart/root.tsx`.
 *
 * `dot.r` is the radius (in pixels) of the per-vertex data point;
 * omitting the `dot` field hides the dots entirely while leaving the
 * polygon outline and fill intact.
 */
export type TRadarItem<T extends string> = {
  key: T;
  name: string;
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  dot?: {
    r: number;
    fillOpacity: number;
  };
};

/**
 * Public props for the radar chart family — picks the subset of base
 * props that apply to radars (no Cartesian axis configuration).
 *
 * Consumers: `packages/propel/src/charts/radar-chart/root.tsx`.
 *
 * `angleAxis.key` is constrained to `keyof TChartData<K, T>` so the
 * categorical axis label key is statically validated against the row
 * shape, matching the validation applied to `xAxis.key`/`yAxis.key` in
 * `TAxisChartProps`.
 */
export type TRadarChartProps<K extends string, T extends string> = Pick<
  TBaseChartProps<K, T>,
  "className" | "showTooltip" | "margin" | "data" | "legend"
> & {
  dataKey: T;
  radars: TRadarItem<T>[];
  angleAxis: {
    key: keyof TChartData<K, T>;
    label?: string;
    strokeColor?: string;
  };
};
