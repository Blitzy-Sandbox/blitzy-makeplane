/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the `context-menu` subsystem. Exposes the public API for right-click context menus
 * with nested submenu support, portal-rendered overlays, viewport-aware positioning, and
 * keyboard/mouse interaction orchestration.
 *
 * Exports (preserve order — star-re-exports surface every named symbol from each module):
 *   - `./item` → `ContextMenuItem` — row-level renderer for a single context-menu entry,
 *     including nested-submenu trigger behavior, popper positioning, hover-to-open, and
 *     keyboard navigation for submenus.
 *   - `./root` → `ContextMenu` (public), `ContextMenuContext`, `Portal`, `TContextMenuItem`
 *     (item type) — top-level menu controller, recursive item type, portal helper, and the
 *     React context that lets nested items register their `closeSubmenu` callbacks.
 *
 * Consumed via `packages/ui/src/dropdowns/index.ts` and ultimately `packages/ui/src/index.ts`,
 * so every symbol exported here is part of `@plane/ui`'s public API.
 */

export * from "./item";
export * from "./root";
