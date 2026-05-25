/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue constants barrel — re-exports issue/work-item vocabulary, filters,
 * layout configuration, and modal defaults shared across the issue feature
 * surface.
 *
 * Sub-modules:
 * - `common`: priority/identifier vocabulary, comment access, list row kinds,
 *   group-by/order-by options, display properties, spreadsheet column metadata,
 *   filter↔issue field map
 * - `filter`: filter operators, page-level filter registries, layout-aware
 *   filter options, activity feed filter helpers, the `ENABLE_ISSUE_DEPENDENCIES`
 *   feature flag
 * - `layout`: list/kanban/calendar/spreadsheet/gantt layout catalogs and the
 *   `TIssueLayout` string union for site-facing surfaces
 * - `modal`: default form state for the work-item create/edit modal
 *
 * Cross-stack contract: priority string values (`urgent`/`high`/`medium`/`low`/`none`)
 * and comment access values (`EXTERNAL`/`INTERNAL`) mirror Django model choices in
 * `apps/api/plane/db/models/issue.py` and are also enforced by
 * `apps/api/plane/app/serializers/issue.py`. DO NOT change those literal values
 * without a corresponding backend migration.
 *
 * Consumers: `apps/web/core/components/issues/**`,
 * `apps/web/core/store/issue/**`, `apps/space/**` (limited site-facing surface),
 * `apps/api/plane/app/serializers/issue.py` (contract mirror).
 */

export * from "./common";
export * from "./filter";
export * from "./layout";
export * from "./modal";
