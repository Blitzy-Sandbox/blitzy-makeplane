/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle filter contracts for the `@plane/types/cycle` subfolder.
 *
 * Defines the tab, layout, and predicate shapes that `apps/web/core/store/cycle_filter.store.ts`
 * uses to narrow the cycles listing — by tab (active / all), layout (list / board / gantt),
 * status, and date ranges. Mirrors the filter pattern used for issues in `../view-props.ts`.
 *
 * Consumers:
 * - `apps/web/core/store/cycle_filter.store.ts`
 * - `apps/web/core/components/cycles/applied-filters/**`
 * - `apps/web/core/components/cycles/dropdowns/filters/**`
 * - `apps/web/core/components/cycles/cycles-view-header.tsx`
 */

/**
 * Tab discriminant for the cycles listing screen.
 *
 * - `"active"` — show cycles that are not archived and not yet completed (default tab).
 * - `"all"` — show every cycle in the project regardless of lifecycle.
 *
 * Persisted in local storage by `apps/web/core/components/cycles/modal.tsx`
 * under the `cycle_tab` key.
 */
export type TCycleTabOptions = "active" | "all";

/**
 * Layout discriminant for the cycles listing screen.
 *
 * - `"list"` — vertical list view.
 * - `"board"` — kanban-style grouping.
 * - `"gantt"` — timeline / Gantt chart view across the project's cycles.
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
 * Predicate filter shape for the cycles listing screen.
 *
 * Each field is a multi-select list applied as a logical OR within a field and
 * AND across fields. `null` (vs. omitted) clears the field while preserving the key.
 *
 * Field semantics:
 * - `end_date`: ISO-date tokens; matches cycles whose `end_date` is within any of the listed ranges.
 * - `start_date`: ISO-date tokens; matches cycles whose `start_date` is within any of the listed ranges.
 * - `status`: lifecycle group tokens (e.g., `"current" | "upcoming" | "completed" | "draft"`)
 *   matched against the server-computed `ICycle.status`.
 */
export type TCycleFilters = {
  end_date?: string[] | null;
  start_date?: string[] | null;
  status?: string[] | null;
};

/**
 * Filter state partition for the cycles listing — keeps the active-list filters
 * separate from the archived-list filters so each tab retains its own selections.
 *
 * - `default`: filters applied to the live (non-archived) cycles listing.
 * - `archived`: filters applied to the archived-cycles listing.
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
