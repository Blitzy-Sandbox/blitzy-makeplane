/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// types
import type { TModuleLayoutOptions, TModuleOrderByOptions, TModuleStatus } from "@plane/types";

/**
 * Hex color tokens for each module status, used as the base color in status
 * pills, dot indicators, and gantt blocks. The keyed lookup mirrors the
 * `TModuleStatus` union from `@plane/types`, so adding a new status there
 * forces the compiler to flag a missing color entry here.
 *
 * Consumers: `apps/web/core/components/modules/**` status badges, the module
 * status dropdown, and the gantt chart block renderer.
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
 * Module status catalog — pairs each `TModuleStatus` value with the i18n
 * label and Tailwind text/background color classes used by the status pill.
 * The `color` field is the hex token re-used from `MODULE_STATUS_COLORS` so
 * the pill and the dot/badge stay visually consistent.
 *
 * Consumers: `apps/web/core/components/modules/**` status pills, lists, and
 * the create/edit module forms.
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
 * Layout option catalog for the module list view: `list` (table rows),
 * `board` (kanban by status), and `gantt` (timeline). Each entry pairs a
 * `TModuleLayoutOptions` discriminator with the i18n title for the layout
 * switcher button.
 *
 * Consumers: `apps/web/core/components/modules/**` layout switcher.
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
 * Order-by option catalog for the module list view (name/progress/issues/
 * due-date/created-at/manual). Each entry pairs a `TModuleOrderByOptions`
 * sort-key with the i18n label rendered in the sort dropdown.
 *
 * Consumers: `apps/web/core/components/modules/**` sort dropdown and the
 * module MobX store's order-by reducers.
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
