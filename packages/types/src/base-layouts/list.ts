/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * List-semantic structural aliases over the shared `./base` contracts — list layouts add no new prop fields; consumed by `apps/web/core/components/base-layouts/list/`.
 */

import type {
  IBaseLayoutsBaseItem,
  IBaseLayoutsBaseProps,
  IBaseLayoutsBaseGroupProps,
  IBaseLayoutsBaseItemProps,
} from "./base";

/**
 * Structural alias of `IBaseLayoutsBaseItem` for list rows; required field is `id: string` with arbitrary payload keys allowed via the index signature.
 */
export type IBaseLayoutsListItem = IBaseLayoutsBaseItem;

// Main List Layout Props

/**
 * Structural alias of `IBaseLayoutsBaseProps<T>` for the list layout; consumes the shared base props verbatim (items / groupedItemIds / groups / drag-drop / render / collapse / loading / className).
 */
export type IBaseLayoutsListProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseProps<T>;

// Group component props

/**
 * Structural alias of `IBaseLayoutsBaseGroupProps<T>` for the list group subcomponent; consumed by `apps/web/core/components/base-layouts/list/group.tsx`.
 */
export type IBaseLayoutsListGroupProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseGroupProps<T>;

// Item component props

/**
 * Structural alias of `IBaseLayoutsBaseItemProps<T>` for list-row subcomponents; covers `item`, `index`, `groupId`, `isLast`, drag/drop handlers, and `renderItem`.
 */
export type IBaseLayoutsListItemProps<T extends IBaseLayoutsListItem> = IBaseLayoutsBaseItemProps<T>;
