/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module filter contracts for the `@plane/types/module` subfolder.
 *
 * Defines the filter expression and display-preference shapes consumed by
 * `apps/web/core/store/module_filter.store.ts` to narrow and present the
 * modules listing — by status, member, lead, dates, favorite, and ordering.
 * The shape mirrors the issue filter pattern from `../view-props.ts` so that
 * the modules listing reuses the same UX vocabulary.
 *
 * Consumers:
 *   - `apps/web/core/store/module_filter.store.ts` — observable filter state per project
 *   - `apps/web/core/components/modules/applied-filters/` — chip-style filter display
 *   - `apps/web/core/components/modules/dropdowns/filters/` — filter dropdown UI
 */

/**
 * Sort-key discriminator for the modules listing. Each `-`-prefixed value is the
 * descending counterpart of its un-prefixed peer.
 *
 * - `name` / `-name` — alphabetical by module title.
 * - `progress` / `-progress` — by completion percentage.
 * - `issues_length` / `-issues_length` — by total issue count.
 * - `target_date` / `-target_date` — by scheduled target date.
 * - `created_at` / `-created_at` — by module creation timestamp.
 * - `sort_order` — by user-defined drag-reorder position (no descending pair;
 *    `sort_order` is always ascending so the user-defined sequence is honored).
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
 * Layout-mode discriminator for the modules listing:
 *
 * - `list` — table-style rows.
 * - `board` — kanban-style cards grouped by status.
 * - `gantt` — timeline view scaled by `start_date` / `target_date`.
 */
export type TModuleLayoutOptions = "list" | "board" | "gantt";

/**
 * View-presentation preferences for the modules listing — these control
 * **how** the list renders rather than **what** is in the list.
 *
 * Distinct from `TModuleFilters` (which narrows the result set) because changes
 * to display filters never trigger a server refetch; they only re-render the
 * already-loaded modules. All fields are optional so partial updates can be
 * applied via the `updateDisplayFilters` action in `module_filter.store.ts`.
 */
export type TModuleDisplayFilters = {
  favorites?: boolean;
  layout?: TModuleLayoutOptions;
  order_by?: TModuleOrderByOptions;
};

/**
 * Predicate facets used to narrow the modules listing. Each field is a nullable
 * array of string ids (or status string values) where `null` / `undefined`
 * means "no filter on this facet" and an empty array means "match nothing".
 *
 * Field semantics:
 * - `lead` — module-lead user ids (matches `IModule.lead_id`).
 * - `members` — module-member user ids (matches `IModule.member_ids`).
 * - `start_date` / `target_date` — date-range filter tokens; the encoding
 *    (e.g., `"after:YYYY-MM-DD"`) is defined by the filter helpers in
 *    `apps/web/core/store/module_filter.store.ts`.
 * - `status` — one or more `TModuleStatus` string values (intentionally typed
 *    `string[]` rather than `TModuleStatus[]` because the filter UI may store
 *    transient unknown values).
 */
export type TModuleFilters = {
  lead?: string[] | null;
  members?: string[] | null;
  start_date?: string[] | null;
  status?: string[] | null;
  target_date?: string[] | null;
};

/**
 * Pair of filter sets keyed by the listing's view mode — `default` for the
 * active modules tab and `archived` for the archived modules tab.
 *
 * The split exists so that filters applied while viewing archived modules
 * do not leak into the active view on tab switch (and vice versa).
 */
export type TModuleFiltersByState = {
  default: TModuleFilters;
  archived: TModuleFilters;
};

/**
 * Persisted filter envelope used when serializing module filter state to
 * client-side storage (localStorage / IndexedDB via the store's persistence layer).
 * Combines display preferences and predicate facets so both round-trip together
 * and the listing rehydrates to the user's last view on page reload.
 */
export type TModuleStoredFilters = {
  display_filters?: TModuleDisplayFilters;
  filters?: TModuleFilters;
};
