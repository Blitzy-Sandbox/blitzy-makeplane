/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TProjectAppliedDisplayFilterKeys, TProjectOrderByOptions } from "@plane/types";
// local imports

/**
 * Icon key for a project network/visibility option — narrowed to the icon names
 * exported by `lucide-react` that the project visibility chip renders
 * (`"Lock"` for private projects, `"Globe2"` for public projects).
 *
 * Consumers: project create/edit modals and visibility indicators in
 * `apps/web/core/components/project/**`.
 */
export type TNetworkChoiceIconKey = "Lock" | "Globe2";

/**
 * Shape of a single project network/visibility option (private vs public).
 *
 * The numeric `key` is a cross-stack contract — `0` = private, `2` = public —
 * and mirrors the `Project.network` IntegerField choices in
 * `apps/api/plane/db/models/project.py`. The gap between `0` and `2` is
 * intentional: value `1` is historically reserved on the backend and must not
 * be reassigned here without a coordinated schema change.
 *
 * Field semantics:
 * - `key`: numeric visibility code persisted on `Project.network`.
 * - `labelKey`: stable English identifier ("Private" | "Public") used for
 *   non-translated UI hooks and analytics.
 * - `i18n_label` / `description`: i18n keys resolved by the i18n provider at
 *   the call site (not pre-translated strings).
 * - `iconKey`: the `lucide-react` icon name rendered next to the label.
 */
export type TNetworkChoice = {
  key: 0 | 2;
  labelKey: string;
  i18n_label: string;
  description: string;
  iconKey: TNetworkChoiceIconKey;
};

/**
 * Project network/visibility options rendered in the create/edit project form.
 *
 * Order is intentional — the array index drives the order shown to the user
 * (Private first, Public second). The `key` values (`0`, `2`) are part of the
 * backend contract and must not be reassigned (see {@link TNetworkChoice}).
 *
 * Consumers: project create/edit modals and visibility selectors in
 * `apps/web/core/components/project/**`.
 */
export const NETWORK_CHOICES: TNetworkChoice[] = [
  {
    key: 0,
    labelKey: "Private",
    i18n_label: "workspace_projects.network.private.title",
    description: "workspace_projects.network.private.description", //"Accessible only by invite",
    iconKey: "Lock",
  },
  {
    key: 2,
    labelKey: "Public",
    i18n_label: "workspace_projects.network.public.title",
    description: "workspace_projects.network.public.description", //"Anyone in the workspace except Guests can join",
    iconKey: "Globe2",
  },
];

/**
 * Project-level state-group registry — pairs each canonical workflow state-group
 * key (`backlog`, `unstarted`, `started`, `completed`, `cancelled`) with its
 * i18n label key.
 *
 * Mirrors the state-group choices defined on the backend `State` model in
 * `apps/api/plane/db/models/state.py`; the keys MUST remain in lockstep with
 * the backend enumeration.
 *
 * Consumers: project settings state pages and state-group selectors in
 * `apps/web/core/components/project/**`.
 */
export const GROUP_CHOICES = {
  backlog: {
    key: "backlog",
    i18n_label: "workspace_projects.state.backlog",
  },
  unstarted: {
    key: "unstarted",
    i18n_label: "workspace_projects.state.unstarted",
  },
  started: {
    key: "started",
    i18n_label: "workspace_projects.state.started",
  },
  completed: {
    key: "completed",
    i18n_label: "workspace_projects.state.completed",
  },
  cancelled: {
    key: "cancelled",
    i18n_label: "workspace_projects.state.cancelled",
  },
};

/**
 * Month-count presets for project automation rules (e.g., "auto-archive items
 * untouched for N months", "auto-close items untouched for N months").
 *
 * `value` is an integer month count submitted directly to the project
 * automation API; the `i18n_label` key is paired with the `value` at render
 * time to produce a localized "N months" string.
 *
 * Consumers: project settings automation page in
 * `apps/web/core/components/project/**`.
 */
export const PROJECT_AUTOMATION_MONTHS = [
  { i18n_label: "workspace_projects.common.months_count", value: 1 },
  { i18n_label: "workspace_projects.common.months_count", value: 3 },
  { i18n_label: "workspace_projects.common.months_count", value: 6 },
  { i18n_label: "workspace_projects.common.months_count", value: 9 },
  { i18n_label: "workspace_projects.common.months_count", value: 12 },
];

/**
 * Sort-order options for the workspace projects list — the `key` is the
 * `TProjectOrderByOptions` union value sent to the project list query, and
 * `i18n_label` is the i18n key resolved for the picker label.
 *
 * Consumers: project list header sort dropdown in
 * `apps/web/core/components/project/**` (and the `project_filter` MobX store
 * in `apps/web/core/store/project/`).
 */
export const PROJECT_ORDER_BY_OPTIONS: {
  key: TProjectOrderByOptions;
  i18n_label: string;
}[] = [
  {
    key: "sort_order",
    i18n_label: "workspace_projects.sort.manual",
  },
  {
    key: "name",
    i18n_label: "workspace_projects.sort.name",
  },
  {
    key: "created_at",
    i18n_label: "workspace_projects.sort.created_at",
  },
  {
    key: "members_length",
    i18n_label: "workspace_projects.sort.members_length",
  },
];

/**
 * Display-filter scopes for the workspace projects list — narrows the list to
 * "my projects" (projects the current user is a member of) vs "archived
 * projects" (soft-deleted projects in the workspace).
 *
 * The `key` is a `TProjectAppliedDisplayFilterKeys` union value applied to the
 * project list query; `i18n_label` is the i18n key for the chip label.
 *
 * Consumers: project list filter chips in `apps/web/core/components/project/**`
 * (and the `project_filter` MobX store in `apps/web/core/store/project/`).
 */
export const PROJECT_DISPLAY_FILTER_OPTIONS: {
  key: TProjectAppliedDisplayFilterKeys;
  i18n_label: string;
}[] = [
  {
    key: "my_projects",
    i18n_label: "workspace_projects.scope.my_projects",
  },
  {
    key: "archived_projects",
    i18n_label: "workspace_projects.scope.archived_projects",
  },
];

/**
 * i18n message catalog for project-level error toasts.
 *
 * Each entry carries `i18n_title` and `i18n_message` keys that the i18n
 * provider resolves at the toast call site — they are NOT pre-translated
 * strings. `i18n_message` is intentionally `undefined` for `permissionError`
 * because the toast component renders only the title for permission failures.
 *
 * Entries:
 * - `permissionError`: user attempted an action they lack permission for.
 * - `cycleDeleteError` / `moduleDeleteError` / `issueDeleteError`: the
 *   corresponding DELETE API call failed (network error, dependency conflict,
 *   or backend validation).
 *
 * Consumers: error toast triggers across `apps/web/core/components/project/**`.
 */
export const PROJECT_ERROR_MESSAGES = {
  permissionError: {
    i18n_title: "workspace_projects.error.permission",
    i18n_message: undefined,
  },
  cycleDeleteError: {
    i18n_title: "error",
    i18n_message: "workspace_projects.error.cycle_delete",
  },
  moduleDeleteError: {
    i18n_title: "error",
    i18n_message: "workspace_projects.error.module_delete",
  },
  issueDeleteError: {
    i18n_title: "error",
    i18n_message: "workspace_projects.error.issue_delete",
  },
};

/**
 * Project feature toggle keys — identifies the optional product surfaces that a
 * project can enable or disable from its settings.
 *
 * The string values (`"work_items"`, `"cycles"`, ...) are the canonical
 * identifiers persisted on the project's feature configuration and consumed by
 * feature-gate UIs to decide whether to render each surface.
 *
 * Consumers: project settings "Features" page and feature-gate checks in
 * `apps/web/core/components/project/**`; project feature MobX state in
 * `apps/web/core/store/project/**`.
 */
export enum EProjectFeatureKey {
  WORK_ITEMS = "work_items",
  CYCLES = "cycles",
  MODULES = "modules",
  VIEWS = "views",
  PAGES = "pages",
  INTAKE = "intake",
}
