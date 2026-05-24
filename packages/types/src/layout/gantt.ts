/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Gantt chart layout contracts for the `@plane/types/layout` subfolder.
 *
 * Models the data shapes needed to render the timeline / Gantt view — block
 * positions, date ranges, drag state, dependency-update payloads, view-mode
 * granularity, and computed chart layout primitives. Distinct from
 * `../base-layouts/gantt/` which holds the shared list / kanban / Gantt
 * rendering primitives.
 *
 * Consumers: `apps/web/core/components/gantt-chart/`,
 * `apps/web/core/components/issues/issue-layouts/gantt/`,
 * `apps/web/core/components/modules/gantt-chart/`,
 * `apps/web/core/components/base-layouts/gantt/`,
 * `apps/web/core/store/issue/issue_gantt_view.store.ts`,
 * `apps/web/ce/store/timeline/base-timeline.store.ts`.
 */

/**
 * Hierarchical classification for blocks rendered on the Gantt timeline.
 *
 * Used by `apps/web/ce/store/timeline/base-timeline.store.ts` to discriminate
 * block kinds when traversing nested timeline data.
 *
 * Values:
 * - `EPIC = "epic"`     — top-level grouping spanning multiple projects/issues.
 * - `PROJECT = "project"` — project-level container block.
 * - `ISSUE = "issue"`   — leaf-level work item block.
 */
export enum EGanttBlockType {
  EPIC = "epic",
  PROJECT = "project",
  ISSUE = "issue",
}
/**
 * Primary block model for a row rendered on the Gantt timeline.
 *
 * Each block wraps a domain entity (issue, module, cycle, project) and carries
 * the schedule + render metadata the chart needs to position it.
 *
 * Fields with non-obvious semantics:
 * - `data`: opaque domain payload (issue, module, cycle, project) — kept as
 *   `any` because consumers receive heterogeneous entity shapes from
 *   different MobX stores; the caller narrows the type at the render site.
 * - `position`: optional pixel offset (`marginLeft`) and `width` computed from
 *   `ChartDataTypeData.dayWidth`; absent until the chart layout pass has run.
 * - `sort_order`: nullable sidebar ordering key — `undefined` until the block
 *   has been positioned by the sidebar ordering pass.
 * - `start_date` / `target_date`: ISO date strings; `undefined` indicates an
 *   unscheduled block that should not render a horizontal bar.
 * - `meta`: free-form metadata bag for domain-specific extensions (e.g. parent
 *   IDs, color tokens) without polluting the shared shape.
 */
export interface IGanttBlock {
  data: any;
  id: string;
  name: string;
  position?: {
    marginLeft: number;
    width: number;
  };
  sort_order: number | undefined;
  start_date: string | undefined;
  target_date: string | undefined;
  meta?: Record<string, any>;
}

/**
 * Partial-update payload emitted by Gantt sidebar reorder and timeline
 * drag / resize interactions; passed to the consumer's `blockUpdateHandler`.
 *
 * All fields are optional — present fields communicate the slice of state that
 * changed, absent fields are unchanged.
 *
 * Fields with non-obvious semantics:
 * - `sort_order`: emitted only by sidebar reorder gestures — carries the
 *   pre-drop `sourceIndex`, post-drop `destinationIndex`, and the resolved
 *   `newSortOrder` so consumers can persist the new ordering without recomputing.
 * - `start_date` / `target_date`: ISO date strings emitted by timeline drag /
 *   resize gestures.
 * - `meta`: optional metadata patch merged into the block's existing `meta`.
 */
export interface IBlockUpdateData {
  sort_order?: {
    destinationIndex: number;
    newSortOrder: number;
    sourceIndex: number;
  };
  start_date?: string;
  target_date?: string;
  meta?: Record<string, any>;
}

/**
 * Block-id-targeted partial update used for batched dependency-aware date
 * propagation (e.g. when moving one block also shifts its dependents).
 *
 * Differs from `IBlockUpdateData` in that `id` is REQUIRED — callers submit
 * arrays of these payloads (see `updateIssueDates(updates: IBlockUpdateDependencyData[])`
 * in `apps/web/core/store/issue/helpers/base-issues.store.ts`) and the receiver
 * routes each entry to the correct block.
 *
 * Fields with non-obvious semantics:
 * - `id` (required): target block identifier.
 * - `start_date` / `target_date`: optional ISO date strings — only the present
 *   field is persisted; the missing one is left unchanged.
 * - `meta`: optional metadata patch.
 */
export interface IBlockUpdateDependencyData {
  id: string;
  start_date?: string;
  target_date?: string;
  meta?: Record<string, any>;
}

/**
 * Discriminant union for the Gantt chart zoom / granularity level.
 *
 * Default value is `"month"` (see `issue_gantt_view.store.ts` initializer).
 *
 * Members:
 * - `"week"`    — day-resolution rendering, 7-column repeating header.
 * - `"month"`   — day-resolution rendering, month-banner header.
 * - `"quarter"` — week-resolution rendering, quarter-banner header.
 */
export type TGanttViews = "week" | "month" | "quarter";

// chart render types
/**
 * Common label record reused for weekdays (7), months (12), and quarters (4).
 *
 * Backing data lives in `apps/web/core/components/gantt-chart/data/index.ts`
 * as the `weeks`, `months`, and `quarters` arrays.
 *
 * Fields with non-obvious semantics:
 * - `key`: zero-indexed slot (`0-6` for weekdays starting Sunday, `0-11` for
 *   months starting January, `0-3` for quarters starting Q1).
 * - `shortTitle`: short lowercase label (e.g. `"sun"`, `"jan"`, `"Q1"`).
 * - `title`: full human-readable label (e.g. `"sunday"`, `"january"`,
 *   `"Jan - Mar"`).
 * - `abbreviation`: one- or two-character abbreviation used in narrow chart
 *   columns (e.g. `"Su"`, `"Jan"`, `"Q1"`).
 */
export interface WeekMonthDataType {
  key: number;
  shortTitle: string;
  title: string;
  abbreviation: string;
}

/**
 * Top-level chart payload describing a single rendered view of the Gantt
 * timeline — the resolved zoom level, its i18n title key, and the computed
 * layout primitives needed to position blocks.
 *
 * Stored on the Gantt-view MobX store (`issue_gantt_view.store.ts`
 * `currentViewData`) and consumed by chart rendering helpers
 * (`apps/web/core/components/gantt-chart/views/{week,month,quarter}-view.ts`).
 *
 * Fields with non-obvious semantics:
 * - `key`: matches the active `TGanttViews` discriminant (`"week"`, `"month"`,
 *   `"quarter"`).
 * - `i18n_title`: i18n message key — not a translated string. The rendering
 *   layer resolves it through the translation pipeline.
 * - `data`: the computed timeline layout primitives (see `ChartDataTypeData`).
 */
export interface ChartDataType {
  key: string;
  i18n_title: string;
  data: ChartDataTypeData;
}

/**
 * Computed timeline layout primitives produced by the per-view generators
 * (`generateWeekChart`, `generateMonthChart`, `generateQuarterChart`).
 *
 * Drives both header rendering and block positioning math
 * (`getDateFromPositionOnGantt`, `getPositionFromDate`) in
 * `apps/web/core/components/gantt-chart/views/helpers.ts`.
 *
 * Fields with non-obvious semantics:
 * - `startDate` / `endDate`: window boundaries of the currently rendered
 *   chart — recomputed on view change and on horizontal scroll-paging.
 * - `currentDate`: "today" marker reference used by the today-indicator overlay.
 * - `approxFilterRange`: approximate width (in chart-native units, days for
 *   week/month and weeks for quarter) of the visible filter window — used to
 *   pre-size the virtualized render range.
 * - `dayWidth`: pixel width of one day on the timeline — the multiplier used
 *   to convert `IGanttBlock.start_date` / `target_date` deltas into pixel
 *   `position.marginLeft` and `position.width`.
 */
export interface ChartDataTypeData {
  startDate: Date;
  currentDate: Date;
  endDate: Date;
  approxFilterRange: number;
  dayWidth: number;
}
