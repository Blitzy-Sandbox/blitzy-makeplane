/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the issue-layout header filter controls package.
 *
 * Re-exports five surfaces consumed by issue layout headers to configure issue presentation:
 *   - `./display-filters`: the Display Filters dropdown — controls `group_by`, `sub_group_by`,
 *     `order_by`, the per-card display-properties map (assignee avatar, due date, labels, etc.),
 *     and extra options (show empty groups, show sub-issues). Persists via
 *     `EIssueFilterType.DISPLAY_FILTERS` and `EIssueFilterType.DISPLAY_PROPERTIES`.
 *   - `./filters`: the entity-specific filter dropdowns (assignee, created-by, cycle, due-date,
 *     labels, mentions, module, priority, project, start-date, state, state-group). Each child
 *     panel renders a searchable, paginated, selectable list and reports row clicks via the shared
 *     `handleUpdate` callback. The parent persists via `EIssueFilterType.FILTERS`.
 *   - `./helpers`: shared filter-UI primitives — `FiltersDropdown` (Headless UI Popover wrapper),
 *     `FilterHeader` (collapsible section header), `FilterOption` (single selectable row).
 *   - `./layout-selection`: desktop layout switcher (inline icon-button row).
 *   - `./mobile-layout-selection`: mobile layout switcher (`CustomMenu` dropdown variant).
 *
 * All persistence is delegated to the parent route root, which calls
 * `issuesFilter.updateFilters(workspaceSlug, projectId, <EIssueFilterType slot>, <partial>)` on the
 * MobX issues store. No file in this package calls `updateFilters` directly and no file performs
 * router navigation.
 *
 * No runtime logic lives here; this file is a pure ESM forwarder used solely for module-boundary
 * stability so consumers can import header filter primitives from a single stable path
 * (`@/components/issues/issue-layouts/filters/header`) rather than coupling to internal file
 * locations.
 */

export * from "./display-filters";
export * from "./filters";
export * from "./helpers";
export * from "./layout-selection";
export * from "./mobile-layout-selection";
