/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Kanban-specific layout types — extends the shared base layout/group props with an optional `groupClassName` styling hook (kanban renders groups as columns); consumed by `apps/web/core/components/base-layouts/kanban/`.
 */

import type {
  IBaseLayoutsBaseItem,
  IBaseLayoutsBaseProps,
  IBaseLayoutsBaseGroupProps,
  IBaseLayoutsBaseItemProps,
} from "./base";

/**
 * Structural alias of `IBaseLayoutsBaseItem` for kanban cards; gives kanban consumers a semantically specific item type without diverging from the shared base item shape.
 */
export type IBaseLayoutsKanbanItem = IBaseLayoutsBaseItem;

// Main Kanban Layout Props

/**
 * Top-level kanban layout props extending `IBaseLayoutsBaseProps<T>` with `groupClassName?: string`, applied to each rendered column wrapper and merged with kanban defaults by the consumer (e.g., via `cn(...)`).
 */
export interface IBaseLayoutsKanbanProps<T extends IBaseLayoutsKanbanItem> extends IBaseLayoutsBaseProps<T> {
  groupClassName?: string;
}

// Kanban Column/Group Props

/**
 * Per-column kanban props extending `IBaseLayoutsBaseGroupProps<T>` with the `groupClassName` propagated from the parent layout; consumed by `apps/web/core/components/base-layouts/kanban/group.tsx`.
 */
export interface IBaseLayoutsKanbanGroupProps<T extends IBaseLayoutsKanbanItem> extends IBaseLayoutsBaseGroupProps<T> {
  groupClassName?: string;
}

// Kanban Card/Item Props

/**
 * Structural alias of `IBaseLayoutsBaseItemProps<T>` for kanban cards; no per-card configuration beyond the base item props is currently introduced.
 */
export type IBaseLayoutsKanbanItemProps<T extends IBaseLayoutsKanbanItem> = IBaseLayoutsBaseItemProps<T>;
