/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the quick-action dropdown package.
 *
 * Single stable import path for the entire issue / work-item quick-action menu surface, used
 * across the workspace (global), project, module, cycle, archived, and detail / peek layouts.
 * Consumer files (e.g. `issues/issue-layouts/list/`, `kanban/`, `spreadsheet/`, `calendar/`,
 * `gantt/`) import from `quick-action-dropdowns` rather than reaching into individual files.
 *
 * Re-exports:
 *   - `./all-issue` — `AllIssueQuickActions` (global / workspace-wide layout).
 *   - `./archived-issue` — `ArchivedIssueQuickActions`.
 *   - `./cycle-issue` — `CycleIssueQuickActions`.
 *   - `./module-issue` — `ModuleIssueQuickActions`.
 *   - `./project-issue` — `ProjectIssueQuickActions`.
 *   - `./helper` — menu-item factory hooks (`useMenuItemFactory`, `useIssueActionHandlers`,
 *     `useProjectIssueMenuItems`, `useWorkItemDetailMenuItems`, `useAllIssueMenuItems`,
 *     `useCycleIssueMenuItems`, `useModuleIssueMenuItems`, `useArchivedIssueMenuItems`),
 *     `MenuItemFactoryProps`, and the `handleOptionalAction` utility.
 *   - `../../workspace-draft/quick-action` — `WorkspaceDraftIssueQuickActions`, re-exported here
 *     for co-location with the other quick-action dropdown surfaces.
 *   - `./issue-detail` — `WorkItemDetailQuickActions` plus its `TWorkItemDetailQuickActionProps`
 *     prop contract.
 *
 * Architecture:
 *   - Pure aggregator: no runtime logic, only `export *` re-exports.
 *   - All re-exported quick-action components are MobX `observer`-wrapped; their behavior is
 *     driven by stores in `apps/web/core/store/issue/**` per the frontend state policy.
 */
export * from "./all-issue";
export * from "./archived-issue";
export * from "./cycle-issue";
export * from "./module-issue";
export * from "./project-issue";
export * from "./helper";
export * from "../../workspace-draft/quick-action";
export * from "./issue-detail";
