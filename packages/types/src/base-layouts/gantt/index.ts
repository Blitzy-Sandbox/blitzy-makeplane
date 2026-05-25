/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public Gantt typing surface — Gantt-specific items/update payloads/capabilities/display options/props + the timeline registry, replacing the shared `renderItem`/drag handlers with timeline-block-aware `renderBlock` + `onBlockUpdate` + `onDateUpdate`.
 * Consumed by `apps/web/core/components/{base-layouts,issues/issue-layouts,modules,gantt-chart}/gantt*` and `apps/web/{core,ce}/hooks/use-timeline-chart.ts`.
 */

import type { ReactNode } from "react";
import type { IBaseLayoutsBaseItem, IBaseLayoutsBaseProps } from "../base";
import { CORE_GANTT_TIMELINE_TYPE } from "./core";
import { EXTENDED_GANTT_TIMELINE_TYPE } from "./extended";

// Gantt-specific item with date fields
/**
 * Gantt-renderable item extending `IBaseLayoutsBaseItem` with ISO-date `start_date` / `target_date`; items lacking `start_date` are hidden unless `TGanttDisplayOptions.showAllBlocks` is `true`.
 */
export interface IBaseLayoutsGanttItem extends IBaseLayoutsBaseItem {
  start_date?: string | null;
  target_date?: string | null;
}

// Block update data (for drag/resize operations)
/**
 * `IBaseLayoutsGanttProps.onBlockUpdate` payload — `start_date`/`target_date` carry move/resize edits (omitted = unchanged), and `sort_order` (set only on sidebar reorders) carries `destinationIndex` plus the floating-point `newSortOrder` that consumers persist for stable subsequent reorders.
 */
export type TGanttBlockUpdateData = {
  start_date?: string;
  target_date?: string;
  sort_order?: {
    destinationIndex: number;
    newSortOrder: number;
  };
};

// Date update handler for bulk date changes (e.g., dependency updates)
/**
 * Per-item entry in the bulk `IBaseLayoutsGanttProps.onDateUpdate` array — typically emitted when a parent's date shift propagates through dependency arrows to one or more children; omitted ISO-date fields are left unchanged server-side.
 */
export type TGanttDateUpdate = {
  id: string;
  start_date?: string;
  target_date?: string;
};

// Render props specific to Gantt
/**
 * Render-prop contract for Gantt blocks and sidebar cells — consumers supply visuals only; the Gantt core computes positioning/sizing from `start_date`/`target_date`.
 *
 * @template T - Concrete item type, must extend `IBaseLayoutsGanttItem`.
 */
export interface IGanttRenderProps<T extends IBaseLayoutsGanttItem> {
  renderBlock: (item: T) => ReactNode;
  renderSidebar?: (item: T) => ReactNode;
}

// Gantt-specific capabilities
/**
 * Per-feature enablement flags gating Gantt interactivity (resize/move/reorder/add/select/dependency); each flag is `boolean | ((itemId: string) => boolean)` so consumers can toggle globally or gate per-item without wrapping every flag in a function.
 */
export interface IGanttCapabilities {
  enableBlockLeftResize?: boolean | ((itemId: string) => boolean);
  enableBlockRightResize?: boolean | ((itemId: string) => boolean);
  enableBlockMove?: boolean | ((itemId: string) => boolean);
  enableReorder?: boolean | ((itemId: string) => boolean);
  enableAddBlock?: boolean | ((itemId: string) => boolean);
  enableSelection?: boolean | ((itemId: string) => boolean);
  enableDependency?: boolean | ((itemId: string) => boolean);
}

// Gantt display options
/**
 * Visual configuration for the Gantt timeline (showAllBlocks/showToday/border/title/loaderTitle/quickAdd/timelineType); `showAllBlocks` overrides the default "hide undated items" rule, and `timelineType` picks the underlying store category via `TTimelineType`.
 */
export type TGanttDisplayOptions = {
  showAllBlocks?: boolean; // Show blocks even without dates
  showToday?: boolean; // Highlight today on timeline
  border?: boolean;
  title?: string;
  loaderTitle?: string;
  quickAdd?: ReactNode;
  timelineType?: TTimelineType; // Type of timeline to use for store
};

// Main Gantt Layout Props
/**
 * Top-level Gantt layout props — `Omit`s the shared `renderItem`/drag handlers from `IBaseLayoutsBaseProps<T>` (Gantt computes geometry from dates) and composes `IGanttRenderProps` + `IGanttCapabilities` + `TGanttDisplayOptions` plus `onBlockUpdate` / `onDateUpdate` mutation callbacks.
 *
 * @template T - Concrete item type, must extend `IBaseLayoutsGanttItem`.
 */
export interface IBaseLayoutsGanttProps<T extends IBaseLayoutsGanttItem>
  extends
    Omit<IBaseLayoutsBaseProps<T>, "renderItem" | "enableDragDrop" | "onDrop" | "canDrag">,
    IGanttRenderProps<T>,
    IGanttCapabilities,
    TGanttDisplayOptions {
  // Handler for block updates (position, dates, order)
  onBlockUpdate?: (item: T, payload: TGanttBlockUpdateData) => void | Promise<void>;

  // Handler for bulk date updates (dependencies, etc.)
  onDateUpdate?: (updates: TGanttDateUpdate[]) => void | Promise<void>;
}

/**
 * Merged Gantt timeline registry (core ∪ extended) used for runtime comparisons (`if (timelineType === GANTT_TIMELINE_TYPE.ISSUE) …`); the `as const` assertion preserves literal string types so `TTimelineType` resolves to a specific union rather than widening to `string`.
 */
export const GANTT_TIMELINE_TYPE = {
  ...CORE_GANTT_TIMELINE_TYPE,
  ...EXTENDED_GANTT_TIMELINE_TYPE,
} as const;

/**
 * Core-only timeline literal union (`"ISSUE" | "MODULE" | "PROJECT" | "GROUPED"`) used by community-edition code paths (e.g., `apps/web/ce/hooks/use-timeline-chart.ts`) that must reject extended-edition values.
 */
export type TTimelineTypeCore = (typeof CORE_GANTT_TIMELINE_TYPE)[keyof typeof CORE_GANTT_TIMELINE_TYPE];
/**
 * Full timeline-literal union (core ∪ extended) accepted by `TGanttDisplayOptions.timelineType` and `apps/web/core/hooks/use-timeline-chart.ts`; equals `TTimelineTypeCore` in community builds where `EXTENDED_GANTT_TIMELINE_TYPE` is empty.
 */
export type TTimelineType =
  | TTimelineTypeCore
  | (typeof EXTENDED_GANTT_TIMELINE_TYPE)[keyof typeof EXTENDED_GANTT_TIMELINE_TYPE];
