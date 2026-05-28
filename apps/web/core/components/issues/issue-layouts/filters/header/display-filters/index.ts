/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the Display Filters dropdown package.
 *
 * Re-exports the orchestrator (`DisplayFiltersSelection`) and its individual sections:
 *   - `FilterGroupBy` (`group-by.tsx`)
 *   - `FilterSubGroupBy` (`sub-group-by.tsx`)
 *   - `FilterOrderBy` (`order-by.tsx`)
 *   - `FilterDisplayProperties` (`display-properties.tsx`)
 *   - `FilterExtraOptions` (`extra-options.tsx`)
 *
 * The orchestrator composes the five sections into a single panel and gates each section's visibility
 * against the `layoutDisplayFiltersOptions` schema from `ISSUE_DISPLAY_FILTERS_BY_PAGE` in
 * `@plane/constants`. The parent route root persists section updates via
 * `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS, <partial>)`
 * for group_by / sub_group_by / order_by / extra-options, and `EIssueFilterType.DISPLAY_PROPERTIES`
 * for the per-card visibility map.
 */

export * from "./display-filters-selection";
export * from "./display-properties";
export * from "./extra-options";
export * from "./group-by";
export * from "./order-by";
export * from "./sub-group-by";
