/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project filter contracts consumed by `apps/web/core/store/project/project_filter.store.ts`;
 * state is persisted per `workspaceSlug` so each workspace remembers its own narrowing.
 */

/**
 * Sort axis for the project list following the Django ORM `-` descending convention;
 * `sort_order` is the manual drag-reorder position used as the default.
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
 * Display-layer filters and sort; `my_projects` narrows to projects the viewer is
 * a member of and `archived_projects` includes archived projects (excluded by default).
 */
export type TProjectDisplayFilters = {
  my_projects?: boolean;
  archived_projects?: boolean;
  order_by?: TProjectOrderByOptions;
};

/**
 * Subset of display-filter keys rendered as removable chips in the project list
 * header; `order_by` is excluded because sort is a dropdown, not a chip.
 */
export type TProjectAppliedDisplayFilterKeys = "my_projects" | "archived_projects";

/**
 * Attribute predicates narrowing the project list; values OR within a key and
 * AND across keys, `null` means explicitly cleared, `undefined` means never set.
 * `access` carries stringified `EProjectNetwork` numeric values.
 */
export type TProjectFilters = {
  access?: string[] | null;
  lead?: string[] | null;
  members?: string[] | null;
  created_at?: string[] | null;
};

/**
 * Top-level persisted filter container combining display filters and attribute
 * filters, persisted per `workspaceSlug` across sessions.
 */
export type TProjectStoredFilters = {
  display_filters?: TProjectDisplayFilters;
  filters?: TProjectFilters;
};
