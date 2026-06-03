/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the gantt issue layout module.
 *
 * Rendered purpose: surfaces the gantt issue layout's composition root and exported type via a folder-level
 * import path (`@/components/issues/issue-layouts/gantt`). Consumers import `BaseGanttRoot` (the MobX
 * `observer`-wrapped composition component) and `GanttStoreType` (the union of issues-store types that the
 * gantt layout supports) without coupling to the underlying file names.
 *
 * Re-exports (star re-export from `./base-gantt-root`):
 *   - `BaseGanttRoot` (component): top-level gantt layout composition; see `./base-gantt-root.tsx`
 *   - `GanttStoreType` (type alias): union of `EIssuesStoreType.PROJECT | MODULE | CYCLE | PROJECT_VIEW | EPIC`
 *
 * MobX stores read: none — this file contains no runtime logic; the re-exported `BaseGanttRoot` is the
 * MobX consumer.
 *
 * Side effects: none — pure re-export.
 *
 * Consumers (via the folder-level import path `../gantt`):
 *   - `apps/web/core/components/issues/issue-layouts/roots/project-layout-root.tsx`
 *   - `apps/web/core/components/issues/issue-layouts/roots/cycle-layout-root.tsx`
 *   - `apps/web/core/components/issues/issue-layouts/roots/module-layout-root.tsx`
 *   - `apps/web/core/components/issues/issue-layouts/roots/project-view-layout-root.tsx`
 *   - Any plane-web epic layout root that opts into the gantt layout
 */
export * from "./base-gantt-root";
