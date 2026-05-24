/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project filter contracts for the `@plane/types/project` subfolder.
 *
 * Defines filter expression and sort shapes consumed by
 * `apps/web/core/store/project/project_filter.store.ts` to narrow the workspace project
 * list — by access level, member, lead, favorite/archived status. Mirrors the issue
 * filter pattern from `../view-props.ts`.
 *
 * Filter state is persisted per `workspaceSlug` so each workspace remembers its own
 * project-list narrowing independently.
 */

/**
 * Sort axis for the workspace project list — prefix `-` indicates descending order
 * (Django ORM convention).
 *
 * Union values:
 * - `sort_order`: manual drag-reorder position (custom user ordering; default)
 * - `name`: alphabetical by project name (ascending)
 * - `-name`: alphabetical by project name (descending / Z→A)
 * - `created_at`: oldest first (chronological ascending)
 * - `-created_at`: newest first (chronological descending — recent activity at top)
 * - `members_length`: smallest team first
 * - `-members_length`: largest team first
 */
export type TProjectOrderByOptions =
  | "sort_order"
  | "name"
  | "-name"
  | "created_at"
  | "-created_at"
  | "members_length"
  | "-members_length";

/**
 * Display-layer filters and sort for the workspace project list.
 *
 * All fields are optional — undefined means "no display narrowing applied".
 *
 * Fields:
 * - `my_projects`: when true, narrows to projects the current user is a member of
 * - `archived_projects`: when true, includes archived projects (default behavior excludes them)
 * - `order_by`: sort axis (see `TProjectOrderByOptions`); when undefined, the store falls
 *   back to its default (typically `sort_order`)
 */
export type TProjectDisplayFilters = {
  my_projects?: boolean;
  archived_projects?: boolean;
  order_by?: TProjectOrderByOptions;
};

/**
 * Subset of `TProjectDisplayFilters` keys that are rendered as removable "active filter"
 * chips in the project list header.
 *
 * Union values:
 * - `my_projects`: chip toggling the "my projects" narrowing
 * - `archived_projects`: chip toggling inclusion of archived projects
 *
 * Excludes `order_by` because sort selection is rendered as a dropdown, not a chip.
 */
export type TProjectAppliedDisplayFilterKeys = "my_projects" | "archived_projects";

/**
 * Attribute filters narrowing the workspace project list.
 *
 * Each filter key holds an array of selected predicate values that are OR'd within the
 * key; multiple filter keys are AND'd together. `null` means the filter was explicitly
 * cleared by the user (vs. `undefined` which means it was never set).
 *
 * Fields:
 * - `access`: project visibility values to include (e.g. `["0", "2"]` for private/public;
 *   stringified `EProjectNetwork` numeric values)
 * - `lead`: user ids of project leads to include
 * - `members`: user ids that must be a member of the project (OR'd within array)
 * - `created_at`: ISO date strings or relative offsets (e.g. `"7"` for last 7 days);
 *   format mirrors the issue filter `created_at` convention
 */
export type TProjectFilters = {
  access?: string[] | null;
  lead?: string[] | null;
  members?: string[] | null;
  created_at?: string[] | null;
};

/**
 * Top-level persisted filter container — combines display filters and attribute filters.
 *
 * Persisted per `workspaceSlug` in the project filter store so each workspace remembers
 * its own narrowing independently across sessions.
 *
 * Fields:
 * - `display_filters`: display-layer toggles + sort (`TProjectDisplayFilters`)
 * - `filters`: attribute predicates (`TProjectFilters`)
 */
export type TProjectStoredFilters = {
  display_filters?: TProjectDisplayFilters;
  filters?: TProjectFilters;
};
