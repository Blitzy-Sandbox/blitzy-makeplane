/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace entity contracts for the `@plane/types` package.
 *
 * Models the core workspace record + member role enum (`EUserWorkspaceRoles`) + invite
 * payloads + bulk-invite response + workspace-scoped search/result envelopes + product
 * update changelog projection + active-cycles / progress / analytics rollups + sidebar
 * navigation pin state + onboarding wizard step enums. Mirrors
 * `apps/api/plane/db/models/workspace.py`.
 *
 * Consumed widely across `apps/web/core/store/workspace/`,
 * `apps/web/core/components/workspace/`, the onboarding flow under
 * `apps/web/core/components/onboarding/`, the search command palette in
 * `apps/web/ce/components/command-palette/`, and the workspace permission gates in
 * `apps/api/plane/app/permissions/workspace.py`.
 */

import type { TPaginationInfo } from "./common";
import type { ICycle } from "./cycle";
import type { TUserPermissions } from "./enums";
import type { TProjectMembership } from "./project";
import type { IUser, IUserLite } from "./users";
import type { TLoginMediums } from "./instance";
import type { IWorkspaceViewProps } from "./view-props";

/**
 * Workspace-level role hierarchy applied to members of a workspace.
 *
 * Values are numeric so role comparison can use `>=` / `<=` directly:
 * - `GUEST` (5): lowest — read-only access with project-level grants only
 * - `MEMBER` (15): mid — read/write within granted projects
 * - `ADMIN` (20): highest — full workspace administration
 *
 * Mirrors the workspace role numerics enforced by
 * `apps/api/plane/app/permissions/workspace.py`. Consumed by
 * `apps/web/core/store/user/base-permissions.store.ts` to gate UI affordances
 * (e.g. `EUserWorkspaceRoles.ADMIN` checks for member-management screens) and by
 * issue/workspace-draft components to restrict create/edit actions to ADMIN/MEMBER.
 *
 * IMPORTANT: This enum is distinct from `EUserPermissions` (declared in
 * `./enums.ts`). The two enums share the same numeric values (5 / 15 / 20) but model
 * different scopes — `EUserPermissions` is the platform-wide role identifier used
 * uniformly by stores and constants, whereas `EUserWorkspaceRoles` is workspace-scoped
 * and is the legacy shape returned on `IWorkspace.role` and on workspace membership
 * records.
 */
export enum EUserWorkspaceRoles {
  /** Full workspace administration — manage members, settings, and all projects. */
  ADMIN = 20,
  /** Standard workspace member — read/write access within granted projects. */
  MEMBER = 15,
  /** Read-only workspace access — write access granted only at the project level. */
  GUEST = 5,
}

/**
 * Persisted workspace record returned by the workspace endpoints in `apps/api`.
 *
 * Mirrors `apps/api/plane/db/models/workspace.py::Workspace`. The shape is the
 * canonical client-side projection of a workspace (the unit of multi-tenancy in Plane
 * — every project, cycle, page, view, and member belongs to exactly one workspace).
 *
 * Fields with non-obvious semantics:
 * - `slug`: URL-safe identifier used as the path segment in `/<slug>/...` routes;
 *   server-enforced unique across all workspaces
 * - `owner`: hydrated `IUser` projection of the workspace creator (workspace ownership
 *   is distinct from administrator role — an admin is not necessarily the owner)
 * - `total_members`: server-computed count of active workspace memberships
 * - `total_projects`: server-computed project count; omitted on some list responses
 * - `organization_size`: free-form string describing team size (e.g. `"1-10"`,
 *   `"11-50"`) captured during workspace creation
 * - `role`: numeric `EUserWorkspaceRoles` value — current viewer's role in this
 *   workspace; typed as `number` here for backwards compatibility but should be
 *   compared against `EUserWorkspaceRoles.{ADMIN,MEMBER,GUEST}` constants
 * - `logo_url`: signed URL to the workspace logo asset (resolved server-side from the
 *   stored asset id); null when no logo has been uploaded
 * - `timezone`: IANA timezone string (e.g. `"America/Los_Angeles"`) used to render
 *   workspace-wide schedules and Beat-scheduled task timestamps
 */
export interface IWorkspace {
  readonly id: string;
  readonly owner: IUser;
  readonly created_at: Date;
  readonly updated_at: Date;
  name: string;
  url: string;
  logo_url: string | null;
  readonly total_members: number;
  readonly slug: string;
  readonly created_by: string;
  readonly updated_by: string;
  organization_size: string;
  total_projects?: number;
  role: number;
  timezone: string;
}

/**
 * Minimal workspace projection embedded in cross-entity responses.
 *
 * Includes only the identity triple (id, slug, name) — used when full workspace
 * metadata would be redundant (e.g. inside notification payloads, invite responses,
 * and search results nested under another entity).
 */
export interface IWorkspaceLite {
  readonly id: string;
  name: string;
  slug: string;
}

/**
 * Pending workspace invitation record.
 *
 * Returned by the workspace-invite endpoints in `apps/api` for both the inviter
 * (list of outstanding invites for a workspace) and the invitee (list of workspaces
 * the user has been invited to).
 *
 * Fields with non-obvious semantics:
 * - `accepted`: `true` after the recipient accepts the invite; remains `false` for
 *   outstanding invites and rejected invites — pair with `responded_at` to discriminate
 * - `responded_at`: timestamp of acceptance/rejection (null until responded)
 * - `role`: `TUserPermissions` value the recipient will be granted on acceptance
 * - `token`: opaque server-issued token included in the invite URL — also accepted as
 *   the credential in the `/api/users/me/invitations/<token>/join/` endpoint
 * - `invite_link`: server-rendered absolute URL embedding `token` for direct sharing
 * - `message`: optional custom message from the inviter shown to the invitee
 * - `workspace`: nested lite projection of the target workspace (id/slug/name/logo)
 */
export interface IWorkspaceMemberInvitation {
  accepted: boolean;
  email: string;
  id: string;
  message: string;
  responded_at: Date;
  role: TUserPermissions;
  token: string;
  invite_link: string;
  workspace: {
    id: string;
    logo_url: string;
    name: string;
    slug: string;
  };
}

/**
 * Form payload sent when bulk-inviting members to a workspace.
 *
 * `emails` is an array of `{ email, role }` pairs — each invite can carry an
 * independent role, allowing a single submission to mix ADMIN/MEMBER/GUEST grants.
 * Consumed by the bulk-invite endpoint at
 * `/api/workspaces/<slug>/invitations/` (see `apps/api/plane/app/views/workspace/invite.py`).
 */
export interface IWorkspaceBulkInviteFormData {
  emails: { email: string; role: TUserPermissions }[];
}

/**
 * Legacy per-user issue display-property toggle map.
 *
 * Each boolean controls whether the named column/badge is rendered in issue list and
 * spreadsheet layouts. Superseded by `IIssueDisplayProperties` in `./view-props.ts`
 * for the modern issue-layout stores; retained here for backwards compatibility with
 * older workspace member-property payloads.
 */
export type Properties = {
  assignee: boolean;
  start_date: boolean;
  due_date: boolean;
  labels: boolean;
  key: boolean;
  priority: boolean;
  state: boolean;
  sub_issue_count: boolean;
  link: boolean;
  attachment_count: boolean;
  estimate: boolean;
  created_on: boolean;
  updated_on: boolean;
};

/**
 * Workspace membership record — links a user to a workspace with a role.
 *
 * Joined view exposing both the embedded `IUserLite` for the member and the
 * member-record fields needed for the workspace settings → members table. Returned
 * by `/api/workspaces/<slug>/members/` (see
 * `apps/api/plane/app/views/workspace/member.py`).
 *
 * Fields with non-obvious semantics:
 * - `role`: workspace-level role — accepts both `TUserPermissions` and
 *   `EUserWorkspaceRoles` for compatibility during the in-progress permissions migration
 * - `last_login_medium`: identifies which auth provider the member used on their most
 *   recent sign-in (see `TLoginMediums`); used by admin views to surface SSO usage
 * - `is_active`: soft-deactivation flag — false members are hidden from the active
 *   members list but the row is retained for audit history
 */
export interface IWorkspaceMember {
  id: string;
  member: IUserLite;
  role: TUserPermissions | EUserWorkspaceRoles;
  created_at?: string;
  avatar_url?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  joining_date?: string;
  display_name?: string;
  last_login_medium?: TLoginMediums;
  is_active?: boolean;
}

/**
 * Current viewer's own workspace-membership record (richer than `IWorkspaceMember`).
 *
 * Returned by `/api/workspaces/<slug>/members/me/`; held on the user-permissions
 * store under `workspaceUserInfo[workspaceSlug]`. The two `IWorkspaceViewProps`
 * slots persist the viewer's per-workspace UI preferences so that filter/sort/layout
 * selections survive across sessions and devices.
 *
 * Fields with non-obvious semantics:
 * - `company_role`: free-form job-title string collected during onboarding (e.g.
 *   `"Engineering Manager"`); used for analytics/segmentation, not for permissions
 * - `member`: id of the underlying `User` row (the same id as `IUser.id`); the
 *   `workspace` field is the parent workspace id
 * - `view_props`: persisted view preferences (issue layout, filters, display properties)
 *   for this user in this workspace — applied to newly-opened views
 * - `default_props`: default view preferences applied to newly-created views and as
 *   fallback when a specific view has no overrides
 * - `role`: viewer's `TUserPermissions` / `EUserWorkspaceRoles` value in this workspace
 * - `draft_issue_count`: count of the viewer's workspace-level draft issues —
 *   surfaces a badge in the sidebar to remind the user to finish drafts
 */
export interface IWorkspaceMemberMe {
  company_role: string | null;
  created_at: Date;
  created_by: string;
  default_props: IWorkspaceViewProps;
  id: string;
  member: string;
  role: TUserPermissions | EUserWorkspaceRoles;
  updated_at: Date;
  updated_by: string;
  view_props: IWorkspaceViewProps;
  workspace: string;
  draft_issue_count: number;
}

/**
 * Last-active workspace metadata returned to a signing-in user.
 *
 * Bundles the full workspace record with the viewer's project memberships in that
 * workspace so the post-login redirect can land on the last-visited workspace and
 * preserve project sidebar visibility without an extra round-trip.
 */
export interface ILastActiveWorkspaceDetails {
  workspace_details: IWorkspace;
  project_details?: TProjectMembership[];
}

/**
 * Generic search-result row for project-scoped entities (cycles, modules, views).
 *
 * Used as the row shape for the `cycle`, `module`, and `issue_view` buckets of
 * `IWorkspaceSearchResults`. The double-underscore field names (`project__identifier`,
 * `workspace__slug`) follow Django ORM join-traversal syntax and are returned as-is by
 * the search endpoint at `/api/workspaces/<slug>/search/`.
 */
export interface IWorkspaceDefaultSearchResult {
  id: string;
  name: string;
  project_id: string;
  project__identifier: string;
  workspace__slug: string;
}
/**
 * Search-result row for a workspace itself.
 *
 * Used as the row shape for the `workspace` bucket of `IWorkspaceSearchResults` — the
 * minimal identity triple is sufficient because workspace search results navigate to
 * `/<slug>/...`.
 */
export interface IWorkspaceSearchResult {
  id: string;
  name: string;
  slug: string;
}

/**
 * Search-result row for an issue.
 *
 * Includes the project identifier (`project__identifier`) and sequence id
 * (`sequence_id`) needed to render the canonical issue label (e.g. `"PLN-1234"`).
 * `type_id` is the issue-type id (work item type) — empty string for issues that
 * predate the work-item-types feature.
 */
export interface IWorkspaceIssueSearchResult {
  id: string;
  name: string;
  project__identifier: string;
  project_id: string;
  sequence_id: number;
  workspace__slug: string;
  type_id: string;
}

/**
 * Search-result row for a page.
 *
 * Pages can belong to multiple projects (per the page-sharing model in
 * `apps/api/plane/db/models/page.py`), so `project_ids` and `project__identifiers`
 * are arrays with matching order — the i-th identifier corresponds to the i-th id.
 */
export interface IWorkspacePageSearchResult {
  id: string;
  name: string;
  project_ids: string[];
  project__identifiers: string[];
  workspace__slug: string;
}

/**
 * Search-result row for a project.
 *
 * `identifier` is the short project code (e.g. `"PLN"`) used as the prefix in issue
 * labels — distinct from `id`, which is the UUID.
 */
export interface IWorkspaceProjectSearchResult {
  id: string;
  identifier: string;
  name: string;
  workspace__slug: string;
}

/**
 * Aggregated workspace search response — buckets per entity type.
 *
 * Returned by `/api/workspaces/<slug>/search/`. Each bucket name matches one of the
 * supported entity types: `workspace`, `project`, `issue`, `cycle`, `module`,
 * `issue_view`, `page`. All buckets are present (possibly as empty arrays) for shape
 * consistency — consumers can iterate without checking presence.
 *
 * Consumed by the command-palette / spotlight search in
 * `apps/web/ce/components/command-palette/` to render grouped result sections.
 */
export interface IWorkspaceSearchResults {
  results: {
    workspace: IWorkspaceSearchResult[];
    project: IWorkspaceProjectSearchResult[];
    issue: IWorkspaceIssueSearchResult[];
    cycle: IWorkspaceDefaultSearchResult[];
    module: IWorkspaceDefaultSearchResult[];
    issue_view: IWorkspaceDefaultSearchResult[];
    page: IWorkspacePageSearchResult[];
  };
}

/**
 * GitHub Release record proxied through the workspace product-updates endpoint.
 *
 * Returned by the "What's new" panel in `apps/web` after the server fetches the
 * upstream release list from the GitHub Releases API and forwards it verbatim. Field
 * naming therefore tracks the GitHub Releases REST schema rather than Plane's own
 * conventions.
 *
 * Fields with non-obvious semantics:
 * - `body`: changelog markdown rendered by the in-app changelog viewer
 * - `prerelease` / `draft`: lifecycle flags from GitHub (`true` for non-final releases)
 * - `published_at` / `created_at`: ISO timestamps from GitHub
 * - `tag_name`: the git tag for the release (e.g. `"v0.27.1"`)
 * - `assets`: typed as the empty tuple `[]` because Plane's release pipeline does not
 *   attach binary assets — consumers should not rely on length > 0
 * - `reactions`: per-emoji reaction tallies aggregated by GitHub
 */
export interface IProductUpdateResponse {
  url: string;
  assets_url: string;
  upload_url: string;
  html_url: string;
  id: number;
  author: {
    login: string;
    id: string;
    node_id: string;
    avatar_url: string;
    gravatar_id: "";
    url: string;
    html_url: string;
    followers_url: string;
    following_url: string;
    gists_url: string;
    starred_url: string;
    subscriptions_url: string;
    organizations_url: string;
    repos_url: string;
    events_url: string;
    received_events_url: string;
    type: string;
    site_admin: false;
  };
  node_id: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  draft: boolean;
  prerelease: true;
  created_at: string;
  published_at: string;
  assets: [];
  tarball_url: string;
  zipball_url: string;
  body: string;
  reactions: {
    url: string;
    total_count: number;
    "+1": number;
    "-1": number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    rocket: number;
    eyes: number;
  };
}

/**
 * Paginated response envelope for the workspace-active-cycles endpoint.
 *
 * Returned by `/api/workspaces/<slug>/active-cycles/`. Follows Plane's cursor-paginated
 * shape (mirrors `TPaginationInfo` in `./common.ts`) but is declared inline because
 * `extra_stats` is constrained to `null` for this endpoint (no aggregate stats are
 * computed alongside the page).
 */
export interface IWorkspaceActiveCyclesResponse {
  count: number;
  extra_stats: null;
  next_cursor: string;
  next_page_results: boolean;
  prev_cursor: string;
  prev_page_results: boolean;
  results: ICycle[];
  total_pages: number;
}

/**
 * Workspace-wide issue progress rollup.
 *
 * Aggregated counts across every project in the workspace, partitioned by the issue
 * state group. Drives the workspace home/dashboard progress widgets. The five state
 * groups match `TStateGroups` in `./state.ts` (backlog issues are not included in this
 * rollup — they are counted implicitly via `total_issues - (other four)`).
 */
export interface IWorkspaceProgressResponse {
  completed_issues: number;
  total_issues: number;
  started_issues: number;
  cancelled_issues: number;
  unstarted_issues: number;
}
/**
 * Workspace-wide analytics rollup envelope.
 *
 * `completion_chart` is a free-form date-bucketed map (keys are date strings, values
 * are aggregate metrics) populated by the analytics backend. Typed as
 * `Record<string, unknown>` because the bucket schema varies by chart configuration
 * — consumers (`apps/web/core/components/analytics/`) narrow it at the call site.
 */
export interface IWorkspaceAnalyticsResponse {
  completion_chart: Record<string, unknown>;
}

/**
 * Paginated workspace list response.
 *
 * Concrete instantiation of `TPaginationInfo` for endpoints that return a page of
 * `IWorkspace` rows (e.g. admin-scoped workspace listings).
 */
export type TWorkspacePaginationInfo = TPaginationInfo & {
  results: IWorkspace[];
};

/**
 * Single sidebar-navigation pin entry for a workspace.
 *
 * Fields:
 * - `key`: stable identifier of the sidebar item being pinned (e.g. `"home"`,
 *   `"your-work"`); optional because the key is also encoded by the map's outer key
 * - `is_pinned`: visibility flag in the sidebar
 * - `sort_order`: integer ordering within the pinned section (lower sorts first)
 */
export interface IWorkspaceSidebarNavigationItem {
  key?: string;
  is_pinned: boolean;
  sort_order: number;
}

/**
 * Map of sidebar-navigation entries keyed by sidebar item key.
 *
 * Persisted on the viewer's profile (`apps/api/plane/db/models/user.py`) so that
 * sidebar pin state is restored across sessions and devices.
 */
export interface IWorkspaceSidebarNavigation {
  [key: string]: IWorkspaceSidebarNavigationItem;
}

/**
 * Step discriminator for the new-user onboarding wizard.
 *
 * Drives the screen-routing logic in `apps/web/core/components/onboarding/root.tsx`.
 * Steps are presented in declaration order; the server-side onboarding-progress flag
 * stores the highest completed step so partial onboarding survives across sessions.
 */
export enum EOnboardingSteps {
  /** Capture user's display name and avatar. */
  PROFILE_SETUP = "PROFILE_SETUP",
  /** Capture the user's role (e.g. engineering, design) — used for analytics. */
  ROLE_SETUP = "ROLE_SETUP",
  /** Capture the user's intended use case for Plane — used to seed onboarding tips. */
  USE_CASE_SETUP = "USE_CASE_SETUP",
  /** Branch: create a new workspace or accept a pending invitation. */
  WORKSPACE_CREATE_OR_JOIN = "WORKSPACE_CREATE_OR_JOIN",
  /** Final step: invite teammates by email before entering the product. */
  INVITE_MEMBERS = "INVITE_MEMBERS",
}

/**
 * Type alias re-exporting `EOnboardingSteps` for ergonomic typing of onboarding
 * step parameters (e.g. `currentStep: TOnboardingStep`).
 */
export type TOnboardingStep = EOnboardingSteps;

/**
 * Sub-view discriminator inside the workspace create-or-join onboarding step.
 *
 * Toggles the inner panel between "create a new workspace" and "join an existing
 * workspace" within `EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN`. Note: the same
 * enum is also re-declared locally in
 * `apps/web/core/components/onboarding/create-or-join-workspaces.tsx`; values must
 * stay in sync if either is modified.
 */
export enum ECreateOrJoinWorkspaceViews {
  /** Show the new-workspace creation form. */
  WORKSPACE_CREATE = "WORKSPACE_CREATE",
  /** Show the pending-invitations panel for joining an existing workspace. */
  WORKSPACE_JOIN = "WORKSPACE_JOIN",
}
