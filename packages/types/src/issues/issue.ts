/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical issue (work item) entity contracts (`TBaseIssue`, `TIssue`, `IPublicIssue`) plus layout/service/store discriminants and list-response envelopes, mirroring `apps/api/plane/db/models/issue.py::Issue` and `apps/api/plane/app/serializers/issue.py::IssueSerializer`.
 * Re-exported via `./base.ts`; consumed across `apps/web/core/store/issue/**`, `apps/web/core/components/issues/**`, and `packages/services/src/issue/`.
 */

import type { TIssuePriorities } from "../issues";
import type { TStateGroups } from "../state";
import type { TIssuePublicComment } from "./activity/issue_comment";
import type { TIssueAttachment } from "./issue_attachment";
import type { TIssueLink } from "./issue_link";
import type { TIssueReaction, IIssuePublicReaction, IPublicVote } from "./issue_reaction";
import type { TIssueRelationTypes } from "./issue_relation";

/**
 * Active issue list layout discriminant — selects the renderer and the layout-specific MobX store flavor in `apps/web/core/store/issue/issue_{kanban,calendar,gantt}_view.store.ts`, and gates layout-only display-filter affordances.
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
 * Discriminant keying the issue-store registry in `apps/web/core/store/issue/` so consumers select the right scoped slice via `useIssues(EIssuesStoreType.<scope>)` (workspace, project, cycle, module, draft, archived, etc.).
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
 * Lite issue payload returned by list endpoints / search / kanban cards (no description body or embedded relations); the full shape is `TIssue` below.
 * FK fields use `string | null` because Django nulls survive DRF serialization as JSON `null`, not as a missing key.
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
   * One of `TIssuePriorities` (`urgent | high | medium | low | none`); `none` is explicitly unset whereas `null` is "not yet decided" during transient draft creation only.
   */
  priority: TIssuePriorities | null;
  /** Array of `ILabel.id`; ordering is not significant. */
  label_ids: string[];
  /**
   * UUID strings of assigned users as serialized by `IssueSerializer.assignee_ids` / `IssueListDetailSerializer.get_assignee_ids` (`apps/api/plane/app/serializers/issue.py`); resolved to user objects on demand by the MobX issue/member stores under `apps/web/core/store/`.
   */
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
   * FKs to module memberships; `null` means "never initialized" while an empty array means "initialized but currently empty" — consumers MUST distinguish the two.
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
   * Server-set on archive; archived issues are excluded from most list endpoints unless callers opt in via `?archived=true` or use `EIssuesStoreType.ARCHIVED`.
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
 * Lite snapshot embedded inside `TIssue.issue_relation` / `.issue_related`; distinct from the per-anchor `TIssueRelation` map in `./issue_relation.ts` and intentionally not exported.
 */
type IssueRelation = {
  id: string;
  name: string;
  project_id: string;
  relation_type: TIssueRelationTypes;
  sequence_id: number;
};

/**
 * Full issue entity from detail endpoints — extends `TBaseIssue` with the description payload, embedded relation collections, client-only optimistic transients, and the denormalized `state__group` projection (prefer `TBaseIssue` where the lite shape is sufficient).
 */
export type TIssue = TBaseIssue & {
  /**
   * Server-stored sanitized HTML of the issue description; kept in lockstep with backend `description_binary` (Yjs) and `description_stripped` (plain-text) via the live-server callback chain in `apps/live/src/extensions/database.ts` (10-second debounce; tech spec §5.2.5.4).
   * `description_stripped` is intentionally not declared on `TIssue` nor on `IPublicIssue` below — it lives only on backend models/serializers.
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
  /** Client-generated id for optimistic creates before the server assigns the real `id`; client-only, not present on API responses. */
  // tempId is used for optimistic updates. It is not a part of the API response.
  tempId?: string;
  /** Source issue id when creating a clone via "Make a copy"; client-only, not present on API responses. */
  // sourceIssueId is used to store the original issue id when creating a copy of an issue. Used in cloning property values. It is not a part of the API response.
  sourceIssueId?: string;
  /** Denormalized state group projection (e.g., `"started"`); server includes this so the client can group issues by state group without a state-table join. */
  state__group?: TStateGroups | null;
};

/**
 * Flat `TIssue`-by-id lookup that backs the MobX issue store; every layout/group/sort projection resolves ordered id arrays against this map.
 */
export type TIssueMap = {
  [issue_id: string]: TIssue;
};

/**
 * Variable-shape `results` field of `TIssuesResponse`: a flat `TBaseIssue[]` when ungrouped, a one-level record when grouped, or a two-level record when sub-grouped — the union mirrors the `group_by` / `sub_group_by` query parameters.
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
 * `Pick<TIssue, ...>` of the fields the bulk-update endpoint accepts; listed explicitly (not `Partial<TIssue>`) so extending the endpoint requires extending this key set.
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
 * Collapse-able right-sidebar widgets on the work-item detail view (sub-issues, relations, links, attachments).
 */
export type TWorkItemWidgets = "sub-work-items" | "relations" | "links" | "attachments";

/**
 * Type-narrowed alias of the three valid `EIssueServiceType` enum values, used so generic factories accept any issue-like service without an explicit `as EIssueServiceType` cast.
 */
export type TIssueServiceType = EIssueServiceType.ISSUES | EIssueServiceType.EPICS | EIssueServiceType.WORK_ITEMS;

/**
 * Public-pages (deploy/space) issue shape — a structural `Pick<TIssue, ...>` subset that drops private fields (draft/intake/archive markers, audit `updated_by`) and adds public-only embedded collections (`comments`, `reaction_items`, `vote_items`).
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
