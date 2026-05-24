/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/base-layouts` subfolder.
 *
 * Aggregates the four layout-typing sub-modules into a single stable import
 * path so downstream consumers depend on `@plane/types` (via this folder)
 * rather than reaching into individual file paths.
 *
 * Re-exports:
 * - `./base`   — Shared layout primitives: items, groups, drag-drop handlers,
 *                render contracts, layout configuration.
 * - `./list`   — List layout-specific prop aliases over the shared base contracts.
 * - `./kanban` — Kanban layout-specific prop extensions (adds `groupClassName`).
 * - `./gantt`  — Gantt-specific items, capabilities, display options, and the
 *                core/extended timeline registries.
 *
 * Consumers: `apps/web/core/components/base-layouts/` and its `list/`,
 * `kanban/`, and `gantt/` subdirectories.
 */

export * from "./base";
export * from "./list";
export * from "./kanban";
export * from "./gantt";
