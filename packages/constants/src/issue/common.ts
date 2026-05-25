/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  IIssueDisplayProperties,
  IIssueFilterOptions,
  TIssue,
  EIssuesStoreType,
} from "@plane/types";

/**
 * String sentinel for the "All Issues" global workspace view — used both as a
 * display label and as a route/view-id discriminator throughout the issue layer.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/spreadsheet/roots/workspace-root.tsx`,
 * `apps/web/core/components/issues/issue-layouts/gantt/base-gantt-root.tsx`,
 * `apps/web/core/components/issues/issue-layouts/list/default.tsx`,
 * `apps/web/core/components/issues/issue-detail-widgets/sub-issues/**`, and
 * `apps/web/core/store/issue/helpers/base-issues.store.ts` for the
 * workspace-wide all-issues view.
 */
export const ALL_ISSUES = "All Issues";

/**
 * Issue priority value union — **cross-stack contract**: these string literals
 * MIRROR the `Issue.priority` CharField choices declared in
 * `apps/api/plane/db/models/issue.py`. Changing any value here requires a
 * corresponding backend migration; DO NOT alter.
 *
 * Consumers: every priority-aware component in `apps/web/core/components/issues/**`,
 * the priority filter pills in `./filter.ts`, the form default in `./modal.ts`,
 * and `apps/api/plane/app/serializers/issue.py` validation.
 */
export type TIssuePriorities = "urgent" | "high" | "medium" | "low" | "none";

/**
 * Shape of a single priority filter pill entry — pairs the priority `key` with
 * its i18n translation key, Tailwind class string, and Material Symbols icon
 * name. The `icon` field resolves to a glyph rendered by `@plane/ui`.
 *
 * Consumers: `./filter.ts` (`ISSUE_PRIORITY_FILTERS`) and the priority filter
 * chip components in `apps/web/core/components/issues/issue-layouts/filters/**`.
 */
export type TIssueFilterPriorityObject = {
  key: TIssuePriorities;
  titleTranslationKey: string;
  className: string;
  icon: string;
};

/**
 * Client-side group-by key → backend Django ORM filter token map. Used when
 * serializing the active group-by selection into the API query string (e.g.,
 * group_by=state translates to `state_id` for the Django ORM filter).
 *
 * Note: `team_project` and `project` both map to `project_id` on the server
 * side because the Django ORM uses the same `project_id` column for both; the
 * eslint-disable comment on the duplicate value guards this intentional
 * collision.
 *
 * Consumers: `apps/web/core/store/issue/helpers/issue-filter-helper.store.ts`
 * group-by serialization for the API query string.
 */
export enum EIssueGroupByToServerOptions {
  "state" = "state_id",
  "priority" = "priority",
  "labels" = "labels__id",
  "state_detail.group" = "state__group",
  "assignees" = "assignees__id",
  "cycle" = "cycle_id",
  "module" = "issue_module__module_id",
  "target_date" = "target_date",
  "project" = "project_id",
  "created_by" = "created_by",
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  "team_project" = "project_id",
}

/**
 * Inverse of `EIssueGroupByToServerOptions` for the response-side: maps the
 * server-returned group-by token to the client-facing property name on
 * `TIssue` / `IIssueFilterOptions` (e.g., the API field `assignees__id` becomes
 * the client field `assignee_ids`). Used when reading paginated grouped issues
 * back from the API.
 *
 * Consumers: `apps/web/core/store/issue/helpers/issue-filter-helper.store.ts`
 * group response deserialization and grouped-list rendering helpers.
 */
export enum EIssueGroupBYServerToProperty {
  "state_id" = "state_id",
  "priority" = "priority",
  "labels__id" = "label_ids",
  "state__group" = "state__group",
  "assignees__id" = "assignee_ids",
  "cycle_id" = "cycle_id",
  "issue_module__module_id" = "module_ids",
  "target_date" = "target_date",
  "project_id" = "project_id",
  "created_by" = "created_by",
}

/**
 * Comment access specifier — controls who can read a given issue comment.
 *
 * Cross-stack contract: matches the `IssueComment.access` CharField choices in
 * `apps/api/plane/db/models/issue.py`. DO NOT change without a backend
 * migration.
 *
 * Values:
 * - EXTERNAL: visible to guests / external collaborators (deploy-board surface)
 * - INTERNAL: visible only to workspace members (admin + member roles)
 *
 * Consumers: `apps/web/core/components/comments/comment-create.tsx`,
 * `apps/web/core/components/comments/quick-actions.tsx`,
 * `apps/web/core/components/comments/card/display.tsx`, and the editor
 * toolbars under `apps/web/core/components/editor/**` that render the
 * access toggle.
 */
export enum EIssueCommentAccessSpecifier {
  EXTERNAL = "EXTERNAL",
  INTERNAL = "INTERNAL",
}

/**
 * Virtual row kinds emitted by the issue list renderer for layout-aware
 * rendering — the virtualized list uses these tags to pick the row component
 * to render at each index.
 *
 * Values:
 * - HEADER: a group header row (in grouped list / kanban)
 * - ISSUE: a regular issue row
 * - NO_ISSUES: empty-state row for a group with no items
 * - QUICK_ADD: inline create-issue affordance row
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/calendar/base-calendar-root.tsx`
 * and the virtualized list / kanban renderers under
 * `apps/web/core/components/issues/issue-layouts/{list,kanban}/**`.
 */
export enum EIssueListRow {
  HEADER = "HEADER",
  ISSUE = "ISSUE",
  NO_ISSUES = "NO_ISSUES",
  QUICK_ADD = "QUICK_ADD",
}

/**
 * Priority catalog with plain English labels (no i18n) — used by lightweight
 * surfaces that do not have access to the i18n provider (toolbars, dropdowns,
 * power-K menus). For i18n-aware pills see `ISSUE_PRIORITY_FILTERS` in
 * `./filter.ts`.
 *
 * Consumers: `apps/web/core/components/dropdowns/priority.tsx`,
 * `apps/web/core/components/readonly/priority.tsx`,
 * `apps/web/core/components/power-k/ui/pages/context-based/work-item/priorities-menu.tsx`,
 * and other priority pickers without translation context.
 */
export const ISSUE_PRIORITIES: {
  key: TIssuePriorities;
  title: string;
}[] = [
  {
    key: "urgent",
    title: "Urgent",
  },
  {
    key: "high",
    title: "High",
  },
  {
    key: "medium",
    title: "Medium",
  },
  {
    key: "low",
    title: "Low",
  },
  {
    key: "none",
    title: "None",
  },
];

/**
 * Group-by axes on which drag-and-drop issue reordering is permitted —
 * dragging an issue card from one group bucket to another mutates the
 * corresponding field on the issue (e.g., dragging in a `state`-grouped
 * board changes the issue's `state_id`).
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/kanban/kanban-group.tsx`
 * and `apps/web/core/components/issues/issue-layouts/list/list-group.tsx`
 * drag handlers.
 */
export const DRAG_ALLOWED_GROUPS: TIssueGroupByOptions[] = [
  "state",
  "priority",
  "assignees",
  "labels",
  "module",
  "cycle",
];

/**
 * Narrow union of `EIssuesStoreType` values that can host the issue-create
 * modal. Excludes store types like `WORKSPACE_DRAFT` and `ARCHIVED` that do
 * not expose a create-issue surface.
 *
 * Consumers: `apps/web/core/components/issues/issue-modal/**` modal store
 * discriminator and issue-create entry points across project, cycle, module,
 * view, profile, and team surfaces.
 */
export type TCreateModalStoreTypes =
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.EPIC
  | EIssuesStoreType.TEAM_PROJECT_WORK_ITEMS;

/**
 * Group-by dropdown options for the issue list — pairs each
 * `TIssueGroupByOptions` value with its i18n translation key. Inline
 * `// required this on …` comments tag entries that are only meaningful on
 * specific page types (team-issues / my-issues) so the dropdown can be
 * filtered per surface.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/filters/**`
 * group-by dropdown.
 */
export const ISSUE_GROUP_BY_OPTIONS: {
  key: TIssueGroupByOptions;
  titleTranslationKey: string;
}[] = [
  { key: "state", titleTranslationKey: "common.states" },
  { key: "state_detail.group", titleTranslationKey: "common.state_groups" },
  { key: "priority", titleTranslationKey: "common.priority" },
  { key: "team_project", titleTranslationKey: "common.team_project" }, // required this on team issues
  { key: "project", titleTranslationKey: "common.project" }, // required this on my issues
  { key: "cycle", titleTranslationKey: "common.cycle" }, // required this on my issues
  { key: "module", titleTranslationKey: "common.module" }, // required this on my issues
  { key: "labels", titleTranslationKey: "common.labels" },
  { key: "assignees", titleTranslationKey: "common.assignees" },
  { key: "created_by", titleTranslationKey: "common.created_by" },
  { key: null, titleTranslationKey: "common.none" },
];

/**
 * Order-by dropdown options. The `-` prefix on values like `-created_at`
 * mirrors DRF's `ordering=` query parameter syntax (descending order); the
 * unprefixed form denotes ascending order.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/filters/**`
 * order-by dropdown and `apps/api/plane/app/views/issue/**` `get_queryset`
 * ordering handling.
 */
export const ISSUE_ORDER_BY_OPTIONS: {
  key: TIssueOrderByOptions;
  titleTranslationKey: string;
}[] = [
  { key: "sort_order", titleTranslationKey: "common.order_by.manual" },
  { key: "-created_at", titleTranslationKey: "common.order_by.last_created" },
  { key: "-updated_at", titleTranslationKey: "common.order_by.last_updated" },
  { key: "start_date", titleTranslationKey: "common.order_by.start_date" },
  { key: "target_date", titleTranslationKey: "common.order_by.due_date" },
  { key: "-priority", titleTranslationKey: "common.priority" },
];

/**
 * Allowlist of issue display-property column keys available across the
 * list / kanban / calendar / spreadsheet layouts. Drives the
 * column-visibility (display-properties) menu.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/filters/**`
 * display-properties menu and the column renderers in
 * `apps/web/core/components/issues/issue-layouts/**`.
 */
export const ISSUE_DISPLAY_PROPERTIES_KEYS: (keyof IIssueDisplayProperties)[] = [
  "assignee",
  "start_date",
  "due_date",
  "labels",
  "key",
  "priority",
  "state",
  "sub_issue_count",
  "link",
  "attachment_count",
  "estimate",
  "created_on",
  "updated_on",
  "modules",
  "cycle",
  "issue_type",
];

/**
 * Restricted subset of display properties available on sub-issue tables
 * (nested inside a parent issue) — sub-issue rows render a tighter property
 * set than top-level issue rows to keep the nested table compact.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` sub-issue
 * table column-visibility menu.
 */
export const SUB_ISSUES_DISPLAY_PROPERTIES_KEYS: (keyof IIssueDisplayProperties)[] = [
  "key",
  "assignee",
  "start_date",
  "due_date",
  "priority",
  "state",
];

/**
 * Display property catalog with i18n title keys — drives the labels in the
 * column-visibility (display-properties) menu. Note: `created_on` and
 * `updated_on` are intentionally absent here because they are
 * spreadsheet-only audit columns; see `SPREADSHEET_PROPERTY_DETAILS` for
 * those.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/filters/**`
 * display-properties menu.
 */
export const ISSUE_DISPLAY_PROPERTIES: {
  key: keyof IIssueDisplayProperties;
  titleTranslationKey: string;
}[] = [
  {
    key: "key",
    titleTranslationKey: "issue.display.properties.id",
  },
  {
    key: "assignee",
    titleTranslationKey: "common.assignee",
  },
  {
    key: "start_date",
    titleTranslationKey: "common.order_by.start_date",
  },
  {
    key: "due_date",
    titleTranslationKey: "common.order_by.due_date",
  },
  { key: "labels", titleTranslationKey: "common.labels" },
  {
    key: "priority",
    titleTranslationKey: "common.priority",
  },
  { key: "state", titleTranslationKey: "common.state" },
  {
    key: "sub_issue_count",
    titleTranslationKey: "issue.display.properties.sub_issue_count",
  },
  {
    key: "attachment_count",
    titleTranslationKey: "issue.display.properties.attachment_count",
  },
  { key: "link", titleTranslationKey: "common.link" },
  {
    key: "estimate",
    titleTranslationKey: "common.estimate",
  },
  { key: "modules", titleTranslationKey: "common.module" },
  { key: "cycle", titleTranslationKey: "common.cycle" },
];

/**
 * Spreadsheet layout column order (left-to-right). A SUPERSET of
 * `ISSUE_DISPLAY_PROPERTIES_KEYS` because spreadsheet rows expose extra
 * date / audit columns (`created_on`, `updated_on`) that are not present in
 * the other layouts.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/spreadsheet/**`
 * column ordering.
 */
export const SPREADSHEET_PROPERTY_LIST: (keyof IIssueDisplayProperties)[] = [
  "state",
  "priority",
  "assignee",
  "labels",
  "modules",
  "cycle",
  "start_date",
  "due_date",
  "estimate",
  "created_on",
  "updated_on",
  "link",
  "attachment_count",
  "sub_issue_count",
];

/**
 * Per-column metadata for the spreadsheet layout — for each property exposes
 * its i18n title, ascending / descending sort keys + display titles, and the
 * `@plane/ui` icon name to render in the column header.
 *
 * **Cross-stack contract:** The `ascendingOrderKey` / `descendingOrderKey`
 * strings (e.g., `assignees__first_name`, `issue_module__module__name`,
 * `-target_date`) are DRF `ordering=` query tokens that target Django ORM
 * field lookups including double-underscore join traversals. They are sent
 * verbatim to `apps/api/plane/app/views/issue/**` `get_queryset` and resolved
 * against `apps/api/plane/db/models/issue.py` and related model fields. DO
 * NOT change without updating the backend query construction.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/spreadsheet/columns/header-column.tsx`
 * column headers and sort controls.
 */
export const SPREADSHEET_PROPERTY_DETAILS: {
  [key in keyof IIssueDisplayProperties]: {
    i18n_title: string;
    ascendingOrderKey: TIssueOrderByOptions;
    ascendingOrderTitle: string;
    descendingOrderKey: TIssueOrderByOptions;
    descendingOrderTitle: string;
    icon: string;
  };
} = {
  assignee: {
    i18n_title: "common.assignees",
    ascendingOrderKey: "assignees__first_name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-assignees__first_name",
    descendingOrderTitle: "Z",
    icon: "MembersPropertyIcon",
  },
  created_on: {
    i18n_title: "common.sort.created_on",
    ascendingOrderKey: "-created_at",
    ascendingOrderTitle: "New",
    descendingOrderKey: "created_at",
    descendingOrderTitle: "Old",
    icon: "CalendarDays",
  },
  due_date: {
    i18n_title: "common.order_by.due_date",
    ascendingOrderKey: "-target_date",
    ascendingOrderTitle: "New",
    descendingOrderKey: "target_date",
    descendingOrderTitle: "Old",
    icon: "DueDatePropertyIcon",
  },
  estimate: {
    i18n_title: "common.estimate",
    ascendingOrderKey: "estimate_point__key",
    ascendingOrderTitle: "Low",
    descendingOrderKey: "-estimate_point__key",
    descendingOrderTitle: "High",
    icon: "EstimatePropertyIcon",
  },
  labels: {
    i18n_title: "common.labels",
    ascendingOrderKey: "labels__name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-labels__name",
    descendingOrderTitle: "Z",
    icon: "LabelPropertyIcon",
  },
  modules: {
    i18n_title: "common.modules",
    ascendingOrderKey: "issue_module__module__name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-issue_module__module__name",
    descendingOrderTitle: "Z",
    icon: "DiceIcon",
  },
  cycle: {
    i18n_title: "common.cycle",
    ascendingOrderKey: "issue_cycle__cycle__name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-issue_cycle__cycle__name",
    descendingOrderTitle: "Z",
    icon: "ContrastIcon",
  },
  priority: {
    i18n_title: "common.priority",
    ascendingOrderKey: "priority",
    ascendingOrderTitle: "None",
    descendingOrderKey: "-priority",
    descendingOrderTitle: "Urgent",
    icon: "PriorityPropertyIcon",
  },
  start_date: {
    i18n_title: "common.order_by.start_date",
    ascendingOrderKey: "-start_date",
    ascendingOrderTitle: "New",
    descendingOrderKey: "start_date",
    descendingOrderTitle: "Old",
    icon: "StartDatePropertyIcon",
  },
  state: {
    i18n_title: "common.state",
    ascendingOrderKey: "state__name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-state__name",
    descendingOrderTitle: "Z",
    icon: "StatePropertyIcon",
  },
  updated_on: {
    i18n_title: "common.sort.updated_on",
    ascendingOrderKey: "-updated_at",
    ascendingOrderTitle: "New",
    descendingOrderKey: "updated_at",
    descendingOrderTitle: "Old",
    icon: "CalendarDays",
  },
  link: {
    i18n_title: "common.link",
    ascendingOrderKey: "-link_count",
    ascendingOrderTitle: "Most",
    descendingOrderKey: "link_count",
    descendingOrderTitle: "Least",
    icon: "Link2",
  },
  attachment_count: {
    i18n_title: "common.attachment",
    ascendingOrderKey: "-attachment_count",
    ascendingOrderTitle: "Most",
    descendingOrderKey: "attachment_count",
    descendingOrderTitle: "Least",
    icon: "Paperclip",
  },
  sub_issue_count: {
    i18n_title: "issue.display.properties.sub_issue",
    ascendingOrderKey: "-sub_issues_count",
    ascendingOrderTitle: "Most",
    descendingOrderKey: "sub_issues_count",
    descendingOrderTitle: "Least",
    icon: "LayersIcon",
  },
};

/**
 * Filter-API field name → `TIssue` property name map. When a filter
 * expression (e.g., `assignees: [userId]`) needs to be applied against an
 * in-memory issue object, this map translates the filter key to the
 * corresponding issue field (`assignee_ids`) so a runtime check like
 * `issue[FILTER_TO_ISSUE_MAP.assignees]` works without a separate switch
 * statement.
 *
 * The `as const` modifier is essential — without it the value type widens to
 * `string` and the lookup loses key-narrowing against `keyof TIssue`.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/utils.tsx` and
 * the in-memory filter application helpers under
 * `apps/web/core/store/issue/helpers/**`.
 */
// Map filter keys to their corresponding issue property keys
export const FILTER_TO_ISSUE_MAP: Partial<Record<keyof IIssueFilterOptions, keyof TIssue>> = {
  assignees: "assignee_ids",
  created_by: "created_by",
  labels: "label_ids",
  priority: "priority",
  cycle: "cycle_id",
  module: "module_ids",
  project: "project_id",
  state: "state_id",
  issue_type: "type_id",
  state_group: "state__group",
} as const;
