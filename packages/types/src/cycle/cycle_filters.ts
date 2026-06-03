/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle filter contracts (tab/layout/status/date-range) consumed by
 * `cycle_filter.store.ts` and the cycles UI in `apps/web/core/components/cycles/`.
 */

/**
 * Tab discriminant for the cycles listing — `"active"` (non-archived,
 * not yet completed) or `"all"`; persisted in localStorage under `cycle_tab`
 * by `apps/web/core/components/cycles/modal.tsx`.
 */
export type TCycleTabOptions = "active" | "all";

/**
 * Layout discriminant for the cycles listing: `"list"`, `"board"` (kanban),
 * or `"gantt"` (timeline view).
 */
export type TCycleLayoutOptions = "list" | "board" | "gantt";

/**
 * Display-filter shape for the cycles listing screen — controls how cycles are
 * presented (which tab is active, which layout is rendered).
 *
 * Both fields are optional because individual UI controls may set them independently.
 */
export type TCycleDisplayFilters = {
  active_tab?: TCycleTabOptions;
  layout?: TCycleLayoutOptions;
};

/**
 * Predicate filter shape: each field is OR-within / AND-across multi-select,
 * with `null` (vs. omitted) clearing the field while preserving the key
 * (date fields hold ISO-date tokens; `status` matches `ICycle.status`).
 */
export type TCycleFilters = {
  end_date?: string[] | null;
  start_date?: string[] | null;
  status?: string[] | null;
};

/**
 * Filter state partition keeping active-list (`default`) and archived-list
 * (`archived`) filters separate so each tab retains its own selections.
 */
export type TCycleFiltersByState = {
  default: TCycleFilters;
  archived: TCycleFilters;
};

/**
 * Persisted filter envelope written to local storage by
 * `apps/web/core/store/cycle_filter.store.ts` so that filter selections survive
 * page reloads and route changes.
 *
 * Both fields are optional so partial updates can be persisted without
 * overwriting the entire envelope.
 */
export type TCycleStoredFilters = {
  display_filters?: TCycleDisplayFilters;
  filters?: TCycleFilters;
};
