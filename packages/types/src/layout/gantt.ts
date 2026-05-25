/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Gantt chart layout contracts (block positions, drag payloads, view-mode
 * granularity, computed chart primitives); distinct from `../base-layouts/gantt/`
 * shared rendering primitives. Consumed by `apps/web/core/components/gantt-chart/`,
 * `apps/web/core/store/issue/issue_gantt_view.store.ts`, and timeline stores.
 */

/**
 * Hierarchical classification for Gantt timeline rows used by
 * `apps/web/ce/store/timeline/base-timeline.store.ts` to discriminate block kinds.
 */
export enum EGanttBlockType {
  EPIC = "epic",
  PROJECT = "project",
  ISSUE = "issue",
}
/**
 * Block wrapping a domain entity (issue/module/cycle/project) with schedule and
 * render metadata; `data` is `any` because consumers receive heterogeneous shapes
 * and narrow at the render site, and `position` is absent until the chart layout
 * pass runs.
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
 * Partial-update payload emitted by sidebar reorder and timeline drag/resize
 * gestures and passed to `blockUpdateHandler`; only present fields are persisted,
 * and `sort_order` carries source+destination indices so the new ordering can be
 * stored without recomputation.
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
 * propagation; differs from `IBlockUpdateData` in that `id` is REQUIRED (callers
 * submit arrays via `updateIssueDates` in `apps/web/core/store/issue/helpers/base-issues.store.ts`).
 */
export interface IBlockUpdateDependencyData {
  id: string;
  start_date?: string;
  target_date?: string;
  meta?: Record<string, any>;
}

/**
 * Gantt zoom/granularity discriminant; default is `"month"` (see
 * `issue_gantt_view.store.ts` initializer). `"week"`/`"month"` render at day
 * resolution, `"quarter"` at week resolution.
 */
export type TGanttViews = "week" | "month" | "quarter";

// chart render types
/**
 * Common label record reused for weekdays, months, and quarters; backing data
 * lives in `apps/web/core/components/gantt-chart/data/index.ts`. `key` is the
 * zero-indexed slot (e.g. `0-6` for weekdays starting Sunday).
 */
export interface WeekMonthDataType {
  key: number;
  shortTitle: string;
  title: string;
  abbreviation: string;
}

/**
 * Top-level Gantt chart payload (zoom level + i18n key + computed layout) stored
 * on `issue_gantt_view.store.ts::currentViewData`; `i18n_title` is a translation
 * key, not a translated string.
 */
export interface ChartDataType {
  key: string;
  i18n_title: string;
  data: ChartDataTypeData;
}

/**
 * Computed timeline layout primitives produced by per-view generators
 * (`generateWeekChart`/`generateMonthChart`/`generateQuarterChart`); `dayWidth`
 * is the pixel multiplier used to convert block date deltas to `position`.
 */
export interface ChartDataTypeData {
  startDate: Date;
  currentDate: Date;
  endDate: Date;
  approxFilterRange: number;
  dayWidth: number;
}
