/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project vocabulary — network/visibility options, filter/order/access maps, and
 * feature flags — consumed by `apps/web/core/components/project/**` and the
 * project MobX stores.
 */

// plane imports
import type { TProjectAppliedDisplayFilterKeys, TProjectOrderByOptions } from "@plane/types";
// local imports

/**
 * Narrowed `lucide-react` icon names for the project visibility chip (`Lock` = private, `Globe2` = public).
 * Consumers: project create/edit modals and visibility indicators in `apps/web/core/components/project/**`.
 */
export type TNetworkChoiceIconKey = "Lock" | "Globe2";

/**
 * Shape of a project visibility option whose numeric `key` (`0`=private, `2`=public; `1` is historically reserved on the backend) mirrors `Project.network` choices in `apps/api/plane/db/models/project.py`.
 * Fields: `labelKey` (English identifier for analytics/hooks), `i18n_label`/`description` (i18n keys resolved at render), `iconKey` (`lucide-react` icon name).
 */
export type TNetworkChoice = {
  key: 0 | 2;
  labelKey: string;
  i18n_label: string;
  description: string;
  iconKey: TNetworkChoiceIconKey;
};

/**
 * Project visibility options (Private first, Public second — array order drives display order); `key` values (`0`, `2`) are the backend contract per {@link TNetworkChoice} and must not be reassigned.
 * Consumers: project create/edit modals and visibility selectors in `apps/web/core/components/project/**`.
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
 * Canonical project state-group registry (`backlog`/`unstarted`/`started`/`completed`/`cancelled`) keyed by their i18n labels; keys mirror `State` choices in `apps/api/plane/db/models/state.py` and must stay in lockstep.
 * Consumers: state pages and state-group selectors in `apps/web/core/components/project/**`.
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
 * Month-count presets (`value` = integer months sent to the automation API; `i18n_label` resolved with `value` at render) for project auto-archive/close rules.
 * Consumers: project settings automation page in `apps/web/core/components/project/**`.
 */
export const PROJECT_AUTOMATION_MONTHS = [
  { i18n_label: "workspace_projects.common.months_count", value: 1 },
  { i18n_label: "workspace_projects.common.months_count", value: 3 },
  { i18n_label: "workspace_projects.common.months_count", value: 6 },
  { i18n_label: "workspace_projects.common.months_count", value: 9 },
  { i18n_label: "workspace_projects.common.months_count", value: 12 },
];

/**
 * Workspace projects list sort options pairing the `TProjectOrderByOptions` query value with its picker i18n label.
 * Consumers: project list header sort dropdown in `apps/web/core/components/project/**` and the `project_filter` MobX store.
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
 * Workspace projects list display-filter scopes (`my_projects` = current user is a member; `archived_projects` = soft-deleted) pairing `TProjectAppliedDisplayFilterKeys` with i18n chip labels.
 * Consumers: project list filter chips in `apps/web/core/components/project/**` and the `project_filter` MobX store.
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
 * i18n key catalog for project-level error toasts (permission denials and cycle/module/issue DELETE failures); `permissionError.i18n_message` is intentionally `undefined` so the toast renders title-only.
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
 * Canonical project feature toggle keys persisted on the project's feature configuration and consumed by feature-gate UIs.
 * Consumers: project settings "Features" page and feature gates in `apps/web/core/components/project/**`, plus the project feature store in `apps/web/core/store/project/**`.
 */
export enum EProjectFeatureKey {
  WORK_ITEMS = "work_items",
  CYCLES = "cycles",
  MODULES = "modules",
  VIEWS = "views",
  PAGES = "pages",
  INTAKE = "intake",
}
