/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sort direction tokens used across list filters and orderings. The lowercase
 * literal values mirror the server-side `ordering=` query parameter convention
 * expected by DRF list endpoints.
 *
 * Consumers: issue/cycle/module/project filter UIs in `apps/web/core/components/**`
 * and backend serializers in `apps/api/plane/app/serializers/**`.
 */
export enum E_SORT_ORDER {
  ASC = "asc",
  DESC = "desc",
}
/**
 * Preset relative-date filter options for "due after now" / future-anchored
 * filters. Each `value` encodes `<count>_<unit>;<direction>;<anchor>` and is
 * parsed by the issue filter processor on the server side.
 *
 * Consumers: issue filter dropdowns and view filter builders in
 * `apps/web/core/components/issues/**`.
 */
export const DATE_AFTER_FILTER_OPTIONS = [
  {
    name: "1 week from now",
    value: "1_weeks;after;fromnow",
  },
  {
    name: "2 weeks from now",
    value: "2_weeks;after;fromnow",
  },
  {
    name: "1 month from now",
    value: "1_months;after;fromnow",
  },
  {
    name: "2 months from now",
    value: "2_months;after;fromnow",
  },
];

/**
 * Preset relative-date filter options for "due before now" / past-anchored
 * filters. Uses the same `<count>_<unit>;<direction>;<anchor>` value encoding
 * as `DATE_AFTER_FILTER_OPTIONS`. The `i18n_name` key on individual entries,
 * when present, is the translation key consumers should prefer over `name`.
 *
 * Consumers: issue filter dropdowns and view filter builders in
 * `apps/web/core/components/issues/**`.
 */
export const DATE_BEFORE_FILTER_OPTIONS = [
  {
    name: "1 week ago",
    value: "1_weeks;before;fromnow",
  },
  {
    name: "2 weeks ago",
    value: "2_weeks;before;fromnow",
  },
  {
    name: "1 month ago",
    i18n_name: "date_filters.1_month_ago",
    value: "1_months;before;fromnow",
  },
];

/**
 * Preset relative-date filter options for filtering projects by `created_at`.
 * Each `value` encodes `<bucket>;custom;custom` where `<bucket>` is a named
 * window (e.g. `today`, `last_7_days`) parsed server-side by the project list
 * endpoint.
 *
 * Consumers: project list filters in `apps/web/core/components/project/**`.
 */
export const PROJECT_CREATED_AT_FILTER_OPTIONS = [
  {
    name: "Today",
    value: "today;custom;custom",
  },
  {
    name: "Yesterday",
    value: "yesterday;custom;custom",
  },
  {
    name: "Last 7 days",
    value: "last_7_days;custom;custom",
  },
  {
    name: "Last 30 days",
    value: "last_30_days;custom;custom",
  },
];
