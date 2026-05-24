/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * User profile contracts for the `@plane/types` package.
 *
 * Models the canonical `IUser` entity, the compact `IUserLite` projection used in
 * cross-entity responses, the user-account record (sign-in provider link), the
 * onboarding wizard step state, profile preferences, instance-admin flag, derived
 * activity rollups, profile-page statistics, and email notification preferences.
 *
 * Mirrors `apps/api/plane/db/models/user.py`. Distinct from `./auth.ts` (sign-in
 * flow payloads) and `./current-user/profile.ts` (current-viewer preferences;
 * a leaner twin of `TUserProfile` defined here).
 */

import type { TUserPermissions } from "./enums";
import type { IIssueActivity, TIssuePriorities, TStateGroups } from ".";
import type { TLoginMediums } from "./instance";

/**
 * First day of the week used to render calendar layouts and order day arrays.
 *
 * Values are numerically meaningful — `SUNDAY = 0` through `SATURDAY = 6` — and
 * are consumed as arithmetic operands by calendar utilities in `@plane/utils`
 * (e.g. `generateCalendarData`, `getOrderedDays`) to shift the visible week.
 *
 * @enum {number}
 */
export enum EStartOfTheWeek {
  SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6,
}

/**
 * Minimal user projection embedded in cross-entity responses.
 *
 * Used by activity rows, reactions, mentions, and membership records to attach
 * the actor's display info without fetching the full `IUser` record. Serves as
 * the base shape extended by `IUser` and `IUserMemberLite`.
 *
 * Field semantics:
 * - `avatar_url`: signed URL ready for `<img src>` rendering — distinct from the
 *   raw asset id stored on the backend
 * - `display_name`: canonical render name, falling back to the email-prefix when
 *   no explicit value has been set on the backend
 * - `email`: optional because public projections of bot/system actors may omit it
 * - `is_bot`: true for system-managed actors (e.g. integration bots); UI should
 *   suppress profile navigation for these users
 * - `joining_date`: ISO date string of workspace join; optional because some
 *   projections (e.g. activity actors) are workspace-agnostic
 */
export interface IUserLite {
  avatar_url: string;
  display_name: string;
  email?: string;
  first_name: string;
  id: string;
  is_bot: boolean;
  last_name: string;
  joining_date?: string;
}
/**
 * Canonical user profile record — the full authenticated viewer entity.
 *
 * Mirrors the public fields of `apps/api/plane/db/models/user.py`. Extends
 * `IUserLite` and adds account-state, contact, locale, and theme fields.
 *
 * Field semantics:
 * - `cover_image_asset` / `cover_image`: backend asset id / legacy URL string used
 *   only when uploading; consumers should render `cover_image_url` instead
 * - `cover_image_url`: signed URL ready for rendering — resolved server-side from
 *   `cover_image_asset` first, falling back to `cover_image`
 * - `is_email_verified`: gates sensitive actions such as workspace creation
 * - `is_password_autoset`: `true` when no password has been explicitly set by the
 *   user (e.g. magic-link-only accounts); the UI uses this to suppress the
 *   "change password" flow in favor of "set password"
 * - `is_tour_completed`: tracks whether the product tour has finished — distinct
 *   from `is_onboarded` on `TUserProfile`
 * - `last_workspace_id`: id of the workspace to restore on next sign-in; empty
 *   string on first login or when the last workspace has been deleted
 * - `last_login_medium`: which auth provider was used on the most recent login
 *   (see `TLoginMediums`); informs which provider button to highlight on re-auth
 * - `theme`: nested palette/mode preferences (see `IUserTheme`)
 */
export interface IUser extends IUserLite {
  // only for uploading the cover image
  cover_image_asset?: string | null;
  cover_image?: string | null;
  // only for rendering the cover image
  cover_image_url: string | null;
  date_joined: string;
  email: string;
  is_active: boolean;
  is_email_verified: boolean;
  is_password_autoset: boolean;
  is_tour_completed: boolean;
  mobile_number: string | null;
  last_workspace_id: string;
  user_timezone: string;
  username: string;
  last_login_medium: TLoginMediums;
  theme: IUserTheme;
}

/**
 * User-account record linking a user to an external auth provider.
 *
 * One row per `(user, provider)` pair (e.g. Google, GitHub, GitLab, magic-link).
 * Consumed by `AccountStore` in `apps/web/core/store/user/account.store.ts` to
 * render connected-account chips and drive unlink flows.
 *
 * Field semantics:
 * - `provider_account_id`: stable id of the user at the provider (e.g. Google's
 *   `sub` claim); used to detect provider-side account changes
 * - `provider`: short string identifier of the auth provider (e.g. `"google"`,
 *   `"github"`, `"gitlab"`, `"magic-code"`)
 */
export interface IUserAccount {
  provider_account_id: string;
  provider: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Onboarding, billing, locale, and theme preferences for the authenticated user.
 *
 * Distinct from `./current-user/profile.ts`'s `TUserProfile` — that twin omits
 * `language`, `start_of_the_week`, and the expanded theme palette. The shape here
 * is the authoritative client-side projection of the backend `UserProfile` row.
 *
 * Field semantics:
 * - `theme`: nested palette object — `theme` is the named theme (e.g. `"light"`,
 *   `"dark"`, `"custom"`); `primary`, `background`, and `darkPalette` apply only
 *   to the `"custom"` theme
 * - `onboarding_step`: per-step completion flags (see `TOnboardingSteps`)
 * - `is_onboarded`: `true` once the onboarding wizard is complete; when `false`
 *   the app routes the user to the onboarding flow
 * - `use_case`: free-text selection captured during onboarding describing how the
 *   user intends to use Plane; consumed by analytics, not by feature gating
 * - `role`: free-text role selection captured during onboarding (e.g. "Designer",
 *   "PM"); distinct from workspace/project permission roles
 * - `has_billing_address`: convenience flag; `true` iff `billing_address` is set
 * - `has_marketing_email_consent`: explicit opt-in for marketing emails — gates
 *   inclusion in marketing campaigns
 * - `language`: locale code preference (e.g. `"en-US"`, `"fr"`); consumed by the
 *   i18n layer to pick a translation bundle
 * - `start_of_the_week`: numeric day index (see `EStartOfTheWeek`) used by
 *   calendar utilities to shift the visible week
 */
export type TUserProfile = {
  id: string | undefined;
  user: string | undefined;
  role: string | undefined;
  last_workspace_id: string | undefined;
  theme: {
    theme: string | undefined;
    primary: string | undefined;
    background: string | undefined;
    darkPalette: boolean | undefined;
  };
  onboarding_step: TOnboardingSteps;
  is_onboarded: boolean;
  is_tour_completed: boolean;
  use_case: string | undefined;
  billing_address_country: string | undefined;
  billing_address: string | undefined;
  has_billing_address: boolean;
  has_marketing_email_consent: boolean;
  language: string;
  created_at: Date | string;
  updated_at: Date | string;
  start_of_the_week: EStartOfTheWeek;
};

/**
 * Boolean flag indicating whether the authenticated user has instance-admin rights.
 *
 * Returned from the `/api/users/me/instance-admin/` endpoint. Used by the admin
 * UI surface to gate instance-level settings — note this is distinct from
 * `IInstanceAdmin` in `./instance/base.ts`, which models the full admin record.
 */
export interface IInstanceAdminStatus {
  is_instance_admin: boolean;
}

/**
 * User-specific workspace fallback state and pending-invite count.
 *
 * Consumed by `UserSettingsStore` in `apps/web/core/store/user/settings.store.ts`
 * to drive post-login workspace routing and the invite-badge indicator.
 *
 * Field semantics:
 * - `workspace.last_workspace_id` / `last_workspace_slug` / `last_workspace_name`
 *   / `last_workspace_logo`: details of the workspace the user most recently
 *   visited — used to deep-link the user back on next sign-in
 * - `workspace.fallback_workspace_id` / `fallback_workspace_slug`: workspace to
 *   redirect to when the last workspace is unavailable (deleted, removed, etc.)
 * - `workspace.invites`: count of pending workspace invites for the user; drives
 *   the invite-badge counter in the workspace switcher
 */
export interface IUserSettings {
  id: string | undefined;
  email: string | undefined;
  workspace: {
    last_workspace_id: string | undefined;
    last_workspace_slug: string | undefined;
    last_workspace_name: string | undefined;
    last_workspace_logo: string | undefined;
    fallback_workspace_id: string | undefined;
    fallback_workspace_slug: string | undefined;
    invites: number | undefined;
  };
}

/**
 * Theme palette preferences nested inside `IUser.theme`.
 *
 * Field semantics:
 * - `theme`: named theme — typically `"light"`, `"dark"`, `"system"`, or
 *   `"custom"`; when `"custom"`, the remaining fields take effect
 * - `primary`: custom accent color (hex string) applied to buttons, links, etc.
 *   when `theme === "custom"`
 * - `background`: custom page background color (hex string) applied when
 *   `theme === "custom"`
 * - `darkPalette`: `true` when the custom theme uses a dark base palette;
 *   controls which set of token defaults is layered under the custom overrides
 */
export interface IUserTheme {
  theme: string | undefined; // 'light', 'dark', 'custom', etc.
  primary?: string | undefined;
  background?: string | undefined;
  darkPalette?: boolean | undefined;
}

/**
 * `IUserLite` extended with an explicit `email` field.
 *
 * Used in workspace-member and project-member contexts where the consumer always
 * needs the member's email (e.g. invite resend, mention search) but does not
 * require the full `IUser` record.
 */
export interface IUserMemberLite extends IUserLite {
  email?: string;
}

/**
 * Per-day activity rollup row used by the profile-page activity chart.
 *
 * Field semantics:
 * - `created_date`: ISO date string (`YYYY-MM-DD`) — one bucket per calendar day
 * - `activity_count`: number of activity records attributed to the user on that
 *   day (issue updates, comments, etc., as counted by the backend rollup)
 */
export interface IUserActivity {
  created_date: string;
  activity_count: number;
}

/**
 * Issue count for the user, bucketed by priority.
 *
 * Consumed by the profile-page distribution chart; one row per priority value.
 */
export interface IUserPriorityDistribution {
  priority: TIssuePriorities;
  priority_count: number;
}

/**
 * Issue count for the user, bucketed by state group (backlog / unstarted /
 * started / completed / cancelled).
 *
 * Consumed by the profile-page distribution chart; one row per state group.
 */
export interface IUserStateDistribution {
  state_group: TStateGroups;
  state_count: number;
}

/**
 * Paginated response envelope for the user-activity endpoint.
 *
 * Wraps `IIssueActivity[]` with cursor-based pagination metadata. The
 * `extra_stats` field is reserved and currently always `null`.
 */
export interface IUserActivityResponse {
  count: number;
  extra_stats: null;
  next_cursor: string;
  next_page_results: boolean;
  prev_cursor: string;
  prev_page_results: boolean;
  results: IIssueActivity[];
  total_pages: number;
  total_results: number;
}

// INTENT UNCLEAR: no current consumers found in apps/web, apps/space, or packages;
// retained as a legacy coarse-role flag shape that may be referenced by
// downstream forks. Fields are mutually-non-exclusive booleans tracking
// membership / ownership / guest status of a user in some workspace or project.
/**
 * Legacy coarse role-flag triple — `isMember`, `isOwner`, `isGuest`.
 *
 * Retained for backward compatibility; no active consumers were found in the
 * current codebase. New code should use `TUserPermissions` from `./enums.ts`.
 */
export type UserAuth = {
  isMember: boolean;
  isOwner: boolean;
  isGuest: boolean;
};

/**
 * Per-step completion flags for the onboarding wizard.
 *
 * Each boolean tracks whether the user has finished the corresponding step.
 * `is_onboarded` on `TUserProfile` is `true` only when every step here is `true`
 * (or the user explicitly skipped).
 *
 * Field semantics:
 * - `profile_complete`: user filled in first name / last name / display name
 * - `workspace_create`: user created a new workspace during onboarding
 * - `workspace_invite`: user invited team members (or explicitly skipped)
 * - `workspace_join`: user accepted a pending workspace invite
 */
export type TOnboardingSteps = {
  profile_complete: boolean;
  workspace_create: boolean;
  workspace_invite: boolean;
  workspace_join: boolean;
};

/**
 * Aggregated counters and distributions shown on the user profile page header.
 *
 * Consumed by `UserService` in `apps/web/core/services/user.service.ts` to
 * populate the profile-overview card.
 *
 * Field semantics:
 * - `assigned_issues` / `completed_issues` / `created_issues` / `pending_issues`
 *   / `subscribed_issues`: counters scoped to the viewed user across all
 *   accessible projects
 * - `priority_distribution`: issue counts bucketed by priority (see
 *   `IUserPriorityDistribution`)
 * - `state_distribution`: issue counts bucketed by state group (see
 *   `IUserStateDistribution`)
 */
export interface IUserProfileData {
  assigned_issues: number;
  completed_issues: number;
  created_issues: number;
  pending_issues: number;
  priority_distribution: IUserPriorityDistribution[];
  state_distribution: IUserStateDistribution[];
  subscribed_issues: number;
}

/**
 * Profile-page response that segregates the user's issue counts per project
 * and bundles the user header data in a single payload.
 *
 * Field semantics:
 * - `project_data`: one entry per project the user is a member of, each carrying
 *   the same issue-count buckets as `IUserProfileData` but scoped to the project
 * - `user_data`: subset of `IUser` (display fields) plus the user's join date
 *   and timezone for the profile header card
 */
export interface IUserProfileProjectSegregation {
  project_data: {
    assigned_issues: number;
    completed_issues: number;
    created_issues: number;
    id: string;
    pending_issues: number;
  }[];
  user_data: Pick<IUser, "avatar_url" | "cover_image_url" | "display_name" | "first_name" | "last_name"> & {
    date_joined: Date;
    user_timezone: string;
  };
}

/**
 * Map of project id → user's permission level within that project.
 *
 * Consumed by `WorkspaceService` and `BasePermissionsStore` to resolve whether
 * the current user can perform a given action in a given project without an
 * additional round-trip. See `TUserPermissions` for the value semantics.
 */
export interface IUserProjectsRole {
  [projectId: string]: TUserPermissions;
}

/**
 * Per-category email notification opt-in flags for the authenticated user.
 *
 * Each boolean controls whether the user receives an email when the
 * corresponding event occurs on an issue they subscribe to.
 *
 * Field semantics:
 * - `property_change`: any non-state, non-comment field update (assignee,
 *   priority, labels, etc.)
 * - `state_change`: issue state transitions
 * - `comment`: new comment posted on a subscribed issue
 * - `mention`: the user is `@`-mentioned in a comment or description
 * - `issue_completed`: subscribed issue transitions to a `completed` state
 */
export interface IUserEmailNotificationSettings {
  property_change: boolean;
  state_change: boolean;
  comment: boolean;
  mention: boolean;
  issue_completed: boolean;
}

/**
 * Discriminator for the profile-page sub-tab — selects which list of issues to
 * render under the user's profile.
 */
export type TProfileViews = "assigned" | "created" | "subscribed";

/**
 * Public-spaces minimal member projection.
 *
 * The double-underscore field names (`member__display_name`, `member__avatar`)
 * reflect Django ORM join-path serialization from `apps/api`. A twin definition
 * exists in `apps/space/types/member.d.ts` for the public-spaces frontend.
 */
export type TPublicMember = {
  id: string;
  member: string;
  member__display_name: string;
  member__avatar: string;
};

// export interface ICurrentUser {
//   id: readonly string;
//   avatar: string;
//   first_name: string;
//   last_name: string;
//   username: string;
//   email: string;
//   mobile_number: string;
//   is_email_verified: boolean;
//   is_tour_completed: boolean;
//   onboarding_step: TOnboardingSteps;
//   is_onboarded: boolean;
//   role: string;
// }

// export interface ICustomTheme {
//   background: string;
//   text: string;
//   primary: string;
//   sidebarBackground: string;
//   sidebarText: string;
//   darkPalette: boolean;
//   palette: string;
//   theme: string;
// }

// export interface ICurrentUserSettings {
//   theme: ICustomTheme;
// }
