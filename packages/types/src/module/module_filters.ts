/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module filter and display-preference contracts consumed by
 * `apps/web/core/store/module_filter.store.ts` and the components under
 * `apps/web/core/components/modules/applied-filters/` and `dropdowns/filters/`.
 */

/**
 * Sort-key discriminator for the modules listing; `-`-prefixed values are
 * descending counterparts of their un-prefixed peers, and `sort_order` is the
 * user-defined drag-reorder position (ascending only).
 */
export type TModuleOrderByOptions =
  | "name"
  | "-name"
  | "progress"
  | "-progress"
  | "issues_length"
  | "-issues_length"
  | "target_date"
  | "-target_date"
  | "created_at"
  | "-created_at"
  | "sort_order";

/**
 * Layout-mode discriminator for the modules listing: `list` (table rows),
 * `board` (kanban by status), or `gantt` (timeline by date range).
 */
export type TModuleLayoutOptions = "list" | "board" | "gantt";

/**
 * View-presentation preferences (HOW the list renders); distinct from
 * `TModuleFilters` since changes here never trigger a server refetch.
 */
export type TModuleDisplayFilters = {
  favorites?: boolean;
  layout?: TModuleLayoutOptions;
  order_by?: TModuleOrderByOptions;
};

/**
 * Predicate facets narrowing the modules listing; `null`/`undefined` means
 * "no filter on this facet" while an empty array means "match nothing".
 * `status` is typed `string[]` (not `TModuleStatus[]`) because the filter UI
 * may transiently store unknown values.
 */
export type TModuleFilters = {
  lead?: string[] | null;
  members?: string[] | null;
  start_date?: string[] | null;
  status?: string[] | null;
  target_date?: string[] | null;
};

/**
 * Pair of filter sets keyed by listing tab (`default` vs `archived`) so
 * filters applied in one tab do not leak into the other on switch.
 */
export type TModuleFiltersByState = {
  default: TModuleFilters;
  archived: TModuleFilters;
};

/**
 * Persisted filter envelope serialized to client-side storage so the listing
 * rehydrates to the user's last view on reload.
 */
export type TModuleStoredFilters = {
  display_filters?: TModuleDisplayFilters;
  filters?: TModuleFilters;
};
