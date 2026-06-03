/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pragmatic drag-and-drop helper type contracts for the `@plane/types` package.
 *
 * Mirrors the shapes produced by `@atlaskit/pragmatic-drag-and-drop` so consumers
 * can type drop handlers without depending on the library's internal types directly.
 * Used by issue layouts (kanban, list), gantt rows, page hierarchy, and other DnD surfaces.
 */

/**
 * Single drop target descriptor produced by pragmatic-drag-and-drop monitors.
 *
 * Fields:
 * - `element`: DOM element bound to the drop target (used to compute drop position)
 * - `data`: caller-supplied payload identifying the target (free-form record)
 */
export type TDropTarget = {
  element: Element;
  data: Record<string | symbol, unknown>;
};

/**
 * Auxiliary drop-target metadata produced by pragmatic-drag-and-drop.
 *
 * Fields:
 * - `dropEffect`: HTML5 drag-and-drop effect ("copy" | "move" | "link" | "none")
 * - `isActiveDueToStickiness`: true when the target is held active by sticky hover rules
 *   rather than direct cursor presence; relevant for nested drop zones
 */
export type TDropTargetMiscellaneousData = {
  dropEffect: string;
  isActiveDueToStickiness: boolean;
};

/**
 * Drop position history snapshot for a single drag operation.
 *
 * Tracks `initial`, `current`, and `previous` drop targets so consumers can detect
 * transitions and animate accordingly.
 */
export interface IPragmaticPayloadLocation {
  initial: {
    dropTargets: (TDropTarget & TDropTargetMiscellaneousData)[];
  };
  current: {
    dropTargets: (TDropTarget & TDropTargetMiscellaneousData)[];
  };
  previous: {
    dropTargets: (TDropTarget & TDropTargetMiscellaneousData)[];
  };
}

/**
 * Payload delivered to `onDrop` handlers by pragmatic-drag-and-drop monitors.
 *
 * Fields:
 * - `location`: drop position history (see `IPragmaticPayloadLocation`)
 * - `source`: descriptor for the dragged item
 * - `self`: descriptor for the active drop target receiving the drop
 */
export interface IPragmaticDropPayload {
  location: IPragmaticPayloadLocation;
  source: TDropTarget;
  self: TDropTarget & TDropTargetMiscellaneousData;
}

/**
 * Tree-reorder instructions resolved by the pragmatic tree-item adapter.
 *
 * Union discriminant values:
 * - `reparent`: drop becomes a child of a new parent
 * - `reorder-above`: drop inserts above the hovered sibling
 * - `reorder-below`: drop inserts below the hovered sibling
 * - `make-child`: drop nests inside the hovered item as a child
 * - `instruction-blocked`: drop is rejected (e.g. cycle, permission)
 */
export type InstructionType = "reparent" | "reorder-above" | "reorder-below" | "make-child" | "instruction-blocked";
