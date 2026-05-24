/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue layout view-property contracts for the `@plane/types` package.
 *
 * Models the filter / sort / group / sub-group / display-property selections that drive
 * every issue list, board, calendar, gantt, and spreadsheet view in `apps/web`. These
 * types are the canonical state slice consumed by `apps/web/core/store/issue/*`'s
 * filter stores (project, workspace, cycle, module, workspace-draft, issue-details
 * sub-issue, etc.) and persisted on saved views (`IProjectView`, `IWorkspaceView`),
 * cycles, modules, and per-user project/workspace property preferences.
 *
 * Mutual contract with `./views.ts`: this module defines the filter / sort / display-
 * property contracts (`IIssueDisplayFilterOptions`, `IIssueDisplayProperties`,
 * `IIssueFilterOptions`, `TWorkItemFilterExpression`); `views.ts` imports and composes
 * those contracts inside the `IProjectView` saved-view persistence shape. Live issue
 * layouts read these same contracts directly without going through `views.ts`.
 *
 * Most filter and display-filter shapes also have an API/wire counterpart
 * (`IWorkspaceViewIssuesParams`, `IIssueFiltersResponse`) — array members are joined
 * into comma-separated strings at the API boundary.
 */

import type { IProjectMemberNavigationPreferences } from "./project";
import type { TIssue } from "./issues/issue";
import type { LOGICAL_OPERATOR, TSupportedOperators } from "./rich-filters";
import type { CompleteOrEmpty } from "./utils";

/**
 * Render layout for an issue view (list / board / calendar / spreadsheet / gantt).
 *
 * Union values:
 * - `list`: stacked rows grouped by `group_by`
 * - `kanban`: column-per-group board (uses `TIssueKanbanFilters` for collapsed-group state)
 * - `calendar`: month/week grid (sub-mode in `IIssueDisplayFilterOptions.calendar.layout`)
 * - `spreadsheet`: tabular layout with `IIssueDisplayProperties` controlling columns
 * - `gantt_chart`: timeline view driven by `start_date` / `target_date`
 */
export type TIssueLayouts = "list" | "kanban" | "calendar" | "spreadsheet" | "gantt_chart";

/**
 * Group-by axis for an issue layout — selects which field groups rows/columns/cards.
 *
 * Union values:
 * - `state`: group by specific workflow state (e.g. "In Progress")
 * - `state_detail.group`: group by lifecycle state group (`TStateGroups`: backlog / unstarted / started / completed / cancelled)
 * - `priority`: group by `urgent | high | medium | low | none`
 * - `cycle` | `module`: group by associated cycle / module (issues without one fall into "None")
 * - `labels`: group by label (multi-valued — an issue can appear in multiple label groups)
 * - `assignees`: group by assignee (multi-valued)
 * - `created_by`: group by issue creator
 * - `target_date`: group by due-date buckets
 * - `project`: only meaningful in workspace-aggregated / saved-view layouts
 * - `team_project`: team-scoped project grouping (separate from `project`)
 * - `null`: no grouping (flat list)
 */
export type TIssueGroupByOptions =
  | "state"
  | "priority"
  | "labels"
  | "created_by"
  | "state_detail.group"
  | "project"
  | "assignees"
  | "cycle"
  | "module"
  | "target_date"
  | "team_project"
  | null;

/**
 * Sort axis for an issue layout — prefix `-` indicates descending order (Django ORM convention).
 *
 * Values map directly to the `order_by` query parameter that the backend passes to
 * Django ORM's `.order_by()`. Double-underscore (`__`) segments are ORM joins
 * (e.g. `state__name` joins through the `state` FK and sorts by its `name` column).
 *
 * Notable values:
 * - `sort_order`: manual user-defined drag-and-drop ordering (used by kanban/list)
 * - `priority` / `-priority`: priority bucket order is non-alphabetic — handled by an annotation on the backend
 * - `estimate_point__key`: sorts by the estimate point's key, not its value
 * - `link_count` / `attachment_count` / `sub_issues_count`: backend annotations (aggregates)
 */
export type TIssueOrderByOptions =
  | "-created_at"
  | "created_at"
  | "updated_at"
  | "-updated_at"
  | "priority"
  | "-priority"
  | "sort_order"
  | "state__name"
  | "-state__name"
  | "assignees__first_name"
  | "-assignees__first_name"
  | "labels__name"
  | "-labels__name"
  | "issue_module__module__name"
  | "-issue_module__module__name"
  | "issue_cycle__cycle__name"
  | "-issue_cycle__cycle__name"
  | "target_date"
  | "-target_date"
  | "estimate_point__key"
  | "-estimate_point__key"
  | "start_date"
  | "-start_date"
  | "link_count"
  | "-link_count"
  | "attachment_count"
  | "-attachment_count"
  | "sub_issues_count"
  | "-sub_issues_count";

/**
 * Top-level lifecycle-slice filter (which issue subset to render).
 *
 * Union values:
 * - `active`: issues in non-completed, non-cancelled state groups
 * - `backlog`: issues in the backlog state group only
 *
 * Absence of a value (i.e. `undefined` on the consuming display-filter field) means
 * "all issues, no lifecycle restriction" — there is no `"all"` literal.
 */
export type TIssueGroupingFilters = "active" | "backlog";

/**
 * Extra inclusion toggles applied on top of the main filter expression.
 *
 * Union values:
 * - `sub_issue`: include sub-issues as siblings of parents (default: nested under parent)
 * - `show_empty_groups`: render groups with zero issues (default: hide)
 */
export type TIssueExtraOptions = "show_empty_groups" | "sub_issue";

/**
 * Canonical set of issue list query-string parameter names recognised by the issues API.
 *
 * Used as a discriminating key when serialising in-memory `IIssueFilterOptions` /
 * `IIssueDisplayFilterOptions` into a flat wire payload. The set is a superset of all
 * filter/display/pagination keys — not every key is sent on every request.
 */
export type TIssueParams =
  | "priority"
  | "state_group"
  | "state"
  | "assignees"
  | "mentions"
  | "created_by"
  | "subscriber"
  | "labels"
  | "cycle"
  | "module"
  | "start_date"
  | "target_date"
  | "project"
  | "team_project"
  | "group_by"
  | "sub_group_by"
  | "order_by"
  | "type"
  | "sub_issue"
  | "show_empty_groups"
  | "cursor"
  | "per_page"
  | "issue_type"
  | "layout"
  | "expand"
  | "filters";

/**
 * Calendar layout sub-modes — month grid vs. weekly row.
 *
 * Consumed by `IIssueDisplayFilterOptions.calendar.layout` and only meaningful when
 * the outer `layout` is `"calendar"`.
 */
export type TCalendarLayouts = "month" | "week";

/**
 * Field keys accepted by the rich-filter expression engine (`TWorkItemFilterExpression`).
 *
 * Each entry corresponds to a column on the `Issue` model (or a related FK) that can be
 * referenced as the left-hand side of a filter condition. `*_id` suffixes denote the
 * FK column rather than the joined model's name (e.g. `assignee_id` not `assignees`).
 * The `as const` assertion preserves literal types so `TWorkItemFilterProperty` indexes
 * exactly this tuple.
 */
export const WORK_ITEM_FILTER_PROPERTY_KEYS = [
  "state_group",
  "priority",
  "start_date",
  "target_date",
  "assignee_id",
  "mention_id",
  "created_by_id",
  "subscriber_id",
  "label_id",
  "state_id",
  "cycle_id",
  "module_id",
  "project_id",
  "created_at",
  "updated_at",
] as const;

/**
 * Union of all valid left-hand-side field keys for a rich-filter condition.
 *
 * Derived from `WORK_ITEM_FILTER_PROPERTY_KEYS` so adding/removing a key in that tuple
 * automatically updates this type.
 */
export type TWorkItemFilterProperty = (typeof WORK_ITEM_FILTER_PROPERTY_KEYS)[number];

/**
 * Composite key for a single rich-filter condition — `<property>__<operator>`.
 *
 * Format mirrors Django ORM lookup syntax (e.g. `priority__exact`, `created_at__gte`)
 * so the backend can dispatch directly on the key without re-parsing.
 */
export type TWorkItemFilterConditionKey = `${TWorkItemFilterProperty}__${TSupportedOperators}`;

/**
 * Partial record from condition keys (`<property>__<operator>`) to scalar values.
 *
 * `Partial` allows each condition key to be omitted — a populated condition data
 * object will typically contain exactly one entry per filter row. Multiple entries
 * inside the same object are AND'd (same as conditions inside an `AND` group).
 */
export type TWorkItemFilterConditionData = Partial<{
  [K in TWorkItemFilterConditionKey]: string | boolean | number;
}>;

/**
 * Logical-AND grouping of rich-filter conditions — every condition in the array must match.
 *
 * Keyed by `LOGICAL_OPERATOR.AND` from `./rich-filters` so the discriminant is the
 * key itself, not a tagged field.
 */
export type TWorkItemFilterAndGroup = {
  [LOGICAL_OPERATOR.AND]: TWorkItemFilterConditionData[];
};

/**
 * Rich-filter group node — currently only `AND` is supported; `OR` may be added later.
 */
export type TWorkItemFilterGroup = TWorkItemFilterAndGroup;

/**
 * Union of a leaf condition object or a group node, forming the recursive filter AST.
 */
export type TWorkItemFilterExpressionData = TWorkItemFilterConditionData | TWorkItemFilterGroup;

/**
 * Root rich-filter expression — either a fully-populated `TWorkItemFilterExpressionData`
 * or an empty object literal `{}` (no filter applied).
 *
 * `CompleteOrEmpty` from `./utils` enforces "all keys or no keys" at compile time,
 * preventing partial filter expressions from being silently dispatched.
 */
export type TWorkItemFilterExpression = CompleteOrEmpty<TWorkItemFilterExpressionData>;

/**
 * Legacy issue-filter selections — one nullable array per filter dimension.
 *
 * Conditions across keys are AND'd; values inside a single key's array are OR'd
 * (e.g. `priority: ["urgent", "high"]` matches urgent OR high). A `null` or omitted
 * key means "no constraint on that dimension".
 *
 * The newer rich-filter system (`TWorkItemFilterExpression`) is gradually replacing
 * this shape, but it is still persisted on `IPublishedProjectView.filters` and
 * referenced as the `query`/`query_data` payload on saved project views.
 *
 * Fields with non-obvious semantics:
 * - `state_group`: lifecycle group (`TStateGroups`: backlog/unstarted/started/completed/cancelled), not specific state
 * - `start_date` / `target_date`: ISO date strings (`YYYY-MM-DD`) or relative offsets the backend parses
 * - `mentions`: include only issues @-mentioning these user IDs (separate from `assignees`)
 * - `team_project`: team-scoped project filter (separate dimension from `project`)
 * - `subscriber`: include only issues the listed users are subscribed to
 * - `issue_type`: filter by `IssueType` UUIDs (a project-defined type taxonomy)
 */
export interface IIssueFilterOptions {
  assignees?: string[] | null;
  mentions?: string[] | null;
  created_by?: string[] | null;
  labels?: string[] | null;
  priority?: string[] | null;
  cycle?: string[] | null;
  module?: string[] | null;
  project?: string[] | null;
  team_project?: string[] | null;
  start_date?: string[] | null;
  state?: string[] | null;
  state_group?: string[] | null;
  subscriber?: string[] | null;
  target_date?: string[] | null;
  issue_type?: string[] | null;
}

/**
 * Display-layer settings — controls grouping, ordering, layout, and visibility toggles.
 *
 * Distinct from `IIssueFilterOptions` (which narrows the issue set): these settings
 * govern *how* the resulting issues are arranged and rendered. Persisted alongside
 * filters on saved views, cycles, modules, and per-user project preferences.
 *
 * Fields with non-obvious semantics:
 * - `calendar.layout`: `month` / `week` sub-mode — only meaningful when `layout === "calendar"`
 * - `calendar.show_weekends`: include Saturday/Sunday columns in calendar grid
 * - `group_by` / `sub_group_by`: grouping axes (`TIssueGroupByOptions`) — `sub_group_by` only applies to certain layouts
 * - `order_by`: sort axis (`TIssueOrderByOptions`) — `-` prefix is descending
 * - `layout`: render layout — typed as `any` pending migration to the `EIssueLayoutTypes` enum
 * - `show_empty_groups`: render groups with zero matches (default: hide)
 * - `sub_issue`: include sub-issues as siblings of their parent (default: nested)
 */
export interface IIssueDisplayFilterOptions {
  calendar?: {
    show_weekends?: boolean;
    layout?: TCalendarLayouts;
  };
  group_by?: TIssueGroupByOptions;
  sub_group_by?: TIssueGroupByOptions;
  layout?: any; // TODO: Need to fix this and set it to enum EIssueLayoutTypes
  order_by?: TIssueOrderByOptions;
  show_empty_groups?: boolean;
  sub_issue?: boolean;
}
/**
 * Column-visibility toggles for issue layouts — each boolean shows/hides the named field.
 *
 * Applied per-user (persisted on `IProjectUserPropertiesResponse.display_properties`)
 * and per-view (persisted on `IProjectView.display_properties` /
 * `IWorkspaceView.display_properties`). Missing keys default to "shown".
 *
 * `sub_issue_count` / `attachment_count` are aggregate counts annotated on the server;
 * `link` toggles the URL-links column (a count, not the links themselves).
 */
export interface IIssueDisplayProperties {
  assignee?: boolean;
  start_date?: boolean;
  due_date?: boolean;
  labels?: boolean;
  key?: boolean;
  priority?: boolean;
  state?: boolean;
  sub_issue_count?: boolean;
  link?: boolean;
  attachment_count?: boolean;
  estimate?: boolean;
  created_on?: boolean;
  updated_on?: boolean;
  modules?: boolean;
  cycle?: boolean;
  issue_type?: boolean;
}

/**
 * Kanban-layout local UI state — IDs of collapsed groups along each axis.
 *
 * Not part of the saved view payload; held in-memory in the kanban store so collapse
 * state survives layout switches within a session. Group IDs are the same strings
 * used by `group_by` / `sub_group_by` consumers (e.g. state ID, priority literal).
 */
export type TIssueKanbanFilters = {
  group_by: string[];
  sub_group_by: string[];
};

/**
 * Composite filter state stored per layout — splits filters from display state.
 *
 * The canonical in-memory representation maintained by `IBaseIssueFilterStore`
 * implementations in `apps/web/core/store/issue/*`. Each field is independently
 * mutable so partial updates (e.g. toggling a single display property) don't
 * require rebuilding the full filter expression.
 *
 * Fields:
 * - `richFilters`: rich-filter AST (`TWorkItemFilterExpression`) — narrows the issue set
 * - `displayFilters`: layout / grouping / sort settings
 * - `displayProperties`: column-visibility toggles
 * - `kanbanFilters`: kanban-layout-only collapsed-group tracking
 */
export interface IIssueFilters {
  richFilters: TWorkItemFilterExpression;
  displayFilters: IIssueDisplayFilterOptions | undefined;
  displayProperties: IIssueDisplayProperties | undefined;
  kanbanFilters: TIssueKanbanFilters | undefined;
}

/**
 * Discriminated input type accepted by partial-update setters on the filter stores.
 *
 * A single setter accepts any of the three updateable slices and dispatches to the
 * matching merge logic (`displayFilters`, `displayProperties`, or `kanbanFilters`).
 * `richFilters` is updated through a dedicated path because its shape is recursive.
 */
export type TSupportedFilterForUpdate = IIssueDisplayFilterOptions | IIssueDisplayProperties | TIssueKanbanFilters;

/**
 * Sub-issue filter state — same as `IIssueFilters` but uses the legacy filter shape.
 *
 * Sub-issues lists rendered inside the issue-detail peek-overview / detail page
 * predate the rich-filter migration and continue to use `IIssueFilterOptions`.
 * `Omit<IIssueFilters, "richFilters">` drops the unused rich AST while preserving
 * all three display-related slices.
 */
export interface ISubWorkItemFilters extends Omit<IIssueFilters, "richFilters"> {
  filters: IIssueFilterOptions;
}

/**
 * Wire shape of the per-user filter preferences GET endpoint response.
 *
 * Field names use snake_case to mirror the Django serializer output. Consumed by
 * the project/workspace user-properties stores to seed in-memory `IIssueFilters`
 * on app boot.
 */
export interface IIssueFiltersResponse {
  rich_filters: TWorkItemFilterExpression;
  display_filters: IIssueDisplayFilterOptions;
  display_properties: IIssueDisplayProperties;
}

/**
 * Project-scoped user preferences payload returned by the project user-properties endpoint.
 *
 * Extends the base filter response with project-only extras:
 * - `sort_order`: user-chosen ordinal position of the project in the workspace sidebar
 * - `preferences.pages.block_display`: pages-explorer block-vs-tree rendering toggle
 * - `preferences.navigation`: project-sidebar collapse/expand state (`IProjectMemberNavigationPreferences`)
 */
export interface IProjectUserPropertiesResponse extends IIssueFiltersResponse {
  sort_order: number;
  preferences: {
    pages: {
      block_display: boolean;
    };
    navigation: IProjectMemberNavigationPreferences;
  };
}

/**
 * Workspace-scoped user preferences payload returned by the workspace user-properties endpoint.
 *
 * Adds workspace-sidebar navigation preferences on top of the base filter response.
 * Field semantics:
 * - `navigation_project_limit`: maximum number of projects shown in the workspace
 *   sidebar before truncation; `0` (or undefined) means "show all"
 * - `navigation_control_preference`: how grouped navigation sections render —
 *   `ACCORDION` (one section open at a time) vs. `TABBED` (independent toggles)
 */
export interface IWorkspaceUserPropertiesResponse extends IIssueFiltersResponse {
  navigation_project_limit?: number;
  navigation_control_preference?: "ACCORDION" | "TABBED";
  // Note: show_limited_projects is derived from navigation_project_limit (0 = false, >0 = true)
}

/**
 * Workspace-scoped variant of `IIssueFilterOptions` — applies across all projects in the workspace.
 *
 * Adds `project` (narrow to a subset of workspace projects) and `subscriber` (issues the
 * user is subscribed to). Drops project-scoped dimensions that don't aggregate
 * meaningfully across projects (e.g. cycle, module, mentions, team_project, issue_type,
 * specific state). Used by the workspace global views (`all-issues`, `assigned`,
 * `created`, `subscribed`) and saved workspace views.
 */
export interface IWorkspaceIssueFilterOptions {
  assignees?: string[] | null;
  created_by?: string[] | null;
  labels?: string[] | null;
  priority?: string[] | null;
  state_group?: string[] | null;
  subscriber?: string[] | null;
  start_date?: string[] | null;
  target_date?: string[] | null;
  project?: string[] | null;
}

/**
 * Wire-format query parameters for the workspace issues listing endpoint.
 *
 * Flattens `IWorkspaceIssueFilterOptions` arrays into comma-joined strings
 * (e.g. `priority=high,urgent`) since the API consumes URL query strings, not arrays.
 * `sub_issue` is the one boolean — the rest are strings or `undefined` (omit the
 * parameter entirely rather than send an empty value).
 */
export interface IWorkspaceViewIssuesParams {
  assignees?: string | undefined;
  created_by?: string | undefined;
  labels?: string | undefined;
  priority?: string | undefined;
  start_date?: string | undefined;
  state?: string | undefined;
  state_group?: string | undefined;
  subscriber?: string | undefined;
  target_date?: string | undefined;
  project?: string | undefined;
  order_by?: string | undefined;
  sub_issue?: boolean;
}

/**
 * Project-scoped saved-view payload — the persisted shape on `IProjectView.query_data`.
 *
 * Contains only the rich filter expression and display filters; column-visibility
 * (`display_properties`) is stored separately on the parent `IProjectView` so it can
 * be edited without writing the whole view document.
 */
export interface IProjectViewProps {
  rich_filters: TWorkItemFilterExpression;
  display_filters: IIssueDisplayFilterOptions | undefined;
}

/**
 * Workspace-scoped saved-view payload — the persisted shape on `IWorkspaceView.query_data`.
 *
 * Differs from `IProjectViewProps` by embedding `display_properties` directly because
 * workspace views are workspace-global (not editable per-project) and therefore have
 * no per-project property store to defer to.
 */
export interface IWorkspaceViewProps {
  rich_filters: TWorkItemFilterExpression;
  display_filters: IIssueDisplayFilterOptions | undefined;
  display_properties: IIssueDisplayProperties;
}

/**
 * Pagination + grouping cursor options for the paginated issues endpoint.
 *
 * Fields:
 * - `canGroup`: whether server-side grouping is permitted for this request
 *   (some layouts request flat lists even when a `groupedBy` axis exists)
 * - `perPageCount`: page size — server enforces an upper bound
 * - `before` / `after`: opaque cursor strings returned by the previous page response
 * - `groupedBy` / `subGroupedBy`: forwarded to the server as `group_by` / `sub_group_by`
 * - `orderBy`: forwarded as `order_by` (`-` prefix means descending)
 */
export interface IssuePaginationOptions {
  canGroup: boolean;
  perPageCount: number;
  before?: string;
  after?: string;
  groupedBy?: TIssueGroupByOptions;
  subGroupedBy?: TIssueGroupByOptions;
  orderBy?: TIssueOrderByOptions;
}

/**
 * Functional-component contract for a single spreadsheet column renderer.
 *
 * Each column module exports one `TSpreadsheetColumn` that renders the cell for one
 * issue field. Spreadsheet rows compose these components; the registry of installed
 * columns lives in `apps/web/core/components/issues/issue-layouts/spreadsheet/`.
 *
 * Props:
 * - `issue`: the row's issue record
 * - `onClose`: invoked by inline editors (dropdowns/popovers) when they should close
 * - `onChange`: invoked with the issue plus a partial patch when the cell mutates
 *   the issue — `updates` carries supplemental change-tracking metadata
 * - `disabled`: whether the cell is read-only (e.g. user lacks edit permission)
 */
export type TSpreadsheetColumn = React.FC<{
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
}>;
