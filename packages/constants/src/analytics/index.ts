/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Analytics constants barrel — re-exports field/axis/duration/date-key catalogs
 * used by the workspace analytics page.
 *
 * Re-exports the analytics insight field/tab catalog (`ANALYTICS_INSIGHTS_FIELDS`),
 * the duration filter presets (`ANALYTICS_DURATION_FILTER_OPTIONS`), the chart
 * x/y-axis selectors (`ANALYTICS_X_AXIS_VALUES`, `ANALYTICS_Y_AXIS_VALUES`), the
 * analytics-v2 date-key allowlist (`ANALYTICS_V2_DATE_KEYS`), and the
 * `IInsightField` interface from `./common`.
 *
 * Consumers: `apps/web/core/components/analytics/**` (insight cards, axis pickers,
 * duration dropdowns, chart configuration) and `apps/web/core/store/analytics.store.ts`.
 */

export * from "./common";
