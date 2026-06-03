/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level issue type aggregator for the `@plane/types` package.
 *
 * This module hosts the supplementary issue types that did not migrate into the
 * deeper `./issues/` sub-folder (which owns `TIssue`, attachments, links,
 * relations, reactions, sub-issues, identifier). Specifically, this file
 * provides:
 * - Issue-to-cycle and issue-to-module join relations (`IIssueCycle`, `IIssueModule`)
 * - External resource link metadata (`ILinkDetails`)
 * - Sub-issues listing response envelope (`ISubIssueResponse`)
 * - Project-scoped label types (`IIssueLabel`, `IIssueLabelTree`)
 * - Issue activity feed row (`IIssueActivity`)
 * - The shared priority union (`TIssuePriorities`)
 * - Layout-level descriptors used by the kanban/list/spreadsheet/calendar/gantt
 *   roots in `apps/web/core/components/issues/issue-layouts/` (`ViewFlags`,
 *   `GroupByColumnTypes`, `TGetColumns`, `IGroupByColumn`, `IIssueMap`,
 *   `ILayoutDisplayFiltersOptions`)
 *
 * Consumed broadly by the issue services, MobX stores under
 * `apps/web/core/store/issue/`, and components under
 * `apps/web/core/components/issues/`.
 */

import type { ICycle } from "./cycle";
import type { TIssue } from "./issues/issue";
import type { IModule } from "./module";
import type { IProjectLite } from "./project";
import type { TStateGroups } from "./state";
import type { IUserLite } from "./users";
import type {
  IIssueDisplayProperties,
  TIssueExtraOptions,
  TIssueGroupByOptions,
  TIssueGroupingFilters,
  TIssueOrderByOptions,
} from "./view-props";
import type { IWorkspaceLite } from "./workspace";

/**
 * Join row that records the membership of an issue inside a cycle.
 *
 * Mirrors `apps/api/plane/db/models/cycle.py::CycleIssue`. The `cycle_detail`
 * field is a hydrated `ICycle` projection so that lists of issue-cycle rows can
 * be rendered without an extra fetch.
 */
export interface IIssueCycle {
  id: string;
  cycle_detail: ICycle;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  project: string;
  workspace: string;
  issue: string;
  cycle: string;
}

/**
 * Join row that records the membership of an issue inside a module.
 *
 * Mirrors `apps/api/plane/db/models/module.py::ModuleIssue`. The `module_detail`
 * field is a hydrated `IModule` projection so that lists of issue-module rows
 * can be rendered without an extra fetch.
 */
export interface IIssueModule {
  created_at: Date;
  created_by: string;
  id: string;
  issue: string;
  module: string;
  module_detail: IModule;
  project: string;
  updated_at: Date;
  updated_by: string;
  workspace: string;
}

/**
 * External resource link attached to an issue or module.
 *
 * Field with non-obvious semantics:
 * - `metadata`: free-form JSON (typed `any`) used to stash provider-specific
 *   data such as preview thumbnails or oEmbed payloads.
 */
export interface ILinkDetails {
  created_at: Date;
  created_by: string;
  id: string;
  metadata: any;
  title: string;
  url: string;
}

/**
 * Response envelope for the sub-issues listing endpoint.
 *
 * Fields:
 * - `state_distribution`: count of sub-issues per `TStateGroups` bucket
 *   (`backlog` | `unstarted` | `started` | `completed` | `cancelled`), used by
 *   the sub-issues progress bar.
 * - `sub_issues`: full sub-issue list (the parent issue is fetched separately).
 */
export interface ISubIssueResponse {
  state_distribution: Record<TStateGroups, number>;
  sub_issues: TIssue[];
}

/**
 * Project-scoped issue label.
 *
 * Fields with non-obvious semantics:
 * - `parent`: parent label id (labels form a tree); null at the root.
 * - `color`: hex string used as the label chip background in the UI.
 * - `sort_order`: ordering position within the project's label list.
 */
export interface IIssueLabel {
  id: string;
  name: string;
  color: string;
  project_id: string;
  workspace_id: string;
  parent: string | null;
  sort_order: number;
}

/**
 * Tree-shaped projection of `IIssueLabel` for hierarchical rendering.
 *
 * Adds a `children` array of nested labels; otherwise identical to
 * `IIssueLabel`. `children` is `undefined` for leaf labels (rather than an
 * empty array) so callers can distinguish "not yet expanded" from "no
 * children".
 */
export interface IIssueLabelTree extends IIssueLabel {
  children: IIssueLabel[] | undefined;
}

/**
 * Single activity row in an issue's history feed.
 *
 * Fields with non-obvious semantics:
 * - `verb`: action discriminator (`"created"` | `"updated"` | `"deleted"`); the
 *   activity renderers in
 *   `apps/web/core/components/issues/issue-detail/issue-activity/activity/actions/`
 *   switch on this value.
 * - `field`: name of the field that changed; null for non-field activities
 *   (e.g., comment created/deleted entries) — renderers branch on
 *   `!activity?.field` for that case.
 * - `old_value` / `new_value`: human-readable change strings; `null` when the
 *   activity does not represent a value transition.
 * - `old_identifier` / `new_identifier`: opaque foreign-key ids for changes
 *   that involve a related entity (state, assignee, label, etc.).
 * - `issue_detail`: hydrated issue projection — present on cross-issue feeds
 *   (workspace activity) so that rows can be rendered without an extra fetch.
 * - `attachments`: only populated on attachment-related activity rows.
 * - `comment` / `comment_html` / `comment_stripped`: parallel content forms
 *   (plain text / rich HTML / plain text stripped of HTML) populated together
 *   when the row represents a comment-type activity.
 * - `access`: comment visibility — `"INTERNAL"` hides the row from public
 *   deploy boards / intake forms; mirrors `EIssueCommentAccessSpecifier`.
 * - `actor_detail`: hydrated actor identity for display.
 * - `issue_comment`: linked comment id for comment-related rows.
 */
export interface IIssueActivity {
  access?: "EXTERNAL" | "INTERNAL";
  actor: string;
  actor_detail: IUserLite;
  attachments: any[];
  comment?: string;
  comment_html?: string;
  comment_stripped?: string;
  created_at: Date;
  created_by: string;
  field: string | null;
  id: string;
  issue: string | null;
  issue_comment?: string | null;
  issue_detail: {
    description_html: string;
    id: string;
    name: string;
    priority: string | null;
    sequence_id: string;
    type_id: string;
  } | null;
  new_identifier: string | null;
  new_value: string | null;
  old_identifier: string | null;
  old_value: string | null;
  project: string;
  project_detail: IProjectLite;
  updated_at: Date;
  updated_by: string;
  verb: string;
  workspace: string;
  workspace_detail?: IWorkspaceLite;
}

/**
 * Allowed issue priority discriminants used by priority pickers, filters,
 * and grouping logic. `"none"` is the sentinel for unprioritized issues.
 */
export type TIssuePriorities = "urgent" | "high" | "medium" | "low" | "none";

/**
 * Per-layout feature flags read by the issue layout roots (kanban, list,
 * spreadsheet, calendar, gantt) to enable or suppress UI affordances.
 *
 * Each flag is independently toggled per store/context so, for example,
 * archived issue views can suppress quick-add while still allowing inline edit.
 */
export interface ViewFlags {
  enableQuickAdd: boolean;
  enableIssueCreation: boolean;
  enableInlineEditing: boolean;
}

/**
 * Allowed group-by axes for the issue layout roots.
 *
 * `"state_detail.group"` groups by the parent state group (backlog / unstarted
 * / started / completed / cancelled) rather than by individual state; this is
 * the distinction enforced by
 * `apps/web/core/components/issues/issue-layouts/`.
 */
export type GroupByColumnTypes =
  | "project"
  | "cycle"
  | "module"
  | "state"
  | "state_detail.group"
  | "priority"
  | "labels"
  | "assignees"
  | "created_by"
  | "team_project";

/**
 * Parameters passed to the per-layout column resolver.
 *
 * `isWorkspaceLevel` is set when the layout is rendering workspace-scoped
 * issues (no single project context), which causes the resolver to skip
 * project-scoped columns. `projectId` is supplied for project-scoped layouts
 * to filter columns to that project's members, states, labels, etc.
 */
export type TGetColumns = {
  isWorkspaceLevel?: boolean;
  projectId?: string;
};

/**
 * Rendered column descriptor produced by the per-layout column resolver.
 *
 * Fields with non-obvious semantics:
 * - `icon`: optional React element rendered in the column header (e.g., a
 *   state icon or assignee avatar).
 * - `payload`: partial `TIssue` patch applied when an issue is dropped into
 *   this column (e.g., `{ state_id: "..." }` for a state column).
 * - `isDropDisabled` / `dropErrorMessage`: control DnD behavior and the
 *   tooltip surfaced when a drop is rejected.
 */
export interface IGroupByColumn {
  id: string;
  name: string;
  icon?: React.ReactElement | undefined;
  payload: Partial<TIssue>;
  isDropDisabled?: boolean;
  dropErrorMessage?: string;
}

/**
 * Id-keyed lookup table for `TIssue` records.
 *
 * Used by the kanban/list/spreadsheet layouts to avoid passing full issue
 * objects through deeply nested component trees — callers pass ids plus this
 * map and dereference on render.
 */
export interface IIssueMap {
  [key: string]: TIssue;
}

/**
 * Per-layout display capability descriptor.
 *
 * Used by the display-filters panel
 * (`apps/web/core/components/issues/issue-layouts/filters/header/display-filters/`)
 * to surface only the toggles that the active layout actually supports.
 *
 * Fields:
 * - `display_properties`: which `IIssueDisplayProperties` toggles to render.
 * - `display_filters.group_by` / `sub_group_by` / `order_by` / `type`: which
 *   options to expose in each filter selector for this layout.
 * - `extra_options.access` / `values`: layout-specific extra toggles (e.g.,
 *   show empty groups, show sub-issues).
 */
export interface ILayoutDisplayFiltersOptions {
  display_properties: (keyof IIssueDisplayProperties)[];
  display_filters: {
    group_by?: TIssueGroupByOptions[];
    sub_group_by?: TIssueGroupByOptions[];
    order_by?: TIssueOrderByOptions[];
    type?: TIssueGroupingFilters[];
  };
  extra_options: {
    access: boolean;
    values: TIssueExtraOptions[];
  };
}
