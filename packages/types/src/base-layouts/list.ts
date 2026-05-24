/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * List layout-specific type aliases for the `@plane/types/base-layouts` family.
 *
 * Renames the shared base layout contracts into list-semantic names so list
 * consumers express their generics with intent-specific identifiers. All types
 * here are structural aliases of the shared contracts in `./base` — list
 * layouts do not introduce any new prop fields beyond the shared base.
 *
 * Consumers: `apps/web/core/components/base-layouts/list/` (`layout.tsx`,
 * `group.tsx`, `group-header.tsx`).
 */

import type {
  IBaseLayoutsBaseItem,
  IBaseLayoutsBaseProps,
  IBaseLayoutsBaseGroupProps,
  IBaseLayoutsBaseItemProps,
} from "./base";

/**
 * Minimal contract for an item rendered inside the list layout.
 *
 * Structural alias of `IBaseLayoutsBaseItem`: the only required field is
 * `id: string`; arbitrary payload keys are allowed via the index signature.
 *
 * Consumers: `apps/web/core/components/base-layouts/list/` files that
 * constrain their `T extends IBaseLayoutsListItem` generic.
 */
export type IBaseLayoutsListItem = IBaseLayoutsBaseItem;

// Main List Layout Props

/**
 * Top-level props contract for the list layout component.
 *
 * Structural alias of `IBaseLayoutsBaseProps<T>`: list inherits every shared
 * base prop — `items`, `groupedItemIds`, `groups`, drag/drop handlers,
 * render props, `collapsedGroups`, loading/pagination, `className` — without
 * adding new fields.
 *
 * Consumers: `apps/web/core/components/base-layouts/list/layout.tsx`
 * (`BaseListLayout`).
 */
export type IBaseLayoutsListProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseProps<T>;

// Group component props

/**
 * Props contract for the list layout's per-group rendering subcomponent.
 *
 * Structural alias of `IBaseLayoutsBaseGroupProps<T>`; group rendering in the
 * list does not require additional configuration beyond the base group props.
 *
 * Consumers: `apps/web/core/components/base-layouts/list/group.tsx`
 * (`BaseListGroup`).
 */
export type IBaseLayoutsListGroupProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseGroupProps<T>;

// Item component props

/**
 * Props contract for an individual list-row subcomponent.
 *
 * Structural alias of `IBaseLayoutsBaseItemProps<T>`; covers `item`, `index`,
 * `groupId`, `isLast`, drag-drop handlers, and `renderItem`.
 *
 * Consumers: list-row rendering inside `apps/web/core/components/base-layouts/list/`.
 */
export type IBaseLayoutsListItemProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseItemProps<T>;
