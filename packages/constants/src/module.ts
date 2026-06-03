/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module vocabulary — status color tokens, layout/order/filter options, and
 * sort key — consumed by `apps/web/core/components/modules/**` and the module
 * MobX stores.
 */

// types
import type { TModuleLayoutOptions, TModuleOrderByOptions, TModuleStatus } from "@plane/types";

/**
 * Hex color tokens per module status (`TModuleStatus`-keyed so the compiler flags missing entries) used by pills, dot indicators, and gantt blocks.
 * Consumers: status badges and dropdowns in `apps/web/core/components/modules/**` and the gantt block renderer.
 */
export const MODULE_STATUS_COLORS: {
  [key in TModuleStatus]: string;
} = {
  backlog: "#a3a3a2",
  planned: "#3f76ff",
  paused: "#525252",
  completed: "#16a34a",
  cancelled: "#ef4444",
  "in-progress": "#f39e1f",
};

/**
 * Module status catalog pairing each `TModuleStatus` with its i18n label and Tailwind text/bg classes; `color` re-uses `MODULE_STATUS_COLORS` so pill and dot/badge stay consistent.
 * Consumers: status pills, lists, and module forms in `apps/web/core/components/modules/**`.
 */
export const MODULE_STATUS: {
  i18n_label: string;
  value: TModuleStatus;
  color: string;
  textColor: string;
  bgColor: string;
}[] = [
  {
    i18n_label: "project_modules.status.backlog",
    value: "backlog",
    color: MODULE_STATUS_COLORS.backlog,
    textColor: "text-placeholder",
    bgColor: "bg-layer-1",
  },
  {
    i18n_label: "project_modules.status.planned",
    value: "planned",
    color: MODULE_STATUS_COLORS.planned,
    textColor: "text-blue-500",
    bgColor: "bg-indigo-50",
  },
  {
    i18n_label: "project_modules.status.in_progress",
    value: "in-progress",
    color: MODULE_STATUS_COLORS["in-progress"],
    textColor: "text-amber-500",
    bgColor: "bg-amber-50",
  },
  {
    i18n_label: "project_modules.status.paused",
    value: "paused",
    color: MODULE_STATUS_COLORS.paused,
    textColor: "text-tertiary",
    bgColor: "bg-surface-2",
  },
  {
    i18n_label: "project_modules.status.completed",
    value: "completed",
    color: MODULE_STATUS_COLORS.completed,
    textColor: "text-success-primary",
    bgColor: "bg-success-subtle",
  },
  {
    i18n_label: "project_modules.status.cancelled",
    value: "cancelled",
    color: MODULE_STATUS_COLORS.cancelled,
    textColor: "text-danger-primary",
    bgColor: "bg-danger-subtle",
  },
];

/**
 * Module list view layouts (`list`, `board`, `gantt`) pairing each `TModuleLayoutOptions` discriminator with its switcher i18n title.
 * Consumers: layout switcher in `apps/web/core/components/modules/**`.
 */
export const MODULE_VIEW_LAYOUTS: {
  key: TModuleLayoutOptions;
  i18n_title: string;
}[] = [
  {
    key: "list",
    i18n_title: "project_modules.layout.list",
  },
  {
    key: "board",
    i18n_title: "project_modules.layout.board",
  },
  {
    key: "gantt",
    i18n_title: "project_modules.layout.timeline",
  },
];

/**
 * Module order-by options (name/progress/issues/due-date/created-at/manual) pairing each `TModuleOrderByOptions` with its sort-dropdown i18n label.
 * Consumers: sort dropdown in `apps/web/core/components/modules/**` and the module store's order-by reducers.
 */
export const MODULE_ORDER_BY_OPTIONS: {
  key: TModuleOrderByOptions;
  i18n_label: string;
}[] = [
  {
    key: "name",
    i18n_label: "project_modules.order_by.name",
  },
  {
    key: "progress",
    i18n_label: "project_modules.order_by.progress",
  },
  {
    key: "issues_length",
    i18n_label: "project_modules.order_by.issues",
  },
  {
    key: "target_date",
    i18n_label: "project_modules.order_by.due_date",
  },
  {
    key: "created_at",
    i18n_label: "project_modules.order_by.created_at",
  },
  {
    key: "sort_order",
    i18n_label: "project_modules.order_by.manual",
  },
];
