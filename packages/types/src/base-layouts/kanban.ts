/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Kanban layout-specific type aliases and prop extensions for the
 * `@plane/types/base-layouts` family.
 *
 * Kanban renders groups as visually distinct columns, so it extends the
 * shared base group/layout props with an optional `groupClassName` styling
 * hook — `./list` does not need this because list groups are not styled as
 * columns.
 *
 * Consumers: `apps/web/core/components/base-layouts/kanban/` (`layout.tsx`,
 * `group.tsx`, `group-header.tsx`).
 */

import type {
  IBaseLayoutsBaseItem,
  IBaseLayoutsBaseProps,
  IBaseLayoutsBaseGroupProps,
  IBaseLayoutsBaseItemProps,
} from "./base";

/**
 * Minimal contract for a card rendered inside the kanban layout.
 *
 * Structural alias of `IBaseLayoutsBaseItem`: requires only a string `id`
 * with arbitrary keyed payload data permitted by the index signature. The
 * alias gives kanban consumers a semantically specific item type without
 * diverging from the shared base item shape.
 *
 * Consumers: `apps/web/core/components/base-layouts/kanban/` files that
 * constrain their `T extends IBaseLayoutsKanbanItem` generic.
 */
export type IBaseLayoutsKanbanItem = IBaseLayoutsBaseItem;

// Main Kanban Layout Props

/**
 * Top-level props contract for the kanban layout component.
 *
 * Extends `IBaseLayoutsBaseProps<T>` with kanban-specific column styling.
 * All other props (`items`, `groupedItemIds`, `groups`, drag/drop, render
 * props, collapse state, loading, pagination, `className`) are inherited
 * from the base layout contract.
 *
 * Fields with non-obvious semantics:
 * - `groupClassName?: string` — optional Tailwind/CSS class applied to each
 *   rendered kanban column wrapper; merged with the kanban's default column
 *   classes by the consumer (e.g., via `cn(...)`).
 *
 * Consumers: `apps/web/core/components/base-layouts/kanban/layout.tsx`
 * (`BaseKanbanLayout`).
 */
export interface IBaseLayoutsKanbanProps<T extends IBaseLayoutsKanbanItem> extends IBaseLayoutsBaseProps<T> {
  groupClassName?: string;
}

// Kanban Column/Group Props

/**
 * Props contract for an individual kanban column (a single group rendered as a column).
 *
 * Extends `IBaseLayoutsBaseGroupProps<T>` with the same `groupClassName` so
 * the per-column subcomponent can receive the styling hook from the parent
 * layout.
 *
 * Fields with non-obvious semantics:
 * - `groupClassName?: string` — propagated from
 *   `IBaseLayoutsKanbanProps.groupClassName`; applied to the column wrapper.
 *
 * Consumers: `apps/web/core/components/base-layouts/kanban/group.tsx`
 * (`BaseKanbanGroup`).
 */
export interface IBaseLayoutsKanbanGroupProps<T extends IBaseLayoutsKanbanItem> extends IBaseLayoutsBaseGroupProps<T> {
  groupClassName?: string;
}

// Kanban Card/Item Props

/**
 * Props contract for an individual kanban card subcomponent.
 *
 * Structural alias of `IBaseLayoutsBaseItemProps<T>`: kanban cards do not
 * currently introduce per-card configuration beyond the base item props
 * (`item`, `index`, `groupId`, `isLast`, drag/drop handlers, `renderItem`).
 *
 * Consumers: card rendering inside `apps/web/core/components/base-layouts/kanban/`.
 */
export type IBaseLayoutsKanbanItemProps<T extends IBaseLayoutsKanbanItem> = IBaseLayoutsBaseItemProps<T>;
