/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the `@plane/ui` dropdowns family — accessible select, search-select, menu, combo-box,
 * and context-menu primitives that share Headless UI / react-popper plumbing and a common
 * `helper.tsx` type contract.
 *
 * Public exports (preserve order; consumed widely across `apps/web` and other `packages/ui` modules):
 *   - `./context-menu`     → `ContextMenu`, `ContextMenuItem`, `Portal`, `ContextMenuContext`,
 *                             `TContextMenuItem` — right-click context menu with nested submenus.
 *   - `./custom-menu`      → `CustomMenu` (+ `MenuItem`, `SubMenu`, `SubMenuTrigger`,
 *                             `SubMenuContent`, `Portal` static members) — Headless UI Menu-based
 *                             action menu (NOT a value selector).
 *   - `./custom-select`    → `CustomSelect` + nested `Option` — single-value select built on
 *                             Headless UI Combobox.
 *   - `./custom-search-select` → `CustomSearchSelect` — same Combobox base with a search input
 *                                 and single/multi-select branches.
 *   - `./combo-box`        → `ComboDropDown` + `ComboOptions`, `ComboOption`, `ComboInput`
 *                             aliases — hover-mounted combobox wrapper used to defer Headless UI
 *                             initialization until the user interacts with the trigger.
 *
 * Consumers: `packages/ui/src/link/block.tsx`, `apps/web/core/components/issues/**`,
 * `apps/web/core/components/cycles/**`, and other shared UI surfaces.
 */

export * from "./context-menu";
export * from "./custom-menu";
export * from "./custom-select";
export * from "./custom-search-select";
export * from "./combo-box";
