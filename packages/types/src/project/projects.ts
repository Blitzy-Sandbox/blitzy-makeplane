/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project entity contracts for the `@plane/types/project` subfolder.
 *
 * Models the canonical project record — visibility (`EProjectNetwork`: PRIVATE/PUBLIC),
 * members, lead, identifier (e.g. "PLN" used for issue sequence labels), cover image,
 * logo props, default state, emoji/icon, and access controls. Mirrors
 * `apps/api/plane/db/models/project.py`. Consumed broadly across
 * `apps/web/core/store/project/`, `apps/web/core/components/project/`, and
 * `apps/api/plane/app/permissions/project.py`.
 *
 * Also exports membership types (`TProjectMembership`), navigation preferences,
 * GitHub repository integration payloads (used by the importer), project-scoped issue
 * search params, and the issue search response row.
 */

import type { TLogoProps } from "../common";
import type { TUserPermissions } from "../enums";
import type { TStateGroups } from "../state";
import type { IUser, IUserLite } from "../users";
import type { IWorkspace } from "../workspace";

/**
 * Project-scoped role hierarchy (numeric values support `>=` / `<=` permission comparisons).
 *
 * Values match the platform-wide `EUserPermissions` numeric scale, allowing a single
 * `permission_classes` check to gate operations regardless of whether the role originated
 * from a workspace-level or project-level grant.
 */
export enum EUserProjectRoles {
  /** Full project administration — workspace owner or project admin. */
  ADMIN = 20,
  /** Standard read/write access — most project contributors. */
  MEMBER = 15,
  /** Read-only access with limited write grants (e.g. comment, vote). */
  GUEST = 5,
}

/**
 * Lightweight project projection used in workspace listings and sidebar navigation.
 *
 * Includes the fields necessary to render a project chip/row (name, identifier, logo,
 * sort_order, role) plus feature-toggle flags. Excludes heavy fields like description,
 * members array, and estimate which only appear on the full `IProject` shape.
 *
 * Fields with non-obvious semantics:
 * - `identifier`: short URL slug AND issue sequence prefix (e.g. "PLN" produces "PLN-1234"
 *   issue labels) — MUST be uppercase A–Z, validated server-side
 * - `network`: visibility discriminant; use values from `EProjectNetwork` enum in
 *   `../enums.ts` (PRIVATE=0, PUBLIC=2 — numeric 1 reserved)
 * - `sort_order`: float used for manual drag-reorder in the sidebar; nullable for
 *   freshly-created records before ordering is assigned
 * - `logo_props`: emoji/icon descriptor (see `TLogoProps`) — discriminated by `in_use`
 * - `member_role`: current viewer's role in this project (intersection of `TUserPermissions`
 *   and `EUserProjectRoles` for backward compatibility); `null` when the viewer is not
 *   a member (and the project is visible only because it's public)
 * - `archived_at`: ISO timestamp; null for active projects (archived projects are hidden
 *   from default listings)
 * - `cycle_view` / `issue_views_view` / `module_view` / `page_view` / `inbox_view`:
 *   feature-toggle flags controlling sidebar item visibility per project
 * - `guest_view_all_features`: when true, GUEST role members see all feature tabs
 *   regardless of their individual access grants
 * - `project_lead`: optional pointer to the project's accountable lead (either a
 *   hydrated `IUserLite` or just the user id); null when no lead is assigned
 * - `intake_count`: pre-aggregated count of pending intake issues (drives the sidebar badge)
 */
export interface IPartialProject {
  id: string;
  name: string;
  identifier: string;
  sort_order: number | null;
  logo_props: TLogoProps;
  member_role?: TUserPermissions | EUserProjectRoles | null;
  archived_at: string | null;
  workspace: IWorkspace | string;
  cycle_view: boolean;
  issue_views_view: boolean;
  module_view: boolean;
  page_view: boolean;
  inbox_view: boolean;
  guest_view_all_features?: boolean;
  project_lead?: IUserLite | string | null;
  network?: number;
  // Timestamps
  created_at?: Date;
  updated_at?: Date;
  // actor
  created_by?: string;
  updated_by?: string;
  intake_count?: number;
}

/**
 * Full project entity record extending `IPartialProject`.
 *
 * Adds heavy fields not needed in the sidebar listing — description, cover image, default
 * state/assignee, estimate config, public deploy anchor, members array, timezone, and
 * the issue auto-sequence counter.
 *
 * Fields with non-obvious semantics:
 * - `archive_in` / `close_in`: number of months after which completed issues are
 *   auto-archived/closed by the `issue_automation_task` Celery beat job; 0 disables
 * - `cover_image_asset`: write-only field used during the presigned-upload flow (always
 *   `null` on read — the actual asset id is server-managed)
 * - `cover_image`: legacy field — direct URL string; superseded by `cover_image_url`
 * - `cover_image_url`: read-only signed URL for displaying the cover image
 * - `default_assignee`: user auto-assigned when a new issue is created with no explicit
 *   assignee (user id string or hydrated `IUser`); null means no auto-assignment
 * - `default_state`: default workflow state id assigned to new issues; null falls back to
 *   the project's first state by sort order
 * - `description`: free-form text description shown in the project header
 * - `estimate`: id of the active project estimate system (null when estimates disabled)
 * - `anchor`: stable URL slug for public deploy board exposure via `apps/space`
 *   (null when not published)
 * - `is_favorite`: current viewer's per-user favorite flag
 * - `members`: array of user ids who are project members (computed server-side from
 *   `ProjectMember` join — does NOT include roles; use `TProjectMembership` for roles)
 * - `timezone`: IANA timezone identifier (e.g. "America/New_York"); affects scheduled
 *   automation and notification timing
 * - `next_work_item_sequence`: next sequence number to assign on issue create
 *   (drives "PLN-1234" style labels); server-managed counter
 */
export interface IProject extends IPartialProject {
  archive_in?: number;
  close_in?: number;
  // only for uploading the cover image
  cover_image_asset?: null;
  cover_image?: string;
  // only for rendering the cover image
  readonly cover_image_url?: string;
  default_assignee?: IUser | string | null;
  default_state?: string | null;
  description?: string;
  estimate?: string | null;
  anchor?: string | null;
  is_favorite?: boolean;
  members?: string[];
  timezone?: string;
  next_work_item_sequence?: number;
}

/**
 * Query parameters for the project analytics count endpoint.
 *
 * Fields (both optional):
 * - `project_ids`: comma-separated project ids to compute counts for; omit for workspace-wide
 * - `fields`: comma-separated field names to include in the response (subset selection
 *   to reduce payload size)
 */
export type TProjectAnalyticsCountParams = {
  project_ids?: string;
  fields?: string;
};

/**
 * Aggregate count row for a single project's analytics.
 *
 * `id` (inherited from `IProject` via `Pick`) identifies the project. All count fields
 * are optional because the `fields` query param controls which subset is included.
 *
 * Fields:
 * - `total_issues`: total issues across all states
 * - `completed_issues`: issues in the "completed" state group (subset of total)
 * - `total_cycles`: count of cycles in the project
 * - `total_members`: count of project members
 * - `total_modules`: count of modules in the project
 */
export type TProjectAnalyticsCount = Pick<IProject, "id"> & {
  total_issues?: number;
  completed_issues?: number;
  total_cycles?: number;
  total_members?: number;
  total_modules?: number;
};

/**
 * Minimal project projection for embedding in cross-entity responses.
 *
 * Carries only the identity triple (id, name, identifier) + the logo for rendering a
 * project chip. Used inside notifications, search results, activity rows, etc. where
 * the full `IPartialProject`/`IProject` shape would be too heavy.
 */
export interface IProjectLite {
  id: string;
  name: string;
  identifier: string;
  logo_props: TLogoProps;
}

/**
 * Normalized cache of `IProject` records keyed by project id.
 *
 * Used by `apps/web/core/store/project/project.store.ts` as its primary storage shape
 * — every project the workspace exposes is stored as `projectMap[projectId]`.
 */
export interface IProjectMap {
  [id: string]: IProject;
}

/**
 * Minimal project-member projection for cross-entity references.
 *
 * Uses Django ORM double-underscore prefixed names (`member__*`) because the fields come
 * from a JOIN with the `User` model on the backend. Used in places where only the
 * member's display info is needed (e.g. assignee chips).
 *
 * Fields:
 * - `id`: the `ProjectMember` row id (not the user id)
 * - `member__avatar_url`: signed URL to the user's avatar
 * - `member__display_name`: rendered display name
 * - `member_id`: the user id (use this for lookups in the user store)
 */
export interface IProjectMemberLite {
  id: string;
  member__avatar_url: string;
  member__display_name: string;
  member_id: string;
}

/**
 * Project membership record linking a user to a project with a role.
 *
 * Discriminated by whether the membership has been persisted yet:
 * - Persisted variant: `id` is a string, `original_role` reflects the role at insert
 *   time (used to detect role changes), `created_at` is the membership creation timestamp
 * - Unpersisted variant: all three fields are `null` — used as a placeholder in the
 *   bulk-invite form before the server has created the rows
 *
 * Fields:
 * - `member`: user id of the project member
 * - `role`: current role (mix of `TUserPermissions` and `EUserProjectRoles` for backward
 *   compatibility — same numeric scale)
 * - `original_role`: role at membership creation (only on persisted variant); compared
 *   against `role` to detect modifications
 */
export type TProjectMembership = {
  member: string;
  role: TUserPermissions | EUserProjectRoles;
} & (
  | {
      id: string;
      original_role: EUserProjectRoles;
      created_at: string;
    }
  | {
      id: null;
      original_role: null;
      created_at: null;
    }
);

/**
 * Form payload for bulk-adding members to a project.
 *
 * Fields:
 * - `members`: array of `{ member_id, role }` pairs — each member can be assigned a
 *   different role in the same submission
 */
export interface IProjectBulkAddFormData {
  members: { role: TUserPermissions | EUserProjectRoles; member_id: string }[];
}

/**
 * Per-user, per-project sidebar navigation preferences.
 *
 * Fields:
 * - `default_tab`: which feature tab opens by default when the user enters the project
 *   (e.g. "issues", "cycles", "modules")
 * - `hide_in_more_menu`: ids of sidebar items the user has hidden under the "More"
 *   collapsible — controls personal sidebar layout
 */
export type IProjectMemberNavigationPreferences = {
  default_tab: string;
  hide_in_more_menu: string[];
};

/**
 * Request body for updating the current user's project preferences.
 *
 * Currently only carries navigation preferences; structured as an object so additional
 * preference groups can be added later without breaking the API shape.
 */
export type IProjectMemberPreferencesUpdate = {
  navigation: IProjectMemberNavigationPreferences;
};

/**
 * Response from the project preferences GET endpoint.
 *
 * Wraps the preferences under a `preferences` key to match the backend serializer's
 * envelope convention.
 */
export type IProjectMemberPreferencesResponse = {
  preferences: {
    navigation: IProjectMemberNavigationPreferences;
  };
};

/**
 * Full response variant including the parent identifiers (project, member, workspace ids).
 *
 * Returned by admin-scoped preference endpoints where the caller needs to know which
 * member's preferences are being returned (vs. the self-scoped endpoint that implies
 * the current user).
 */
export type IProjectMemberPreferencesFullResponse = IProjectMemberPreferencesResponse & {
  project_id: string;
  member_id: string;
  workspace_id: string;
};

/**
 * GitHub repository descriptor returned by the GitHub integration's repo-listing endpoint.
 *
 * Subset of the GitHub REST API repository object — Plane only stores the fields needed
 * for picker UI and linking. Consumed by the GitHub importer flow in `apps/web`.
 *
 * Fields:
 * - `id`: GitHub repository id (stable across renames)
 * - `full_name`: "owner/repo" string (e.g. "makeplane/plane")
 * - `html_url`: web URL for browser navigation
 * - `url`: GitHub API URL for programmatic access
 */
export interface IGithubRepository {
  id: string;
  full_name: string;
  html_url: string;
  url: string;
}

/**
 * Paginated response wrapper for the GitHub repositories listing endpoint.
 *
 * `repositories` is a single page; `total_count` is the total across all pages
 * (mirrors the GitHub API's `total_count` field).
 */
export interface GithubRepositoriesResponse {
  repositories: IGithubRepository[];
  total_count: number;
}

/**
 * Query parameters for the project-scoped issue search endpoint (used by parent/relation/
 * cycle/module pickers and the issue mention dropdown).
 *
 * Fields:
 * - `search`: free-text query (matches name, identifier, sequence_id)
 * - `parent`: when true, restrict results to issues that can be set as a parent (excludes
 *   the current issue and its descendants to prevent cycles)
 * - `issue_relation`: when true, restrict to issues eligible as a relation target
 *   (excludes the current issue and already-related issues)
 * - `cycle`: when true, restrict to issues not already in any cycle (for cycle add picker)
 * - `module`: module id; when set, restricts to issues not already in this module
 * - `sub_issue`: when true, restrict to issues eligible as a sub-issue (excludes parents
 *   to prevent cycles)
 * - `issue_id`: current issue id (excluded from results)
 * - `workspace_search`: true to search across all workspace projects; false narrows to
 *   the current project
 * - `target_date`: filter by issue target_date (ISO string or relative offset)
 * - `epic`: when true, restrict to issues that are epics (top-level work-item containers)
 */
export type TProjectIssuesSearchParams = {
  search: string;
  parent?: boolean;
  issue_relation?: boolean;
  cycle?: boolean;
  module?: string;
  sub_issue?: boolean;
  issue_id?: string;
  workspace_search: boolean;
  target_date?: string;
  epic?: boolean;
};

/**
 * Single search result row from the project-scoped issue search endpoint.
 *
 * Uses Django ORM double-underscore prefixed names (`project__*`, `state__*`,
 * `workspace__*`) because the fields come from JOINs on the backend; the format avoids
 * an extra hydration step on the frontend.
 *
 * Consumed by the issue picker modals in:
 * - `apps/web/core/components/issues/issue-detail-widgets/issue-detail-widget-modals.tsx`
 * - `apps/web/core/components/issues/issue-modal/context/issue-modal-context.tsx`
 *
 * Fields with non-obvious semantics:
 * - `sequence_id` + `project__identifier`: combine to render the canonical issue label
 *   (e.g. "PLN-1234")
 * - `state__group`: lifecycle group (`TStateGroups`) for grouping/icon selection in the picker
 * - `state__color`: hex string for the state pill background
 * - `type_id`: issue-type id (epic / regular / custom type); empty string when no type
 */
export interface ISearchIssueResponse {
  id: string;
  name: string;
  project_id: string;
  project__identifier: string;
  project__name: string;
  sequence_id: number;
  start_date: string | null;
  state__color: string;
  state__group: TStateGroups;
  state__name: string;
  workspace__slug: string;
  type_id: string;
}

/**
 * Type alias for `IPartialProject`.
 *
 * Provides a `T*` naming convention for consumers that prefer type aliases over
 * interfaces (both are structurally equivalent and interchangeable).
 */
export type TPartialProject = IPartialProject;

/**
 * Type alias combining `TPartialProject` and `IProject` — equivalent to `IProject` itself
 * (since `IProject extends IPartialProject`).
 *
 * Provides a `T*` named export for consumers that prefer the alias spelling; structurally
 * identical to `IProject`.
 */
export type TProject = TPartialProject & IProject;
