/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// types
/**
 * Catalog of cycle lifecycle states with i18n keys and theme color tokens.
 *
 * Each entry binds a `value` (one of `current` | `upcoming` | `completed` | `draft`) to
 * its localized label/title and Tailwind color classes used to render the cycle's
 * status pill. The `value` strings are derived from the start/end date relationship
 * computed in `apps/web/core/store/cycle.store.ts`, NOT from a server-side enum.
 *
 * Consumers: `apps/web/core/components/cycles/**` status badges/pills/lists and
 * `apps/web/core/store/cycle.store.ts` for status assignment logic.
 *
 * Values:
 * - current: cycle is in progress (today between start_date and end_date)
 * - upcoming: cycle's start_date is in the future
 * - completed: cycle's end_date has passed
 * - draft: cycle is created but missing start_date/end_date
 */
export const CYCLE_STATUS: {
  i18n_label: string;
  value: "current" | "upcoming" | "completed" | "draft";
  i18n_title: string;
  color: string;
  textColor: string;
  bgColor: string;
}[] = [
  {
    i18n_label: "project_cycles.status.days_left",
    value: "current",
    i18n_title: "project_cycles.status.in_progress",
    color: "#F59E0B",
    textColor: "text-amber-500",
    bgColor: "bg-amber-50",
  },
  {
    i18n_label: "project_cycles.status.yet_to_start",
    value: "upcoming",
    i18n_title: "project_cycles.status.yet_to_start",
    color: "#3F76FF",
    textColor: "text-blue-500",
    bgColor: "bg-indigo-50",
  },
  {
    i18n_label: "project_cycles.status.completed",
    value: "completed",
    i18n_title: "project_cycles.status.completed",
    color: "#16A34A",
    textColor: "text-success-primary",
    bgColor: "bg-success-subtle",
  },
  {
    i18n_label: "project_cycles.status.draft",
    value: "draft",
    i18n_title: "project_cycles.status.draft",
    color: "#525252",
    textColor: "text-tertiary",
    bgColor: "bg-surface-2",
  },
];
