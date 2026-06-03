/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Dashboard widget filter vocabulary consumed by the dashboard helper at
 * `apps/web/helpers/dashboard.helper.ts` and the home dashboard widgets in
 * `apps/web/core/components/home/widgets/**` to drive duration/status filters.
 */

// types
import type { TIssuesListTypes } from "@plane/types";

/**
 * Duration filter tokens for dashboard widgets — drives "Due today / this week / month" filters
 * across the dashboard surface.
 *
 * Consumers: `apps/web/helpers/dashboard.helper.ts` and `apps/web/core/store/dashboard.store.ts`.
 *
 * Values:
 * - NONE: no duration filter (all time)
 * - TODAY: due today
 * - THIS_WEEK / THIS_MONTH / THIS_YEAR: due within the current calendar period
 * - CUSTOM: user-selected date range
 */
export enum EDurationFilters {
  NONE = "none",
  TODAY = "today",
  THIS_WEEK = "this_week",
  THIS_MONTH = "this_month",
  THIS_YEAR = "this_year",
  CUSTOM = "custom",
}

// filter duration options
/**
 * Dropdown option list for the dashboard's duration filter, pairing each `EDurationFilters`
 * key with its English label (i18n is resolved at the call site).
 *
 * Consumers: analytics duration filter at `apps/web/core/components/analytics/select/duration.tsx`,
 * inbox date filter at `apps/web/core/components/inbox/inbox-filter/`, the analytics store at
 * `apps/web/core/store/analytics.store.ts`, and `apps/web/helpers/dashboard.helper.ts`.
 */
export const DURATION_FILTER_OPTIONS: {
  key: EDurationFilters;
  label: string;
}[] = [
  {
    key: EDurationFilters.NONE,
    label: "All time",
  },
  {
    key: EDurationFilters.TODAY,
    label: "Due today",
  },
  {
    key: EDurationFilters.THIS_WEEK,
    label: "Due this week",
  },
  {
    key: EDurationFilters.THIS_MONTH,
    label: "Due this month",
  },
  {
    key: EDurationFilters.THIS_YEAR,
    label: "Due this year",
  },
  {
    key: EDurationFilters.CUSTOM,
    label: "Custom",
  },
];

// random background colors for project cards
// INTENT UNCLEAR: PROJECT_BACKGROUND_COLORS has no consumer in tracked source — originally
// intended for the legacy workspace dashboard project grid; the home dashboard at
// apps/web/core/components/home/widgets/ does not currently import this constant.
/**
 * Tailwind background-color tokens used to randomize project card backgrounds on the
 * dashboard project grid, giving each project a visually distinct appearance.
 */
export const PROJECT_BACKGROUND_COLORS = [
  "bg-gray-500/20",
  "bg-success-subtle",
  "bg-danger-subtle",
  "bg-orange-500/20",
  "bg-blue-500/20",
  "bg-yellow-500/20",
  "bg-pink-500/20",
  "bg-purple-500/20",
];

// assigned and created issues widgets tabs list
// INTENT UNCLEAR: FILTERED_ISSUES_TABS_LIST has no consumer in tracked source — was
// intended for the legacy assigned/created issue widgets; the home dashboard widget at
// apps/web/core/components/home/widgets/ does not currently import this constant.
/**
 * Tab definitions for the "Assigned" and "Created" issue widgets when an explicit
 * duration filter is active — surfaces `upcoming` / `overdue` / `completed` slices.
 */
export const FILTERED_ISSUES_TABS_LIST: {
  key: TIssuesListTypes;
  label: string;
}[] = [
  {
    key: "upcoming",
    label: "Upcoming",
  },
  {
    key: "overdue",
    label: "Overdue",
  },
  {
    key: "completed",
    label: "Marked completed",
  },
];

// assigned and created issues widgets tabs list
// INTENT UNCLEAR: UNFILTERED_ISSUES_TABS_LIST has no consumer in tracked source — was
// intended for the legacy assigned/created issue widgets; the home dashboard widget at
// apps/web/core/components/home/widgets/ does not currently import this constant.
/**
 * Tab definitions for the "Assigned" and "Created" issue widgets when no duration
 * filter is applied — surfaces `pending` / `completed` slices.
 */
export const UNFILTERED_ISSUES_TABS_LIST: {
  key: TIssuesListTypes;
  label: string;
}[] = [
  {
    key: "pending",
    label: "Pending",
  },
  {
    key: "completed",
    label: "Marked completed",
  },
];

// INTENT UNCLEAR: TLinkOptions has no consumer in tracked source — was intended for
// dashboard link/CTA helpers but no current site imports it.
/**
 * Options payload shape used by dashboard link/quick-action helpers — carries the
 * acting user id (or `undefined` while the user store is still bootstrapping).
 */
export type TLinkOptions = {
  userId: string | undefined;
};
