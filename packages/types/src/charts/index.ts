/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Chart type vocabulary for `@plane/types/charts` — re-exports `./common`
 * and defines generic contracts for bar/line/scatter/area/pie/treemap/radar
 * families consumed by `packages/propel/src/charts/` and analytics dashboards.
 *
 * Generic params: `K extends string` = required categorical/axis row keys;
 * `T extends string` = dynamic series keys (e.g., per-priority counts).
 */

// ============================================================
// Chart Base
// ============================================================
export * from "./common";
/**
 * Legend placement/layout config for chart components — independent
 * `align`/`verticalAlign`/`layout` axes plus optional `wrapperStyles`
 * forwarded to the legend container's inline style.
 *
 * Consumers: `packages/propel/src/charts/components/legend.tsx`.
 */
export type TChartLegend = {
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  layout: "horizontal" | "vertical";
  wrapperStyles?: React.CSSProperties;
};

/**
 * Pixel margins around the chart plotting area; any omitted side falls
 * back to the underlying Recharts default for that chart family.
 *
 * Consumers: every chart `root.tsx` in `packages/propel/src/charts/`.
 */
export type TChartMargin = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/**
 * Generic chart row: every datum must carry the categorical axis key(s)
 * named by `K`, plus arbitrary additional dynamic series under keys named
 * by `T` (forming the complete row schema for a chart family).
 *
 * Consumers: `packages/types/src/analytics.ts`, every chart `root.tsx`
 * in `packages/propel/src/charts/`, and `apps/web/core/components/chart/`.
 */
export type TChartData<K extends string, T extends string> = {
  // required key
  [key in K]: string | number;
} & Record<T, any>;

/**
 * Common data + presentation contract inherited by every chart family
 * (extended by `TAxisChartProps`, `Pick`-ed by `TPieChartProps`/`TRadarChartProps`);
 * `customTooltipContent` overrides the default Recharts tooltip renderer.
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
 * Extension of `TBaseChartProps` for Cartesian X/Y chart families
 * (bar/line/scatter/area); axis `key` fields are constrained to
 * `keyof TChartData<K, T>` so axis assignment is statically validated.
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
 * Render-shape variant selector for bars: `"bar"` (rectangle),
 * `"lollipop"` (stem + solid head), or `"lollipop-dotted"` (stem + dotted head),
 * switched on by `packages/propel/src/charts/bar-chart/bar.tsx`.
 */
export type TBarChartShapeVariant = "bar" | "lollipop" | "lollipop-dotted";

/**
 * Per-series config for a single bar — `fill` may be a static color or a
 * payload-derived function (for conditional/threshold coloring); `stackId`
 * groups bars into stacked clusters; border-radius predicates restrict
 * rounded corners to the outermost bar in a stack.
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
 * Public props for the bar chart family; `barSize` pins each bar's pixel
 * width (undefined defers sizing to Recharts auto-layout).
 *
 * Consumers: `packages/propel/src/charts/bar-chart/root.tsx` and
 * analytics dashboards in `apps/web/core/components/analytics/`.
 */
export type TBarChartProps<K extends string, T extends string> = TAxisChartProps<K, T> & {
  bars: TBarItem<T>[];
  barSize?: number;
};

// ============================================================
// Line Chart
// ============================================================

/**
 * Per-series config for a single line — `dashedLine` toggles the dashed
 * stroke pattern, `smoothCurves` toggles monotone-curve interpolation
 * versus linear segments, and `style` forwards to the underlying SVG path.
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
 * Public props for the line chart family; consumed by
 * `packages/propel/src/charts/line-chart/root.tsx` and analytics dashboards
 * in `apps/web/core/components/analytics/` and `core/sidebar/`.
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
 * Per-series config for a single area — `fillOpacity`/`strokeOpacity` are
 * unit-interval values in `[0, 1]`, `stackId` groups areas into stacked
 * clusters, and `style` forwards to the underlying SVG path.
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
 * Public props for the area chart family; supplying `comparisonLine`
 * overlays a horizontal reference line (e.g., target threshold) with the
 * given stroke color and optional dashed pattern.
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
 * Public props for the pie chart family (subset of base props — no
 * Cartesian axes); `innerRadius > 0` produces a donut, `centerLabel` is
 * only meaningful with `innerRadius > 0`, and `customLegend` overrides
 * the default Recharts legend renderer.
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
 * Treemap rectangle (sized proportionally by `value`); the trailing
 * intersection is a discriminated union enforcing EITHER `fillColor`
 * (literal color) OR `fillClassName` (Tailwind class), never both.
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
 * Public props for the treemap chart family; intentionally does NOT
 * extend `TBaseChartProps` because treemap data is hierarchical/categorical
 * rather than Cartesian, so this type defines its own minimal contract.
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
 * Visibility flags for a treemap rectangle's bottom section (value/label) —
 * `show` is the master toggle and the remaining flags refine which
 * sub-elements render when `show` is true.
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
 * Per-series config for a single radar polygon; `dot.r` is the per-vertex
 * point radius in pixels, and omitting `dot` hides the dots entirely
 * while leaving the polygon outline and fill intact.
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
 * Public props for the radar chart family (subset of base props — no
 * Cartesian axes); `angleAxis.key` is constrained to `keyof TChartData<K, T>`
 * so the categorical axis label key is statically validated against the row.
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
