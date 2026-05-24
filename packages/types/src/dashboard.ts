/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace dashboard widget contracts for the `@plane/types` package.
 *
 * Models the legacy workspace dashboard surface — widget keys, per-widget filter shapes,
 * response envelopes, and the deprecated `TDeprecatedDashboard` record. The newer home
 * dashboard (see `./home.ts`) supersedes this for net-new development, but these types
 * remain in use by the dashboard widget loaders in `apps/web/core/components/dashboard/`
 * and the dashboard service in `apps/web/core/services/`. Mirrors the dashboard tables
 * in `apps/api/plane/db/models/`.
 */

import type { EDurationFilters } from "./enums";
import type { IIssueActivity, TIssuePriorities } from "./issues";
import type { TIssue } from "./issues/issue";
import type { TIssueRelationTypes } from "./issues/issue_relation";
import type { TStateGroups } from "./state";

/**
 * Stable identifiers for the legacy dashboard widgets.
 *
 * Union members describe each widget family — overview stats, assigned issues, created
 * issues, issues by state group, issues by priority, recent activity, recent projects,
 * recent collaborators. Persisted on `TWidget.key` and used as the routing
 * discriminant in `TWidgetStatsRequestParams` / `TWidgetFiltersFormData`.
 */
export type TWidgetKeys =
  | "overview_stats"
  | "assigned_issues"
  | "created_issues"
  | "issues_by_state_groups"
  | "issues_by_priority"
  | "recent_activity"
  | "recent_projects"
  | "recent_collaborators";

/**
 * Issue tab within the assigned / created issues widget.
 *
 * Union values:
 * - `pending`: not yet completed and not overdue
 * - `upcoming`: target_date within the upcoming window
 * - `overdue`: past target_date and not yet completed
 * - `completed`: in a completed state group
 */
export type TIssuesListTypes = "pending" | "upcoming" | "overdue" | "completed";

// widget filters
/**
 * Filter selections for the "Assigned Issues" widget.
 *
 * Fields:
 * - `duration`: `EDurationFilters` preset (`today` / `this_week` / `this_month` /
 *   `this_year` / `custom` / `none`)
 * - `custom_dates`: pair of ISO date strings (start, end) — only meaningful when
 *   `duration === EDurationFilters.CUSTOM`
 * - `tab`: which `TIssuesListTypes` tab is currently selected
 */
export type TAssignedIssuesWidgetFilters = {
  custom_dates?: string[];
  duration?: EDurationFilters;
  tab?: TIssuesListTypes;
};

/**
 * Filter selections for the "Created Issues" widget.
 *
 * Same field shape as `TAssignedIssuesWidgetFilters` — but applies to issues created
 * by the current user rather than assigned to them.
 */
export type TCreatedIssuesWidgetFilters = {
  custom_dates?: string[];
  duration?: EDurationFilters;
  tab?: TIssuesListTypes;
};

/**
 * Filter selections for the "Issues by State Group" widget.
 *
 * Only a `duration` preset (+ optional `custom_dates` tuple) is exposed — buckets are
 * always grouped by `TStateGroups` value in the response.
 */
export type TIssuesByStateGroupsWidgetFilters = {
  duration?: EDurationFilters;
  custom_dates?: string[];
};

/**
 * Filter selections for the "Issues by Priority" widget.
 *
 * Only a `duration` preset (+ optional `custom_dates` tuple) is exposed — buckets are
 * always grouped by `TIssuePriorities` value in the response.
 */
export type TIssuesByPriorityWidgetFilters = {
  custom_dates?: string[];
  duration?: EDurationFilters;
};

/**
 * Discriminated union of widget-filter form submissions.
 *
 * Discriminant: `widgetKey` selects which `filters` shape applies:
 * - `assigned_issues` → `Partial<TAssignedIssuesWidgetFilters>`
 * - `created_issues` → `Partial<TCreatedIssuesWidgetFilters>`
 * - `issues_by_state_groups` → `Partial<TIssuesByStateGroupsWidgetFilters>`
 * - `issues_by_priority` → `Partial<TIssuesByPriorityWidgetFilters>`
 *
 * `Partial<>` is used because the form may submit only the fields the user changed.
 */
export type TWidgetFiltersFormData =
  | {
      widgetKey: "assigned_issues";
      filters: Partial<TAssignedIssuesWidgetFilters>;
    }
  | {
      widgetKey: "created_issues";
      filters: Partial<TCreatedIssuesWidgetFilters>;
    }
  | {
      widgetKey: "issues_by_state_groups";
      filters: Partial<TIssuesByStateGroupsWidgetFilters>;
    }
  | {
      widgetKey: "issues_by_priority";
      filters: Partial<TIssuesByPriorityWidgetFilters>;
    };

/**
 * Persisted widget configuration (one row per dashboard widget).
 *
 * Field semantics:
 * - `is_visible`: when `false` the widget is hidden on the dashboard
 * - `key`: widget identifier — see `TWidgetKeys`
 * - `widget_filters`: read-only snapshot of the currently applied filters (returned by
 *   the read endpoint)
 * - `filters`: editable filter payload accepted by the write endpoint
 *
 * The split between `widget_filters` and `filters` lets the server expose an immutable
 * read-shape while accepting a partial write-shape — both intersect every per-widget
 * filter family because a single record stores configuration for any widget type.
 */
export type TWidget = {
  id: string;
  is_visible: boolean;
  key: TWidgetKeys;
  readonly widget_filters: // only for read
  TAssignedIssuesWidgetFilters &
    TCreatedIssuesWidgetFilters &
    TIssuesByStateGroupsWidgetFilters &
    TIssuesByPriorityWidgetFilters;
  filters: // only for write
  TAssignedIssuesWidgetFilters &
    TCreatedIssuesWidgetFilters &
    TIssuesByStateGroupsWidgetFilters &
    TIssuesByPriorityWidgetFilters;
};

/**
 * Discriminated union of widget stats query parameters — `widget_key` selects which
 * additional fields are required by the stats endpoint.
 *
 * Variants:
 * - Minimal (`{ widget_key }`): valid for widgets with no extra params
 *   (e.g. `overview_stats`, `recent_activity`, `recent_projects`)
 * - Assigned issues: `{ target_date, issue_type, widget_key: "assigned_issues" }`
 *   plus optional `expand: "issue_relation"` to hydrate `TWidgetIssue.issue_relation`
 * - Created issues: `{ target_date, issue_type, widget_key: "created_issues" }`
 * - State-group / Priority: `{ target_date, widget_key }`
 * - Recent collaborators: `{ cursor, per_page, search?, widget_key: "recent_collaborators" }`
 */
export type TWidgetStatsRequestParams =
  | {
      widget_key: TWidgetKeys;
    }
  | {
      target_date: string;
      issue_type: TIssuesListTypes;
      widget_key: "assigned_issues";
      expand?: "issue_relation";
    }
  | {
      target_date: string;
      issue_type: TIssuesListTypes;
      widget_key: "created_issues";
    }
  | {
      target_date: string;
      widget_key: "issues_by_state_groups";
    }
  | {
      target_date: string;
      widget_key: "issues_by_priority";
    }
  | {
      cursor: string;
      per_page: number;
      search?: string;
      widget_key: "recent_collaborators";
    };

/**
 * Issue projection used in widget responses — `TIssue` extended with an
 * `issue_relation` array populated when the request includes `expand=issue_relation`.
 */
export type TWidgetIssue = TIssue & {
  issue_relation: {
    id: string;
    project_id: string;
    relation_type: TIssueRelationTypes;
    sequence_id: number;
    type_id: string | null;
  }[];
};

// widget stats responses
/**
 * Response for the `overview_stats` widget — aggregate issue counts across the
 * workspace for the current viewer.
 */
export type TOverviewStatsWidgetResponse = {
  assigned_issues_count: number;
  completed_issues_count: number;
  created_issues_count: number;
  pending_issues_count: number;
};

/**
 * Response for the `assigned_issues` widget — paginated issue list plus total count.
 */
export type TAssignedIssuesWidgetResponse = {
  issues: TWidgetIssue[];
  count: number;
};

/**
 * Response for the `created_issues` widget — paginated issue list plus total count.
 */
export type TCreatedIssuesWidgetResponse = {
  issues: TWidgetIssue[];
  count: number;
};

/**
 * Single bucket in the `issues_by_state_groups` widget response.
 *
 * The full response is an array of these — one entry per `TStateGroups` value
 * (`backlog`, `unstarted`, `started`, `completed`, `cancelled`).
 */
export type TIssuesByStateGroupsWidgetResponse = {
  count: number;
  state: TStateGroups;
};

/**
 * Single bucket in the `issues_by_priority` widget response — one entry per
 * `TIssuePriorities` value (`urgent` / `high` / `medium` / `low` / `none`).
 */
export type TIssuesByPriorityWidgetResponse = {
  count: number;
  priority: TIssuePriorities;
};

/**
 * Response item for the `recent_activity` widget — re-exports `IIssueActivity` so
 * widget call sites can narrow `TWidgetStatsResponse` without importing the activity
 * shape directly.
 */
export type TRecentActivityWidgetResponse = IIssueActivity;

/**
 * Response for the `recent_projects` widget — ordered list of project ids the current
 * viewer has recently visited.
 */
export type TRecentProjectsWidgetResponse = string[];

/**
 * Single entry in the `recent_collaborators` widget response — a workspace member the
 * viewer has recently collaborated with plus their active (non-completed) issue count.
 */
export type TRecentCollaboratorsWidgetResponse = {
  active_issue_count: number;
  user_id: string;
};

/**
 * Discriminated union of every widget stats response shape — narrow by the request's
 * `widget_key` at the call site (the server returns the variant that matches the
 * requested widget). Array variants correspond to widgets whose response is a list of
 * buckets (state group, priority) or rows (recent activity, recent collaborators).
 */
export type TWidgetStatsResponse =
  | TOverviewStatsWidgetResponse
  | TIssuesByStateGroupsWidgetResponse[]
  | TIssuesByPriorityWidgetResponse[]
  | TAssignedIssuesWidgetResponse
  | TCreatedIssuesWidgetResponse
  | TRecentActivityWidgetResponse[]
  | TRecentProjectsWidgetResponse
  | TRecentCollaboratorsWidgetResponse[];

// dashboard
/**
 * Deprecated workspace-dashboard record.
 *
 * Predates the home dashboard system (`./home.ts`) and is retained for legacy API
 * compatibility — net-new code should target the home dashboard endpoints instead.
 *
 * Field semantics:
 * - `is_default`: when `true` this is the workspace's default dashboard
 * - `owned_by`: workspace member id that owns the dashboard
 * - `identifier`: optional human-friendly identifier (nullable)
 * - `description_html`: pre-rendered HTML description string
 */
export type TDeprecatedDashboard = {
  created_at: string;
  created_by: string | null;
  description_html: string;
  id: string;
  identifier: string | null;
  is_default: boolean;
  name: string;
  owned_by: string;
  type: string;
  updated_at: string;
  updated_by: string | null;
};

/**
 * Response envelope for the legacy home dashboard endpoint — wraps a dashboard record
 * plus its configured widget rows.
 */
export type THomeDashboardResponse = {
  dashboard: TDeprecatedDashboard;
  widgets: TWidget[];
};
