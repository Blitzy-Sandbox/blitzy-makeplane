/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core issue (work item) entity contracts for the `@plane/types/issues`
 * subfolder.
 *
 * Declares the canonical `TBaseIssue` and `TIssue` shapes plus the layout,
 * service, and store discriminant enums, the paginated list-response
 * envelopes, the bulk-update payload types, and the reduced-field public
 * issue interface served on deploy/space surfaces. Mirrors
 * `apps/api/plane/db/models/issue.py::Issue` and the DRF serializer in
 * `apps/api/plane/app/serializers/issue.py::IssueSerializer` (and the public
 * counterpart used by the deploy/space app).
 *
 * Consumers — virtually every issue surface in the monorepo embeds these
 * shapes:
 * - `apps/web/core/store/issue/**` — MobX stores (issue, kanban, list,
 *   calendar, gantt, spreadsheet variants).
 * - `apps/web/core/components/issues/**` — UI surfaces (issue detail,
 *   peek overview, issue modal, layout roots, properties, dropdowns).
 * - `apps/web/core/store/issue/helpers/` — pure helpers that operate on
 *   `TIssue` records (grouping, sorting, filter application).
 * - `packages/services/src/issue/` — REST client for the issue endpoints.
 * - Notification, search, intake, draft, and webhook payloads all embed
 *   `TIssue` (or a `Partial<TIssue>`) shapes.
 *
 * Re-exported via `./base.ts` (the folder barrel `packages/types/src/issues/base.ts`).
 */

import type { TIssuePriorities } from "../issues";
import type { TStateGroups } from "../state";
import type { TIssuePublicComment } from "./activity/issue_comment";
import type { TIssueAttachment } from "./issue_attachment";
import type { TIssueLink } from "./issue_link";
import type { TIssueReaction, IIssuePublicReaction, IPublicVote } from "./issue_reaction";
import type { TIssueRelationTypes } from "./issue_relation";

/**
 * Discriminant for the active issue list layout.
 *
 * Drives which renderer is mounted and which layout-specific MobX store
 * flavor (kanban / list / calendar / gantt / spreadsheet) owns the
 * presentation state. Also gates which display-filter affordances are shown
 * (e.g., the "Show empty groups" toggle is kanban-only).
 *
 * Cross-reference: layout-specific MobX stores live at
 * `apps/web/core/store/issue/issue_kanban_view.store.ts`,
 * `issue_calendar_view.store.ts`, and `issue_gantt_view.store.ts`.
 */
export enum EIssueLayoutTypes {
  /** Flat vertical list with optional grouping; the default layout. */
  LIST = "list",
  /** Column-per-group board with drag-and-drop reordering of cards. */
  KANBAN = "kanban",
  /** Month / week grid keyed by `target_date`. */
  CALENDAR = "calendar",
  /** Timeline view keyed by `start_date` and `target_date`. */
  GANTT = "gantt_chart",
  /** Tabular view with one row per issue and one column per property. */
  SPREADSHEET = "spreadsheet",
}

/**
 * Discriminant identifying which backend resource path serves a given issue
 * list — selects between Plane's three sub-APIs (`/issues/`, `/epics/`,
 * `/work-items/`) at REST-client construction time.
 */
export enum EIssueServiceType {
  /** Standard issues endpoint. */
  ISSUES = "issues",
  /** Epics (parent work items) endpoint; epics are issues with `is_epic = true`. */
  EPICS = "epics",
  /** Generalized work-items endpoint used by the unified store flavor. */
  WORK_ITEMS = "work-items",
}

/**
 * Discriminant identifying which MobX store flavor owns a given issue
 * collection.
 *
 * The issue store registry in `apps/web/core/store/issue/` is keyed by this
 * enum so consumers can pick the right slice via hooks of the form
 * `useIssues(EIssuesStoreType.CYCLE)`. Each value corresponds to a distinct
 * scoping of the underlying issue list (workspace-wide, project, cycle,
 * module, etc.).
 */
export enum EIssuesStoreType {
  /** Workspace-wide all-issues store. */
  GLOBAL = "GLOBAL",
  /** Current-user "my issues" store. */
  PROFILE = "PROFILE",
  /** Team-level rollup store. */
  TEAM = "TEAM",
  /** Project-scoped store. */
  PROJECT = "PROJECT",
  /** Cycle-scoped store. */
  CYCLE = "CYCLE",
  /** Module-scoped store. */
  MODULE = "MODULE",
  /** Saved-team-view-scoped store. */
  TEAM_VIEW = "TEAM_VIEW",
  /** Saved-project-view-scoped store. */
  PROJECT_VIEW = "PROJECT_VIEW",
  /** Archived issues store (opts in to the `?archived=true` query). */
  ARCHIVED = "ARCHIVED",
  /** Fallback / unscoped store. */
  DEFAULT = "DEFAULT",
  /** Workspace-level draft issues that have not yet been promoted to a project. */
  WORKSPACE_DRAFT = "WORKSPACE_DRAFT",
  /** Epics-only store. */
  EPIC = "EPIC",
  /** Work items scoped to a team's projects. */
  TEAM_PROJECT_WORK_ITEMS = "TEAM_PROJECT_WORK_ITEMS",
}

/**
 * Minimum-viable issue (work item) payload — the lite shape returned by list
 * endpoints, search results, kanban cards, and any consumer that does not
 * need the rich-text description or embedded relation collections.
 *
 * Mirrors the lite `Issue.objects.values(...)` projection used by list
 * endpoints in `apps/api/plane/app/views/issue/base.py`. The full shape
 * (with description payload and embedded relations) is `TIssue`, which
 * extends this type — see below.
 *
 * Foreign-key fields use `string | null` rather than `string | undefined`
 * to mirror the DRF serializer output (Django nulls survive serialization
 * as JSON `null`, not as a missing key).
 */
export type TBaseIssue = {
  /** Primary key — server-set UUID. */
  id: string;
  /** Per-project monotonic integer; renders as `<project_identifier>-<sequence_id>` (e.g., `"PLN-1234"`). */
  sequence_id: number;
  /** Issue title; required, non-empty. */
  name: string;
  /** Float used for per-state-group ordering in kanban / list — drag-and-drop reorders mutate this. */
  sort_order: number;

  /** FK to `IState`; `null` is allowed for transient draft creation only. */
  state_id: string | null;
  /**
   * One of `"urgent" | "high" | "medium" | "low" | "none"` (see `TIssuePriorities` in `../issues`).
   *
   * - `urgent` — escalate-now category; visually distinguished (red); typically used for blockers and customer-impacting work.
   * - `high` — important; ordering tier 2.
   * - `medium` — default / normal priority.
   * - `low` — nice-to-have; ordering tier 4.
   * - `none` — explicitly unset (distinct from `null`, which means "not yet decided"); ordering tier 5.
   *
   * `null` is allowed for the same transient draft case as `state_id`.
   */
  priority: TIssuePriorities | null;
  /** Array of `ILabel.id`; ordering is not significant. */
  label_ids: string[];
  /** Array of `IUser.id`; ordering is not significant. */
  assignee_ids: string[];
  /** FK to `IEstimate.points[].id`; `null` when no estimate is assigned. */
  estimate_point: string | null;

  /** Count of children where `parent_id = this.id`; server-computed read-only, updated on child create/delete. */
  sub_issues_count: number;
  /** Count of `TIssueAttachment` rows for this issue; server-computed read-only. */
  attachment_count: number;
  /** Count of `TIssueLink` rows for this issue; server-computed read-only. */
  link_count: number;

  /** FK to project; `null` only for workspace-draft issues that have not yet been assigned to a project. */
  project_id: string | null;
  /** Self-FK to the parent issue id; `null` for top-level issues. */
  parent_id: string | null;
  /** FK to active cycle membership; `null` when the issue is not in any cycle. */
  cycle_id: string | null;
  /**
   * FKs to module memberships. `null` (NOT an empty array) signals
   * "membership has never been initialized"; an empty array means
   * "initialized but currently empty". Consumers MUST handle both.
   */
  module_ids: string[] | null;
  /** FK to issue type configuration; `null` means no type set. */
  type_id: string | null;

  /** ISO-8601 UTC string; server-set on create. */
  created_at: string;
  /** ISO-8601 UTC string; server-updated on any field change. */
  updated_at: string;
  /** User-set scheduled start (date-only, ISO-8601); used by Gantt and Calendar layouts. */
  start_date: string | null;
  /** User-set due date (date-only, ISO-8601); the "due date" surfaced in the UI. */
  target_date: string | null;
  /** Server-set when the issue transitions into a completed state group; cleared if it transitions back. */
  completed_at: string | null;
  /**
   * Server-set when the issue is archived; `null` for active issues.
   * Archived issues are excluded from most list endpoints — callers must
   * opt in via `?archived=true` or use `EIssuesStoreType.ARCHIVED`.
   */
  archived_at: string | null;

  /** FK to the creating user. */
  created_by: string;
  /** FK to the user who last modified this issue. */
  updated_by: string;

  /** `true` for issues created via the "Save as draft" flow (not yet promoted to a normal issue). */
  is_draft: boolean;
  /** When `true`, the issue is a top-level epic served from `/epics/` (see `EIssueServiceType.EPICS`). */
  is_epic?: boolean;
  /** When `true`, the issue lives in the project intake queue awaiting triage. */
  is_intake?: boolean;
};

/**
 * Internal shape for the embedded `issue_relation` / `issue_related` arrays
 * on `TIssue` — a lite snapshot of the related issue's identity (id, name,
 * project, sequence id, and the relation type label).
 *
 * Distinct from `TIssueRelation` in `./issue_relation.ts`, which is the
 * full per-anchor relations map; this type is intentionally NOT exported.
 */
type IssueRelation = {
  id: string;
  name: string;
  project_id: string;
  relation_type: TIssueRelationTypes;
  sequence_id: number;
};

/**
 * Full issue entity returned by detail endpoints — extends `TBaseIssue`
 * with the rich-text description payload, embedded relation collections,
 * client-only optimistic-update transients, and the denormalized
 * `state__group` projection.
 *
 * Use this on issue-detail screens, the peek overview, and any place that
 * needs the description body or embedded reactions/attachments/links.
 * Prefer `TBaseIssue` where the lite shape is sufficient.
 */
export type TIssue = TBaseIssue & {
  /**
   * Server-stored sanitized HTML of the issue description. Maintained in
   * lockstep with `description_binary` (Yjs binary form) and
   * `description_stripped` (plain-text projection) on the backend via the
   * live-server callback chain in `apps/live/src/extensions/database.ts`
   * (10-second persistence debounce; see tech spec §5.2.5.4). Plane stores
   * BOTH HTML and binary so non-collaborating clients can read without Yjs.
   * `description_stripped` is intentionally NOT exposed on this type — it
   * lives on `IPublicIssue` and backend serializers only.
   */
  description_html?: string;
  /** `true` when the current authenticated user is subscribed to issue activity notifications; resolved server-side per-request from `IssueSubscriber`. */
  is_subscribed?: boolean;
  /** Embedded snapshot of the parent issue; populated by detail endpoints so the UI can render the parent-issue breadcrumb without a second fetch. */
  parent?: Partial<TBaseIssue>;
  /** Embedded `TIssueReaction` records; populated by issue-detail endpoints only. */
  issue_reactions?: TIssueReaction[];
  /** Embedded `TIssueAttachment` records; populated by issue-detail endpoints only. */
  issue_attachments?: TIssueAttachment[];
  /** Embedded `TIssueLink` records. Singular field name `issue_link` is a server convention — do not rename. */
  issue_link?: TIssueLink[];
  /** Snapshots where THIS issue is the anchor (source) of the relation. */
  issue_relation?: IssueRelation[];
  /** Snapshots where THIS issue is the TARGET of someone else's relation; backend writes both sides in lockstep. */
  issue_related?: IssueRelation[];
  /** Client-generated temporary id used to track optimistic creates before the server assigns the real `id`. NOT a part of the API response payload. */
  // tempId is used for optimistic updates. It is not a part of the API response.
  tempId?: string;
  /** Original issue id when creating a clone via the "Make a copy" flow — used to propagate property values from the source. NOT a part of the API response payload. */
  // sourceIssueId is used to store the original issue id when creating a copy of an issue. Used in cloning property values. It is not a part of the API response.
  sourceIssueId?: string;
  /** Denormalized state group projection (e.g., `"started"`); server includes this so the client can group issues by state group without a state-table join. */
  state__group?: TStateGroups | null;
};

/**
 * Normalized issue store shape — a flat lookup of every loaded `TIssue` by
 * id. Backbone of the MobX issue store: every layout/group/sort projection
 * computes an ordered list of ids and resolves entries against this map.
 */
export type TIssueMap = {
  [issue_id: string]: TIssue;
};

/**
 * Variable-shape `results` field of `TIssuesResponse`.
 *
 * The same API serializes three structurally distinct shapes into this one
 * field depending on the request's grouping parameters:
 *
 * 1. Ungrouped — a flat `TBaseIssue[]`.
 * 2. Grouped — a record keyed by group id, each carrying its own
 *    `results: TBaseIssue[]` and `total_results: number`.
 * 3. Sub-grouped — a record keyed by group id, each carrying a record
 *    keyed by sub-group id with `results` and `total_results`.
 *
 * The union encodes all three shapes so consumers can narrow at runtime
 * based on the request shape; the recursive structure mirrors the
 * `group_by` / `sub_group_by` query-parameter pair.
 */
export type TIssueResponseResults =
  | TBaseIssue[]
  | {
      [key: string]: {
        results:
          | TBaseIssue[]
          | {
              [key: string]: {
                results: TBaseIssue[];
                total_results: number;
              };
            };
        total_results: number;
      };
    };

/**
 * Paginated issue-list response envelope — wraps `TIssueResponseResults`
 * with cursor-pagination metadata and total counts.
 */
export type TIssuesResponse = {
  /** Field name of the active grouping (e.g., `"state_id"`, `"priority"`); empty string when ungrouped. */
  grouped_by: string;
  /** Opaque cursor used to fetch the next page; consumers should treat it as a black box. */
  next_cursor: string;
  /** Opaque cursor used to fetch the previous page. */
  prev_cursor: string;
  /** `true` when more results exist past the current cursor. */
  next_page_results: boolean;
  /** `true` when results exist before the current cursor. */
  prev_page_results: boolean;
  /** Total issue count across all pages of this query. */
  total_count: number;
  /** Issue count on this page. */
  count: number;
  /** Total page count under the current page size. */
  total_pages: number;
  /** Reserved for future aggregations; currently always `null` (the literal type encodes that contract). */
  extra_stats: null;
  /** Page payload — see `TIssueResponseResults` for the three possible shapes. */
  results: TIssueResponseResults;
  /** Sum of `total_results` across every group; mirrors `total_count` for ungrouped responses. */
  total_results: number;
};

/**
 * `Pick<TIssue, ...>` of the fields editable via the bulk-update modal.
 *
 * Listed explicitly (rather than `Partial<TIssue>`) so the type signals the
 * exact field set the bulk-operations endpoint accepts — extending the
 * bulk endpoint requires adding a key here.
 */
export type TBulkIssueProperties = Pick<
  TIssue,
  | "state_id"
  | "priority"
  | "label_ids"
  | "assignee_ids"
  | "start_date"
  | "target_date"
  | "module_ids"
  | "cycle_id"
  | "estimate_point"
>;

/**
 * Request payload for the bulk-update endpoint — the backend applies
 * `properties` to every issue listed in `issue_ids` inside a single
 * transaction.
 */
export type TBulkOperationsPayload = {
  /** Array of issue ids to update. */
  issue_ids: string[];
  /** Partial set of bulk-editable properties to apply; only listed fields are mutated. */
  properties: Partial<TBulkIssueProperties>;
};

/**
 * Optional widgets surfaced on the work-item detail right-sidebar.
 *
 * Each value identifies a collapse-able section that can be shown or
 * hidden by the user. Drives which widget panels are rendered.
 */
export type TWorkItemWidgets =
  /** Sub-issues panel. */
  | "sub-work-items"
  /** Issue relations panel. */
  | "relations"
  /** External links panel. */
  | "links"
  /** File attachments panel. */
  | "attachments";

/**
 * Type-narrowed alias for the three valid `EIssueServiceType` enum values.
 *
 * Functionally identical to the enum union, but lets generic factories
 * accept "any issue-like service" type without an explicit `as
 * EIssueServiceType` cast at call sites.
 */
export type TIssueServiceType = EIssueServiceType.ISSUES | EIssueServiceType.EPICS | EIssueServiceType.WORK_ITEMS;

/**
 * Reduced-field issue shape served on PUBLIC pages (the deploy/space
 * surfaces).
 *
 * Pick-based composition keeps this type a structural subset of `TIssue`:
 * private fields (assignees beyond ids, archived/draft flags, audit
 * `updated_by`, draft / intake markers) are excluded, and public-only
 * embedded collections (`comments`, `reaction_items`, `vote_items`) are
 * added. Served by the deploy/space app's public read endpoints.
 */
export interface IPublicIssue extends Pick<
  TIssue,
  | "description_html"
  | "created_at"
  | "updated_at"
  | "created_by"
  | "id"
  | "name"
  | "priority"
  | "state_id"
  | "project_id"
  | "sequence_id"
  | "sort_order"
  | "start_date"
  | "target_date"
  | "cycle_id"
  | "module_ids"
  | "label_ids"
  | "assignee_ids"
  | "attachment_count"
  | "sub_issues_count"
  | "link_count"
  | "estimate_point"
> {
  /** Embedded public comments authored on this issue. */
  comments: TIssuePublicComment[];
  /** Embedded public reactions (emoji counts and the current viewer's reactions). */
  reaction_items: IIssuePublicReaction[];
  /** Embedded public votes — the thumbs up / thumbs down signal collected on deploy/space pages. */
  vote_items: IPublicVote[];
}

/**
 * Internal mirror of `TIssueResponseResults` parameterized for
 * `IPublicIssue` — used by `TPublicIssuesResponse` to describe the same
 * flat / grouped / sub-grouped shape variants for the public surface.
 *
 * Intentionally NOT exported.
 */
type TPublicIssueResponseResults =
  | IPublicIssue[]
  | {
      [key: string]: {
        results:
          | IPublicIssue[]
          | {
              [key: string]: {
                results: IPublicIssue[];
                total_results: number;
              };
            };
        total_results: number;
      };
    };

/**
 * Paginated public-issue-list response — the deploy/space equivalent of
 * `TIssuesResponse`, parameterized for `IPublicIssue`.
 *
 * Intentionally omits the top-level `total_results` carried by
 * `TIssuesResponse` (the result-shape internals carry their own per-group
 * counts).
 */
export type TPublicIssuesResponse = {
  /** Field name of the active grouping; empty string when ungrouped. */
  grouped_by: string;
  /** Opaque cursor for the next page. */
  next_cursor: string;
  /** Opaque cursor for the previous page. */
  prev_cursor: string;
  /** `true` when more results exist past the current cursor. */
  next_page_results: boolean;
  /** `true` when results exist before the current cursor. */
  prev_page_results: boolean;
  /** Total issue count across all pages. */
  total_count: number;
  /** Issue count on this page. */
  count: number;
  /** Total page count under the current page size. */
  total_pages: number;
  /** Reserved for future aggregations; always `null`. */
  extra_stats: null;
  /** Page payload — see `TPublicIssueResponseResults` for the three possible shapes. */
  results: TPublicIssueResponseResults;
};

/**
 * Configuration props for the work-item peek overview modal — controls
 * embedding behavior and notification-side-effect callbacks.
 */
export interface IWorkItemPeekOverview {
  /** When `true`, the peek overview renders embedded inside the parent surface (vs. as a standalone modal). */
  embedIssue?: boolean;
  /** Callback fired when the peek overview is opened from a notification toast; consumer typically dismisses the toast. */
  embedRemoveCurrentNotification?: () => void;
  /** `true` when the peeked issue is a draft (affects available actions and surface routing). */
  is_draft?: boolean;
  /** Which issue store flavor owns this peek's data — required so mutations are routed to the right slice. */
  storeType?: EIssuesStoreType;
}
