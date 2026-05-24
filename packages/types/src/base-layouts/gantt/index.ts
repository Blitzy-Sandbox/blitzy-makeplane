/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public Gantt type surface for the `@plane/types/base-layouts` family. Defines
 * Gantt-specific items, update payloads, capabilities, display options, props,
 * and the timeline registry.
 *
 * Differs from `./list` and `./kanban` because Gantt renders blocks on a timeline
 * (not item+group cards): the shared `renderItem` / `enableDragDrop` / `onDrop` /
 * `canDrag` props from `IBaseLayoutsBaseProps<T>` are omitted and replaced with
 * Gantt-specific `renderBlock` + `onBlockUpdate` + `onDateUpdate` callbacks.
 *
 * Consumers (via the `@plane/types` re-export chain):
 *   - apps/web/core/components/base-layouts/gantt/
 *   - apps/web/core/components/issues/issue-layouts/gantt/
 *   - apps/web/core/components/modules/gantt-chart/
 *   - apps/web/core/components/gantt-chart/
 *   - apps/web/core/hooks/use-timeline-chart.ts
 *   - apps/web/ce/hooks/use-timeline-chart.ts
 *   - apps/web/core/layouts/auth-layout/project-wrapper.tsx
 */

import type { ReactNode } from "react";
import type { IBaseLayoutsBaseItem, IBaseLayoutsBaseProps } from "../base";
import { CORE_GANTT_TIMELINE_TYPE } from "./core";
import { EXTENDED_GANTT_TIMELINE_TYPE } from "./extended";

// Gantt-specific item with date fields
/**
 * Gantt-renderable item — extends the shared {@link IBaseLayoutsBaseItem} with
 * optional start/target dates that position the block on the timeline axis.
 *
 * Fields:
 * - `start_date` — ISO date string (or `null` to clear); items lacking a
 *   `start_date` are hidden from the timeline unless
 *   {@link TGanttDisplayOptions.showAllBlocks} is `true`.
 * - `target_date` — ISO date string (or `null` to clear); marks the end of
 *   the Gantt block on the timeline.
 */
export interface IBaseLayoutsGanttItem extends IBaseLayoutsBaseItem {
  start_date?: string | null;
  target_date?: string | null;
}

// Block update data (for drag/resize operations)
/**
 * Payload delivered to {@link IBaseLayoutsGanttProps.onBlockUpdate} when a
 * single block is dragged along the timeline, resized at either edge, or
 * reordered within the sidebar.
 *
 * Fields:
 * - `start_date` / `target_date` — present when the block is moved or resized
 *   (omitted fields are left unchanged on the server).
 * - `sort_order` — present only on sidebar reorders; `destinationIndex` is the
 *   zero-based row position and `newSortOrder` is the floating-point sort key
 *   that consumers persist so subsequent reorders remain stable.
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
 * Per-item date-update payload used in the bulk array passed to
 * {@link IBaseLayoutsGanttProps.onDateUpdate} — typically when shifting a parent
 * block propagates new dates through dependency arrows to one or more children.
 *
 * Fields:
 * - `id` — item id whose dates are being updated.
 * - `start_date` / `target_date` — ISO date strings; omitted fields are left
 *   unchanged on the server.
 */
export type TGanttDateUpdate = {
  id: string;
  start_date?: string;
  target_date?: string;
};

// Render props specific to Gantt
/**
 * Render-prop contract for Gantt blocks and sidebar entries.
 *
 * Why Gantt has its own render contract: positioning and sizing of a block are
 * computed by the Gantt core from `start_date`/`target_date`, so consumers only
 * supply the visual cell — not the geometry.
 *
 * Fields:
 * - `renderBlock` — required; renders the timeline block (Gantt core handles
 *   positioning and sizing).
 * - `renderSidebar` — optional; renders the row's left sidebar cell (typically
 *   the item title plus metadata).
 *
 * @template T - Concrete item type, must extend {@link IBaseLayoutsGanttItem}.
 */
export interface IGanttRenderProps<T extends IBaseLayoutsGanttItem> {
  renderBlock: (item: T) => ReactNode;
  renderSidebar?: (item: T) => ReactNode;
}

// Gantt-specific capabilities
/**
 * Per-feature enablement flags that gate Gantt interactivity (resize, move,
 * reorder, add, select, dependency).
 *
 * Why each flag is `boolean | ((itemId: string) => boolean)`: this dual form
 * lets consumers either toggle a capability globally with a boolean OR supply
 * a predicate for per-item gating (e.g., locking a single row from resize)
 * without forcing every consumer to wrap their flag in a function.
 *
 * Flags:
 * - `enableBlockLeftResize` — left-edge resize gesture.
 * - `enableBlockRightResize` — right-edge resize gesture.
 * - `enableBlockMove` — full-block move gesture along the timeline.
 * - `enableReorder` — sidebar row reorder gesture.
 * - `enableAddBlock` — inline "add block" affordance.
 * - `enableSelection` — block selection state toggle.
 * - `enableDependency` — dependency-arrow creation gesture between blocks.
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
 * Visual configuration for the Gantt timeline.
 *
 * Fields:
 * - `showAllBlocks` — render blocks even when `start_date`/`target_date` are
 *   missing (otherwise undated items are hidden from the timeline).
 * - `showToday` — highlight the current date column.
 * - `border` — render the outer container border.
 * - `title` — header title shown above the timeline.
 * - `loaderTitle` — title shown by the loader chrome while data loads.
 * - `quickAdd` — optional pre-rendered quick-add affordance node.
 * - `timelineType` — which timeline category (core or extended) selects the
 *   underlying store (see {@link TTimelineType}).
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
 * Top-level props contract for the Gantt layout component — composes the shared
 * base layout props with Gantt-specific render, capability, and display
 * contracts.
 *
 * Why `Omit<IBaseLayoutsBaseProps<T>, "renderItem" | "enableDragDrop" |
 * "onDrop" | "canDrag">`: Gantt does not use item-level drag/drop or
 * `renderItem` rendering — those concerns are replaced by `renderBlock`
 * (geometry computed by the Gantt core) plus `onBlockUpdate` / `onDateUpdate`
 * mutation callbacks. The `Omit` prevents consumers from supplying props that
 * the Gantt layout cannot honor.
 *
 * Local fields:
 * - `onBlockUpdate` — invoked when a single block's position, dates, or sort
 *   order change (see {@link TGanttBlockUpdateData}).
 * - `onDateUpdate` — invoked with a bulk array of per-item date updates, used
 *   for dependency propagation when a parent's date change cascades to
 *   children (see {@link TGanttDateUpdate}).
 *
 * @template T - Concrete item type, must extend {@link IBaseLayoutsGanttItem}.
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
 * Merged registry of every Gantt timeline category available in this build —
 * combines the core set with edition-specific extended entries.
 *
 * Why `{ ...CORE_GANTT_TIMELINE_TYPE, ...EXTENDED_GANTT_TIMELINE_TYPE } as
 * const`: the `as const` assertion preserves literal string types so the
 * derived {@link TTimelineType} union resolves to specific string literals
 * (e.g. `"ISSUE" | "MODULE" | …`) rather than widening to `string`.
 *
 * Consumers use this for runtime comparisons against timeline categories
 * (e.g., `if (timelineType === GANTT_TIMELINE_TYPE.ISSUE) …`).
 */
export const GANTT_TIMELINE_TYPE = {
  ...CORE_GANTT_TIMELINE_TYPE,
  ...EXTENDED_GANTT_TIMELINE_TYPE,
} as const;

/**
 * Union of the core timeline literal values (currently `"ISSUE" | "MODULE" |
 * "PROJECT" | "GROUPED"`, sourced from `CORE_GANTT_TIMELINE_TYPE`).
 *
 * Why a distinct core-only type exists: community-edition code paths
 * (e.g. `apps/web/ce/hooks/use-timeline-chart.ts`) constrain parameters to the
 * core set when extended-edition values would be inappropriate.
 */
export type TTimelineTypeCore = (typeof CORE_GANTT_TIMELINE_TYPE)[keyof typeof CORE_GANTT_TIMELINE_TYPE];
/**
 * Union of every timeline literal value in this build — core ∪ extended.
 *
 * Relationship to {@link TTimelineTypeCore}: `TTimelineTypeCore` is a strict
 * subset accepted everywhere; `TTimelineType` is the full superset that the
 * downstream Gantt rendering layer accepts. In the community-edition build,
 * `EXTENDED_GANTT_TIMELINE_TYPE` is empty so the two unions resolve to the
 * same set, but downstream editions may add entries that extend this union
 * automatically.
 *
 * Consumed by `TGanttDisplayOptions.timelineType`,
 * `apps/web/core/hooks/use-timeline-chart.ts`, and every Gantt consumer.
 */
export type TTimelineType =
  | TTimelineTypeCore
  | (typeof EXTENDED_GANTT_TIMELINE_TYPE)[keyof typeof EXTENDED_GANTT_TIMELINE_TYPE];
