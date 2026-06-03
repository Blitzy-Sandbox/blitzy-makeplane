/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Generic pagination envelope contracts for the `@plane/types` package.
 *
 * Provides the parameterized `TPaginatedResponse<T>` wrapper returned by paginated
 * list endpoints in `apps/api`. The non-generic `TPaginationInfo` (with required
 * fields) lives in `./common.ts`.
 */

/**
 * Generic paginated response envelope for `apps/api` list endpoints.
 *
 * Mirrors the cursor- and group-aware response shape produced by `BasePaginator`
 * in `apps/api/plane/utils/paginator.py` and consumed by MobX stores under
 * `apps/web/core/store/` and `apps/admin/store/`. Optional fields reflect that
 * different endpoints (ungrouped lists, single-level kanban, two-level kanban)
 * populate different subsets of the envelope.
 *
 * Type parameter:
 * - `T`: the element type contained in `results` (e.g. `IProject[]`, `TPage[]`).
 */
export type TPaginatedResponse<T> = {
  /** Page payload typed by the consumer (typically an array of domain entities). */
  results: T;
  /** Name of the property issues are grouped by (kanban/list `group_by`); null/omitted when ungrouped. */
  grouped_by?: string | null;
  /** Secondary grouping property for two-level kanban; omitted on single-level layouts. */
  sub_grouped_by?: string | null;
  /** Total item count across all pages when known; omitted by endpoints that skip the count query. */
  total_count?: number;
  /** Opaque cursor pointing at the next page; absent at the trailing boundary. */
  next_cursor?: string;
  /** Opaque cursor pointing at the previous page; absent at the leading boundary. */
  prev_cursor?: string;
  /** True when a subsequent page is available after `next_cursor`. */
  next_page_results?: boolean;
  /** True when a prior page is available before `prev_cursor`. */
  prev_page_results?: boolean;
  /** Number of items returned in the current page. */
  count?: number;
  /** Total page count across the full result set when computed. */
  total_pages?: number;
  /** Total result count across all pages; populated by cursor-based paginators. */
  total_results?: number;
  /** Optional aggregate stats blob (e.g. distribution counts); null when unused. */
  extra_stats?: string | null;
};
