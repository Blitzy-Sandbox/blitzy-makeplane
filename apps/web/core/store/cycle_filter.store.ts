/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle filter store — project-scoped cycle filter, display, and search state
 * that feeds `cycle.store.ts`'s filtered-cycle selectors. Filter/display state
 * is keyed by `projectId` so multiple projects can hold independent UI state in
 * a single MobX root, and search/filter inputs are read cross-store by
 * `getFilteredCycleIds`, `getFilteredCompletedCycleIds`, and
 * `getFilteredArchivedCycleIds` in `cycle.store.ts`.
 *
 * Persistence: in-memory only. No `localStorage`, `sessionStorage`, or API
 * persistence is performed — all state resets on page reload. A constructor
 * `reaction` on `rootStore.router.projectId` re-initializes the active
 * project's display/filter slots and clears `searchQuery` on route change;
 * `archivedCyclesSearchQuery` is intentionally retained across route changes.
 *
 * State slice (observables):
 *   - `displayFilters: Record<projectId, TCycleDisplayFilters>` — per-project
 *     `active_tab` (`"active" | "completed" | ...`) and `layout`
 *     (`"list" | "board" | "gantt" | ...`) UI selections. Default on first
 *     visit: `{ active_tab: "active", layout: "list" }`.
 *   - `filters: Record<projectId, TCycleFiltersByState>` — per-project filter
 *     payload split into two state buckets: `default` (active/completed cycles
 *     view) and `archived` (archived cycles view).
 *   - `searchQuery: string` (`observable.ref`) — text search applied to the
 *     active/completed cycles lists. Reset to `""` whenever the route
 *     `projectId` changes.
 *   - `archivedCyclesSearchQuery: string` (`observable.ref`) — text search
 *     applied to the archived cycles list. Retained across `projectId`
 *     changes.
 *
 * Actions:
 *   - `updateDisplayFilters(projectId, displayFilters)` — merges each key of
 *     `displayFilters` into `this.displayFilters[projectId]` via `lodash.set`.
 *     Pure local mutation (no API call).
 *   - `updateFilters(projectId, filters, state = "default")` — merges each key
 *     of `filters` into `this.filters[projectId][state]`. `state` selects the
 *     `default` or `archived` bucket. Pure local mutation.
 *   - `updateSearchQuery(query)` — assigns `this.searchQuery = query` (active
 *     cycles search).
 *   - `updateArchivedCyclesSearchQuery(query)` — assigns
 *     `this.archivedCyclesSearchQuery = query` (archived cycles search).
 *   - `clearAllFilters(projectId, state = "default")` — resets
 *     `this.filters[projectId][state]` to `{}`. Does not touch
 *     `displayFilters` or search queries.
 *   - `initProjectCycleFilters(projectId)` — internal helper invoked by the
 *     `projectId` reaction; seeds default `displayFilters[projectId]` and an
 *     empty `filters[projectId]` slot when missing. Not part of the public
 *     interface but called whenever the active route project changes.
 *
 * Computed:
 *   - `currentProjectDisplayFilters` — display filters for the route's current
 *     `projectId`; recomputes when `rootStore.router.projectId` or the
 *     corresponding `displayFilters[projectId]` entry changes.
 *   - `currentProjectFilters` — `default`-state filters for the route's
 *     current `projectId`; recomputes on the same conditions, falling back to
 *     `{}` when uninitialized.
 *   - `currentProjectArchivedFilters` — `archived`-state filters for the
 *     route's current `projectId`; recomputes on the same conditions.
 *
 * Computed functions (`computedFn` from `mobx-utils`, memoized per argument):
 *   - `getDisplayFiltersByProjectId(projectId)` — display filters for any
 *     project id (memoized per `projectId`).
 *   - `getFiltersByProjectId(projectId)` — `default`-state filters for any
 *     project id, falling back to `{}` (memoized per `projectId`).
 *   - `getArchivedFiltersByProjectId(projectId)` — `archived`-state filters
 *     for any project id (memoized per `projectId`).
 *
 * Consumers (cross-store):
 *   - `apps/web/core/store/cycle.store.ts` — `getFilteredCycleIds`,
 *     `getFilteredCompletedCycleIds`, and `getFilteredArchivedCycleIds`
 *     computedFns read `getFiltersByProjectId` / `getArchivedFiltersByProjectId`
 *     plus `searchQuery` / `archivedCyclesSearchQuery` to produce the visible
 *     cycle id lists.
 *
 * Consumers (components, via `useCycleFilter()` in
 * `apps/web/core/hooks/store/use-cycle-filter.ts`):
 *   - `apps/web/core/components/cycles/cycles-view-header.tsx`,
 *     `cycles-view.tsx` (active cycles list header + search/filter
 *     application)
 *   - `apps/web/core/components/cycles/archived-cycles/{view,root,header}.tsx`
 *     (archived cycles view)
 *   - `apps/web/core/components/cycles/applied-filters/**` and
 *     `apps/web/core/components/cycles/dropdowns/filters/**` (filter UI fed
 *     from parents that read this store)
 *   - `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/cycles/(list)/{page,mobile-header}.tsx`
 *     (cycles list route, including the responsive mobile header)
 */

import { set } from "lodash-es";
import { action, computed, observable, makeObservable, runInAction, reaction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { TCycleDisplayFilters, TCycleFilters, TCycleFiltersByState } from "@plane/types";
// store
import type { CoreRootStore } from "./root.store";

export interface ICycleFilterStore {
  // observables
  displayFilters: Record<string, TCycleDisplayFilters>;
  filters: Record<string, TCycleFiltersByState>;
  searchQuery: string;
  archivedCyclesSearchQuery: string;
  // computed
  currentProjectDisplayFilters: TCycleDisplayFilters | undefined;
  currentProjectFilters: TCycleFilters | undefined;
  currentProjectArchivedFilters: TCycleFilters | undefined;
  // computed functions
  getDisplayFiltersByProjectId: (projectId: string) => TCycleDisplayFilters | undefined;
  getFiltersByProjectId: (projectId: string) => TCycleFilters | undefined;
  getArchivedFiltersByProjectId: (projectId: string) => TCycleFilters | undefined;
  // actions
  updateDisplayFilters: (projectId: string, displayFilters: TCycleDisplayFilters) => void;
  updateFilters: (projectId: string, filters: TCycleFilters, state?: keyof TCycleFiltersByState) => void;
  updateSearchQuery: (query: string) => void;
  updateArchivedCyclesSearchQuery: (query: string) => void;
  clearAllFilters: (projectId: string, state?: keyof TCycleFiltersByState) => void;
}

export class CycleFilterStore implements ICycleFilterStore {
  // observables
  displayFilters: Record<string, TCycleDisplayFilters> = {};
  filters: Record<string, TCycleFiltersByState> = {};
  searchQuery: string = "";
  archivedCyclesSearchQuery: string = "";
  // root store
  rootStore: CoreRootStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      displayFilters: observable,
      filters: observable,
      searchQuery: observable.ref,
      archivedCyclesSearchQuery: observable.ref,
      // computed
      currentProjectDisplayFilters: computed,
      currentProjectFilters: computed,
      currentProjectArchivedFilters: computed,
      // actions
      updateDisplayFilters: action,
      updateFilters: action,
      updateSearchQuery: action,
      updateArchivedCyclesSearchQuery: action,
      clearAllFilters: action,
    });
    // root store
    this.rootStore = _rootStore;
    // initialize display filters of the current project
    reaction(
      () => this.rootStore.router.projectId,
      (projectId) => {
        if (!projectId) return;
        this.initProjectCycleFilters(projectId);
        this.searchQuery = "";
      }
    );
  }

  /**
   * @description get display filters of the current project
   */
  get currentProjectDisplayFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.displayFilters[projectId];
  }

  /**
   * @description get filters of the current project
   */
  get currentProjectFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.filters[projectId]?.default ?? {};
  }

  /**
   * @description get archived filters of the current project
   */
  get currentProjectArchivedFilters() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return;
    return this.filters[projectId].archived;
  }

  /**
   * @description get display filters of a project by projectId
   * @param {string} projectId
   */
  getDisplayFiltersByProjectId = computedFn((projectId: string) => this.displayFilters[projectId]);

  /**
   * @description get filters of a project by projectId
   * @param {string} projectId
   */
  getFiltersByProjectId = computedFn((projectId: string) => this.filters[projectId]?.default ?? {});

  /**
   * @description get archived filters of a project by projectId
   * @param {string} projectId
   */
  getArchivedFiltersByProjectId = computedFn((projectId: string) => this.filters[projectId].archived);

  /**
   * @description initialize display filters and filters of a project
   * @param {string} projectId
   */
  initProjectCycleFilters = (projectId: string) => {
    const displayFilters = this.getDisplayFiltersByProjectId(projectId);
    runInAction(() => {
      this.displayFilters[projectId] = {
        active_tab: displayFilters?.active_tab || "active",
        layout: displayFilters?.layout || "list",
      };
      this.filters[projectId] = this.filters[projectId] ?? {
        default: {},
        archived: {},
      };
    });
  };

  /**
   * @description update display filters of a project
   * @param {string} projectId
   * @param {TCycleDisplayFilters} displayFilters
   */
  updateDisplayFilters = (projectId: string, displayFilters: TCycleDisplayFilters) => {
    runInAction(() => {
      Object.keys(displayFilters).forEach((key) => {
        set(this.displayFilters, [projectId, key], displayFilters[key as keyof TCycleDisplayFilters]);
      });
    });
  };

  /**
   * @description update filters of a project
   * @param {string} projectId
   * @param {TCycleFilters} filters
   */
  updateFilters = (projectId: string, filters: TCycleFilters, state: keyof TCycleFiltersByState = "default") => {
    runInAction(() => {
      Object.keys(filters).forEach((key) => {
        set(this.filters, [projectId, state, key], filters[key as keyof TCycleFilters]);
      });
    });
  };

  /**
   * @description update search query
   * @param {string} query
   */
  updateSearchQuery = (query: string) => (this.searchQuery = query);

  /**
   * @description update archived search query
   * @param {string} query
   */
  updateArchivedCyclesSearchQuery = (query: string) => (this.archivedCyclesSearchQuery = query);

  /**
   * @description clear all filters of a project
   * @param {string} projectId
   */
  clearAllFilters = (projectId: string, state: keyof TCycleFiltersByState = "default") => {
    runInAction(() => {
      this.filters[projectId][state] = {};
    });
  };
}
