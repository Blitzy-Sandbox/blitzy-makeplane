/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project entity contracts mirroring `apps/api/plane/db/models/project.py`; consumed
 * by `apps/web/core/store/project/`, `apps/web/core/components/project/`, and
 * `apps/api/plane/app/permissions/project.py`. Also exports membership types,
 * navigation preferences, GitHub integration payloads, and issue-search shapes.
 */

import type { TLogoProps } from "../common";
import type { TUserPermissions } from "../enums";
import type { TStateGroups } from "../state";
import type { IUser, IUserLite } from "../users";
import type { IWorkspace } from "../workspace";

/**
 * Project-scoped role hierarchy on the platform-wide numeric scale; matches
 * `EUserPermissions` so a single permission check gates both workspace- and
 * project-originated roles.
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
 * Lightweight project projection for workspace listings and sidebar navigation;
 * `identifier` is the uppercase A–Z issue-prefix (e.g. "PLN" → "PLN-1234"),
 * `network` uses `EProjectNetwork` numeric values (PRIVATE=0, PUBLIC=2),
 * `sort_order` is a manual-reorder float (nullable until assigned), `member_role`
 * is `null` for non-members viewing a public project, and `cycle_view`/
 * `issue_views_view`/`module_view`/`page_view`/`inbox_view` are sidebar toggles.
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
 * Full project entity extending `IPartialProject` with description, cover image,
 * default state/assignee, estimate config, deploy anchor, members, timezone, and
 * the issue auto-sequence counter. Non-obvious semantics: `archive_in`/`close_in`
 * are months thresholds for `issue_automation_task` (0 disables); `cover_image_asset`
 * is write-only during presigned upload; `anchor` is the public-deploy slug consumed
 * by `apps/space` (null when not published); `next_work_item_sequence` is a
 * server-managed counter driving issue labels.
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
 * Query parameters for the project analytics count endpoint; both fields are
 * comma-separated lists (`project_ids` scopes the rollup, `fields` selects a subset).
 */
export type TProjectAnalyticsCountParams = {
  project_ids?: string;
  fields?: string;
};

/**
 * Aggregate count row for a single project's analytics; all count fields are
 * optional because the `fields` query param controls which subset is included.
 */
export type TProjectAnalyticsCount = Pick<IProject, "id"> & {
  total_issues?: number;
  completed_issues?: number;
  total_cycles?: number;
  total_members?: number;
  total_modules?: number;
};

/**
 * Minimal project projection (identity + logo) for embedding in notifications,
 * search results, and activity rows where the full record would be too heavy.
 */
export interface IProjectLite {
  id: string;
  name: string;
  identifier: string;
  logo_props: TLogoProps;
}

/**
 * Normalized cache of `IProject` records keyed by project id, used as the primary
 * storage shape in `apps/web/core/store/project/project.store.ts`.
 */
export interface IProjectMap {
  [id: string]: IProject;
}

/**
 * Minimal project-member projection using Django ORM double-underscore prefixed
 * names (`member__*`) because the fields come from a JOIN with `User`; `id` is
 * the `ProjectMember` row id, `member_id` is the user id.
 */
export interface IProjectMemberLite {
  id: string;
  member__avatar_url: string;
  member__display_name: string;
  member_id: string;
}

/**
 * Project membership record discriminated by persistence state: the persisted
 * variant carries `id`/`original_role`/`created_at`, the unpersisted variant has
 * all three as `null` and is used as a placeholder in the bulk-invite form.
 * `original_role` is compared against `role` to detect modifications.
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
 * Form payload for bulk-adding members; each entry pairs a `member_id` with its
 * own role so different roles can be assigned in the same submission.
 */
export interface IProjectBulkAddFormData {
  members: { role: TUserPermissions | EUserProjectRoles; member_id: string }[];
}

/**
 * Per-user, per-project sidebar navigation preferences controlling the default
 * tab and which sidebar items are hidden under the "More" collapsible.
 */
export type IProjectMemberNavigationPreferences = {
  default_tab: string;
  hide_in_more_menu: string[];
};

/**
 * Request body for updating the current user's project preferences; structured
 * as an object so additional preference groups can be added later.
 */
export type IProjectMemberPreferencesUpdate = {
  navigation: IProjectMemberNavigationPreferences;
};

/**
 * Response envelope from the project preferences GET endpoint matching the
 * backend serializer's convention.
 */
export type IProjectMemberPreferencesResponse = {
  preferences: {
    navigation: IProjectMemberNavigationPreferences;
  };
};

/**
 * Admin-scoped preferences response variant including parent ids so the caller
 * knows which member's preferences are being returned.
 */
export type IProjectMemberPreferencesFullResponse = IProjectMemberPreferencesResponse & {
  project_id: string;
  member_id: string;
  workspace_id: string;
};

/**
 * GitHub repository descriptor returned by the GitHub integration's repo-listing
 * endpoint; subset of the GitHub REST API repo object kept only for picker UI
 * and linking in the GitHub importer flow.
 */
export interface IGithubRepository {
  id: string;
  full_name: string;
  html_url: string;
  url: string;
}

/**
 * Paginated response wrapper for the GitHub repositories listing; `total_count`
 * mirrors the GitHub API's field across all pages.
 */
export interface GithubRepositoriesResponse {
  repositories: IGithubRepository[];
  total_count: number;
}

/**
 * Project-scoped issue search query params used by parent/relation/cycle/module
 * pickers and the mention dropdown; the boolean predicates each restrict to
 * issues eligible for a given linking action (e.g. `parent` excludes the current
 * issue and its descendants to prevent cycles).
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
 * Search result row from the project-scoped issue search endpoint; uses Django
 * ORM double-underscore prefixed names (`project__*`/`state__*`/`workspace__*`)
 * because the fields come from JOINs. `sequence_id` + `project__identifier`
 * combine to render the canonical label (e.g. "PLN-1234").
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
 * Type alias for `IPartialProject` provided so consumers preferring the `T*`
 * naming convention can use either spelling interchangeably.
 */
export type TPartialProject = IPartialProject;

/**
 * Type alias combining `TPartialProject` and `IProject` — structurally identical
 * to `IProject` (which already extends `IPartialProject`).
 */
export type TProject = TPartialProject & IProject;
