/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sort direction tokens whose lowercase values match the DRF `ordering=` query parameter convention.
 * Consumers: filter UIs in `apps/web/core/components/**` and list serializers in `apps/api/plane/app/serializers/**`.
 */
export enum E_SORT_ORDER {
  ASC = "asc",
  DESC = "desc",
}
/**
 * Future-anchored relative-date presets where `value` encodes `<count>_<unit>;<direction>;<anchor>` for server-side filter parsing.
 * Consumers: issue filter dropdowns and view builders in `apps/web/core/components/issues/**`.
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
 * Past-anchored relative-date presets using the same `<count>_<unit>;<direction>;<anchor>` encoding as `DATE_AFTER_FILTER_OPTIONS`, with optional `i18n_name` translation keys preferred over `name` when present.
 * Consumers: issue filter dropdowns and view builders in `apps/web/core/components/issues/**`.
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
 * Named-window date presets for project `created_at` filters, encoded as `<bucket>;custom;custom` for server-side parsing by the project list endpoint.
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
