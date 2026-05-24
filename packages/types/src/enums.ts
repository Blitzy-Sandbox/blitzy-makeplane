/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Global vocabulary enums for the `@plane/types` package.
 *
 * Centralizes the cross-cutting enums consumed by both backend serializers
 * (mirrored at `apps/api/plane/db/models/`) and frontend stores/components.
 *
 * Each enum value carries semantic meaning that drives:
 * - Permission gates (`EUserPermissions`)
 * - Visibility controls (`EProjectNetwork`, `EPageAccess`, `EIssueCommentAccessSpecifier`)
 * - Filter / wizard discriminators (`EDurationFilters`, `EEstimateSystem`,
 *   `EEstimateUpdateStages`, `ENotificationFilterType`)
 * - File-asset entity routing (`EFileAssetType` — used by
 *   `apps/api/plane/app/views/asset/v2.py` to resolve the parent entity context)
 * - Progress-tracking dimensions (`EUpdateStatus`)
 *
 * Runtime footprint: numeric enums emit a runtime object; string enums emit a runtime
 * object whose keys/values match the source literals. Numeric values are stable wire
 * identifiers and MUST NOT change without a coordinated backend migration.
 */

/**
 * Platform-wide role hierarchy applied at both workspace and project levels.
 *
 * Numeric values support `>=` / `<=` comparison for permission gates — higher numbers
 * grant more privileges. Mirrors role constants in `apps/api/plane/app/permissions/`
 * and is re-declared as `EUserPermissions` in `packages/constants/src/user.ts` for
 * consumers that import from `@plane/constants`.
 *
 * Distinct from `EUserWorkspaceRoles` (in `./workspace.ts`) which is workspace-scoped
 * only; the two enums share the same numeric values (5 / 15 / 20) but model different
 * scopes — a user's workspace role and project role may diverge.
 */
export enum EUserPermissions {
  /** Full administrative access — workspace owner / project admin. */
  ADMIN = 20,
  /** Standard read/write access — typical workspace / project member. */
  MEMBER = 15,
  /** Read-only access with limited project-level write grants. */
  GUEST = 5,
}

/**
 * Discriminated union of the three valid `EUserPermissions` values.
 *
 * Prefer this alias over the bare `EUserPermissions` enum in API/payload type
 * positions so that `tsc` rejects unknown numeric roles at compile time.
 */
export type TUserPermissions = EUserPermissions.ADMIN | EUserPermissions.MEMBER | EUserPermissions.GUEST;

// project network
/**
 * Project visibility within a workspace; mirrors `Project.network` in
 * `apps/api/plane/db/models/project.py`.
 *
 * Numeric `1` is intentionally absent — reserved for a future intermediate visibility
 * tier; do not reuse without a coordinated backend migration.
 */
export enum EProjectNetwork {
  /** Visible only to explicitly added project members. */
  PRIVATE = 0,
  /** Visible to all workspace members regardless of project membership. */
  PUBLIC = 2,
}

// project pages
/**
 * Page visibility — applies to both project pages and workspace pages.
 *
 * Note: this enum's numeric semantics are inverted relative to `EProjectNetwork`
 * (here `PUBLIC = 0`, there `PRIVATE = 0`). Compare by named value, never by raw number.
 */
export enum EPageAccess {
  /** Visible to all workspace / project members. */
  PUBLIC = 0,
  /** Visible only to the page owner. */
  PRIVATE = 1,
}

/**
 * Date-range filter presets used by dashboard widgets and analytics queries.
 *
 * The `CUSTOM` value pairs with an explicit `custom_dates` tuple (start + end ISO date
 * strings) carried separately on the filter payload; the other presets are evaluated
 * against `now()` at query time.
 */
export enum EDurationFilters {
  /** No date narrowing — query spans all time. */
  NONE = "none",
  /** Rolling preset: events occurring today. */
  TODAY = "today",
  /** Rolling preset: events occurring within the current week. */
  THIS_WEEK = "this_week",
  /** Rolling preset: events occurring within the current month. */
  THIS_MONTH = "this_month",
  /** Rolling preset: events occurring within the current year. */
  THIS_YEAR = "this_year",
  /** Caller-supplied explicit date range via a `custom_dates` start+end tuple. */
  CUSTOM = "custom",
}

/**
 * Comment visibility specifier on an issue comment.
 *
 * Drives whether a comment is rendered on public deploy boards (e.g. `apps/space`) or
 * kept internal to authenticated workspace members.
 */
export enum EIssueCommentAccessSpecifier {
  /** Visible to external commenters on public deploy boards (e.g. `apps/space`). */
  EXTERNAL = "EXTERNAL",
  /** Workspace-internal only; never exposed to public deploy boards. */
  INTERNAL = "INTERNAL",
}

// estimates
/**
 * Estimate system family selected for a project's estimates.
 *
 * Mirrors `Estimate.type` choices in `apps/api/plane/db/models/estimate.py`; the
 * project's chosen system determines how `EstimatePoint.value` is rendered and how
 * burn-down / velocity rollups interpret the numeric points.
 */
export enum EEstimateSystem {
  /** Numeric story points (e.g. 1, 2, 3, 5, 8, 13). */
  POINTS = "points",
  /** Qualitative labels — t-shirt sizes (e.g. "Small", "Medium", "Large"). */
  CATEGORIES = "categories",
  /** Time-based estimates (e.g. "1h", "2h", "1d"). */
  TIME = "time",
}

/**
 * Stage discriminator for the multi-step estimate update wizard rendered in project
 * settings.
 *
 * The `SWITCH` stage triggers a data migration when changing an active estimate
 * system; the other stages are pure UI transitions.
 */
export enum EEstimateUpdateStages {
  /** Initial create flow for defining a new estimate system. */
  CREATE = "create",
  /** Editing an existing estimate system (adding/renaming points). */
  EDIT = "edit",
  /** Switching the active estimate system — involves migrating existing estimate values. */
  SWITCH = "switch",
}

// workspace notifications
/**
 * Notification filter dimensions for the workspace notifications panel.
 *
 * Multiple filters can be active simultaneously; the panel takes the union of
 * notifications matching any active filter.
 */
export enum ENotificationFilterType {
  /** Notifications about issues the current user created. */
  CREATED = "created",
  /** Notifications about issues assigned to the current user. */
  ASSIGNED = "assigned",
  /** Notifications about issues the current user explicitly subscribed to. */
  SUBSCRIBED = "subscribed",
}

/**
 * File-asset entity classifier — discriminates the parent entity an asset belongs to.
 *
 * Used by `apps/api/plane/app/views/asset/v2.py` to route presigned URL requests, set
 * the foreign-key column on `FileAsset`, and enforce size/visibility policies per
 * entity family. The frontend enum is a superset of the backend's
 * `FileAsset.EntityTypeContext` (in `apps/api/plane/db/models/asset.py`) and may
 * include values reserved for forthcoming entity types — values not present in the
 * backend `EntityTypeContext` are rejected at upload time.
 */
export enum EFileAssetType {
  /** Rich-text attachments embedded in an issue comment. */
  COMMENT_DESCRIPTION = "COMMENT_DESCRIPTION",
  /** Standalone file attachments hanging off an issue. */
  ISSUE_ATTACHMENT = "ISSUE_ATTACHMENT",
  /** Inline images embedded in an issue's rich-text description. */
  ISSUE_DESCRIPTION = "ISSUE_DESCRIPTION",
  /** Inline images embedded in a draft issue's rich-text description. */
  DRAFT_ISSUE_DESCRIPTION = "DRAFT_ISSUE_DESCRIPTION",
  /** Inline images embedded in a page body (collaborative Y.js document). */
  PAGE_DESCRIPTION = "PAGE_DESCRIPTION",
  /** Cover image displayed on a project's overview surface. */
  PROJECT_COVER = "PROJECT_COVER",
  /** A user's profile avatar. */
  USER_AVATAR = "USER_AVATAR",
  /** A user's profile cover banner. */
  USER_COVER = "USER_COVER",
  /** Workspace branding logo. */
  WORKSPACE_LOGO = "WORKSPACE_LOGO",
  /** Inline images embedded in a team space's rich-text description. */
  TEAM_SPACE_DESCRIPTION = "TEAM_SPACE_DESCRIPTION",
  /** Inline images embedded in an initiative's rich-text description. */
  INITIATIVE_DESCRIPTION = "INITIATIVE_DESCRIPTION",
  /** Inline images embedded in a project's rich-text overview description. */
  PROJECT_DESCRIPTION = "PROJECT_DESCRIPTION",
  /** Rich-text attachments embedded in a team space comment. */
  TEAM_SPACE_COMMENT_DESCRIPTION = "TEAM_SPACE_COMMENT_DESCRIPTION",
}

/**
 * Subset of `EFileAssetType` permitted for inline editor uploads (rich-text body
 * images and comment attachments).
 *
 * Used by `@plane/editor` upload handlers (see `packages/editor/src/core/helpers/parser.ts`)
 * to narrow which entity contexts accept inline image uploads — file-only contexts
 * such as `ISSUE_ATTACHMENT`, `USER_AVATAR`, `USER_COVER`, `WORKSPACE_LOGO`, and
 * `PROJECT_COVER` are intentionally excluded.
 */
export type TEditorAssetType =
  | EFileAssetType.COMMENT_DESCRIPTION
  | EFileAssetType.ISSUE_DESCRIPTION
  | EFileAssetType.DRAFT_ISSUE_DESCRIPTION
  | EFileAssetType.PAGE_DESCRIPTION
  | EFileAssetType.TEAM_SPACE_DESCRIPTION
  | EFileAssetType.INITIATIVE_DESCRIPTION
  | EFileAssetType.PROJECT_DESCRIPTION
  | EFileAssetType.TEAM_SPACE_COMMENT_DESCRIPTION;

// INTENT UNCLEAR: enum is exported but a repository-wide grep finds no consumers
// in apps/ or packages/. Wire format preserves the hyphen on the value literals
// (e.g. "OFF-TRACK"), not the underscore enum-key form.
/**
 * Exported enum of three hyphenated string-literal values ("OFF-TRACK" / "ON-TRACK" /
 * "AT-RISK"). No current in-repository consumers were found by grep at documentation
 * time; serializers and comparisons should reference the enum members rather than the
 * raw string literal to avoid drift in any future consumer.
 */
export enum EUpdateStatus {
  OFF_TRACK = "OFF-TRACK",
  ON_TRACK = "ON-TRACK",
  AT_RISK = "AT-RISK",
}
