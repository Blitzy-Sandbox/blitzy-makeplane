/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace-scoped saved-view contracts for the `@plane/types` package.
 *
 * Models the `IWorkspaceView` entity — saved cross-project issue filters that aggregate
 * work items across every project in the workspace. Compare with `./views.ts` for the
 * project-scoped equivalent (`IProjectView`). Also defines the static-view (built-in /
 * non-saved) identifiers consumed by the workspace All Issues page.
 *
 * Consumers: `apps/web/core/store/global-view.store.ts`, the workspace-views service,
 * and the workspace-level issue list components.
 */

import type {
  IWorkspaceViewProps,
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  TWorkItemFilterExpression,
} from "./view-props";
import type { EViewAccess } from "./views";

/**
 * Workspace-scoped saved view entity — a named, persisted issue filter set that aggregates
 * work items across every project in the workspace.
 *
 * Fields with non-obvious semantics:
 * - `access`: `EViewAccess` (PRIVATE / PUBLIC) — controls visibility to other workspace
 *   members. PRIVATE views are visible only to the owner (and workspace admins).
 * - `rich_filters`: new-style filter expression tree (see `TWorkItemFilterExpression`);
 *   the advanced AST-based representation preferred for net-new reads/writes.
 * - `display_filters`: display-layer settings (group_by, order_by, layout, calendar mode).
 * - `display_properties`: per-column visibility toggles for list/spreadsheet layouts.
 * - `query`: legacy unstructured filter blob (typed `any`) preserved for backwards
 *   compatibility with views created before the rich-filters migration.
 * - `query_data`: hydrated query payload of shape `IWorkspaceViewProps` returned by
 *   detail endpoints; bundles `rich_filters` + `display_filters` + `display_properties`.
 * - `is_favorite`: per-user favorite flag (not a column on the view row — joined from
 *   the favorites table at read time).
 * - `is_locked`: when true, only the owner can edit the view definition (server-enforced).
 * - `owned_by`: user id of the view's owner; the only account permitted to edit when
 *   `is_locked` is true.
 * - `workspace_detail`: optional hydrated workspace summary present on detail endpoints
 *   (omitted from list responses to keep payloads small).
 */
export interface IWorkspaceView {
  id: string;
  access: EViewAccess;
  created_at: Date;
  updated_at: Date;
  is_favorite: boolean;
  created_by: string;
  updated_by: string;
  name: string;
  description: string;
  rich_filters: TWorkItemFilterExpression;
  display_filters: IIssueDisplayFilterOptions;
  display_properties: IIssueDisplayProperties;
  query: any;
  query_data: IWorkspaceViewProps;
  project: string;
  workspace: string;
  is_locked: boolean;
  owned_by: string;
  workspace_detail?: {
    id: string;
    name: string;
    slug: string;
  };
}

/**
 * Built-in (non-saved) workspace view identifiers — the static views available in every
 * workspace without explicit creation.
 *
 * Values:
 * - `all-issues`: every work item in the workspace the current user can access
 * - `assigned`: work items assigned to the current user
 * - `created`: work items created by the current user
 * - `subscribed`: work items the current user is subscribed to
 *
 * Used as route segment values on the workspace `/workspace-views/<id>/` page and as
 * keys in the global-view store's static-view map.
 */
export const STATIC_VIEW_TYPES = ["all-issues", "assigned", "created", "subscribed"];

/**
 * String-literal type derived from `STATIC_VIEW_TYPES` — one of the four built-in
 * workspace views (`"all-issues" | "assigned" | "created" | "subscribed"`).
 */
export type TStaticViewTypes = (typeof STATIC_VIEW_TYPES)[number];
