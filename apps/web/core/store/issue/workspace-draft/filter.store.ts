/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX filter store for workspace-draft issues. Extends `IssueFilterHelperStore`
 * to reuse normalization (`computedIssueFilters`, `computedDisplayFilters`,
 * `computedDisplayProperties`), applied-filter computation (`computedFilteredParams`),
 * pagination parameter construction (`getPaginationParams`), and the
 * `issue_local_filters` `localStorage`-backed persistence helper
 * (`handleIssuesLocalFilters`). Owns the per-workspace filter state used by the
 * workspace-draft list experience.
 *
 * State slice (observables):
 *   - `workspaceSlug: string` — active workspace slug; default `""` (`observable.ref`).
 *   - `filters: { [userId: string]: IIssueFilters }` — per-workspace snapshot keyed by
 *     `workspaceSlug` (the workspaceSlug doubles as the userId-discriminant key); holds
 *     `richFilters`, `displayFilters`, `displayProperties`, and `kanbanFilters` for each
 *     workspace (`observable`).
 *   - `rootIssueStore: IIssueRootStore` — back-reference assigned in the constructor; not
 *     registered as observable. Provides reactive access to `rootIssueStore.workspaceSlug`
 *     and cross-store reads.
 *   - `issueFilterService: IssueFiltersService` — instantiated in the constructor; not
 *     registered as observable.
 *
 * Computed:
 *   - `issueFilters` — derives the full `IIssueFilters` object for
 *     `rootIssueStore.workspaceSlug` via `getIssueFilters`; recomputes when `filters` or
 *     `rootIssueStore.workspaceSlug` change.
 *   - `appliedFilters` — derives the route-ready
 *     `Partial<Record<TIssueParams, string | boolean>>` for the active workspace via
 *     `getAppliedFilters` → `computedFilteredParams`; recomputes when `issueFilters` change.
 *   - `getFilterParams(options, userId, cursor, groupId, subGroupId)` — `computedFn`
 *     factory that calls `getAppliedFilters(this.workspaceSlug)` and merges the result into
 *     the inherited `getPaginationParams`; memoized per
 *     `(options, userId, cursor, groupId, subGroupId)` tuple.
 *
 * Helper methods (not registered as actions/computed):
 *   - `getIssueFilters(workspaceSlug)` — pulls the persisted `IIssueFilters` for the
 *     workspace and normalizes it through the inherited `computedIssueFilters`.
 *   - `getAppliedFilters(workspaceSlug)` — selects the route-param subset for the current
 *     layout via `handleIssueQueryParamsByLayout(..., "profile_issues")` and reconciles
 *     rich/display filters into route params via `computedFilteredParams`.
 *
 * Actions:
 *   - `fetchFilters(workspaceSlug)` — sets `this.workspaceSlug`, loads persisted
 *     `richFilters`, `displayFilters`, `displayProperties`, and `kanbanFilters` from local
 *     storage via `handleIssuesLocalFilters.get(EIssuesStoreType.PROFILE, …)`, normalizes
 *     each shape through the inherited `computedDisplayFilters` / `computedDisplayProperties`
 *     helpers, and commits the four fields into `this.filters[workspaceSlug]` inside a
 *     `runInAction`. No API calls — purely localStorage hydration.
 *   - `updateFilterExpression(workspaceSlug, userId, filters)` — replaces
 *     `this.filters[workspaceSlug].richFilters` inside `runInAction`, calls
 *     `rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(workspaceSlug,
 *     workspaceSlug, "mutation")` to refresh listings, and persists the new rich filters via
 *     `handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, EIssueFilterType.FILTERS, …)`.
 *     Errors are logged and re-thrown.
 *   - `updateFilters(workspaceSlug, type, filters)` — switches on `type`:
 *       - `DISPLAY_FILTERS`: merges the partial into `_filters.displayFilters` and enforces
 *         the kanban layout invariants — clears `sub_group_by` when `group_by` is `null`,
 *         clears `sub_group_by` when it equals `group_by` under the kanban layout, defaults
 *         `group_by` to `"priority"` when kanban + `group_by` is `null`. Commits each
 *         updated key into `this.filters[workspaceSlug].displayFilters` inside `runInAction`,
 *         triggers `rootIssueStore.profileIssues.fetchIssuesWithExistingPagination`
 *         (`"mutation"` reason), then persists via `handleIssuesLocalFilters.set`.
 *       - `DISPLAY_PROPERTIES`: merges the partial into `_filters.displayProperties` and
 *         commits each updated key inside `runInAction`, then persists via
 *         `handleIssuesLocalFilters.set`. Does NOT refresh `profileIssues`.
 *       - Other types: no-op.
 *     On error, re-hydrates via `fetchFilters(workspaceSlug)` to recover from a partial
 *     mutation, then re-throws.
 *
 * Cross-store dependencies:
 *   - Reads `rootIssueStore.workspaceSlug` in the `issueFilters` and `appliedFilters`
 *     computed getters to keep the surface reactive to the active route.
 *   - Calls `rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(...)` after
 *     rich-filter or display-filter mutations to keep the issue list in sync.
 *   - Uses the inherited `handleIssuesLocalFilters` helper (from `IssueFilterHelperStore`)
 *     for `issue_local_filters` `localStorage` persistence.
 *
 * Consumers:
 *   - `apps/web/core/hooks/store/workspace-draft/use-workspace-draft-issue-filters.ts` —
 *     typed hook returning `context.issue.workspaceDraftIssuesFilter` from `StoreContext`.
 *   - `apps/web/core/components/issues/workspace-draft/**` — list, root, filter dropdowns,
 *     and applied-filters UI consume the computed `issueFilters` / `appliedFilters` and call
 *     `updateFilters` / `updateFilterExpression`.
 *   - Composed by `apps/web/core/store/issue/root.store.ts` as
 *     `workspaceDraftIssuesFilter` (instantiated alongside `WorkspaceDraftIssues`).
 */
// INTENT UNCLEAR: workspace-draft filters persist under the EIssuesStoreType.PROFILE namespace and refresh rootIssueStore.profileIssues instead of a dedicated workspace-draft store; observed but not derivable from naming alone.

import { isEmpty, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// Plane Imports
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import { EIssueFilterType } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  TIssueKanbanFilters,
  IIssueFilters,
  TIssueParams,
  IssuePaginationOptions,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
// services
import { IssueFiltersService } from "@/services/issue_filter.service";
// helpers
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// types
import type { IIssueRootStore } from "../root.store";

export interface IWorkspaceDraftIssuesFilter extends IBaseIssueFilterStore {
  // observables
  workspaceSlug: string;
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    userId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  // action
  fetchFilters: (workspaceSlug: string) => Promise<void>;
  updateFilterExpression: (workspaceSlug: string, userId: string, filters: TWorkItemFilterExpression) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
}

export class WorkspaceDraftIssuesFilter extends IssueFilterHelperStore implements IWorkspaceDraftIssuesFilter {
  // observables
  workspaceSlug: string = "";
  filters: { [userId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  issueFilterService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
      workspaceSlug: observable.ref,
      filters: observable,
      // computed
      issueFilters: computed,
      appliedFilters: computed,
      // actions
      fetchFilters: action,
      updateFilters: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.issueFilterService = new IssueFiltersService();
  }

  get issueFilters() {
    const workspaceSlug = this.rootIssueStore.workspaceSlug;
    if (!workspaceSlug) return undefined;

    return this.getIssueFilters(workspaceSlug);
  }

  get appliedFilters() {
    const workspaceSlug = this.rootIssueStore.workspaceSlug;
    if (!workspaceSlug) return undefined;

    return this.getAppliedFilters(workspaceSlug);
  }

  getIssueFilters(workspaceSlug: string) {
    const displayFilters = this.filters[workspaceSlug] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(workspaceSlug: string) {
    const userFilters = this.getIssueFilters(workspaceSlug);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "profile_issues");
    if (!filteredParams) return undefined;

    const filteredRouteParams: Partial<Record<TIssueParams, string | boolean>> = this.computedFilteredParams(
      userFilters?.richFilters,
      userFilters?.displayFilters,
      filteredParams
    );

    return filteredRouteParams;
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      userId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(this.workspaceSlug);

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string) => {
    this.workspaceSlug = workspaceSlug;
    const _filters = this.handleIssuesLocalFilters.get(
      EIssuesStoreType.PROFILE,
      workspaceSlug,
      workspaceSlug,
      undefined
    );

    const richFilters: TWorkItemFilterExpression = _filters?.rich_filters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters(_filters?.display_filters);
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(_filters?.display_properties);
    const kanbanFilters = {
      group_by: _filters?.kanban_filters?.group_by || [],
      sub_group_by: _filters?.kanban_filters?.sub_group_by || [],
    };

    runInAction(() => {
      set(this.filters, [workspaceSlug, "richFilters"], richFilters);
      set(this.filters, [workspaceSlug, "displayFilters"], displayFilters);
      set(this.filters, [workspaceSlug, "displayProperties"], displayProperties);
      set(this.filters, [workspaceSlug, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IWorkspaceDraftIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    userId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [workspaceSlug, "richFilters"], filters);
      });

      this.rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(workspaceSlug, workspaceSlug, "mutation");
      this.handleIssuesLocalFilters.set(
        EIssuesStoreType.PROFILE,
        EIssueFilterType.FILTERS,
        workspaceSlug,
        workspaceSlug,
        undefined,
        {
          rich_filters: filters,
        }
      );
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IWorkspaceDraftIssuesFilter["updateFilters"] = async (workspaceSlug, type, filters) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[workspaceSlug])) return;

      const _filters = {
        richFilters: this.filters[workspaceSlug].richFilters,
        displayFilters: this.filters[workspaceSlug].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[workspaceSlug].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[workspaceSlug].kanbanFilters as TIssueKanbanFilters,
      };

      switch (type) {
        case EIssueFilterType.DISPLAY_FILTERS: {
          const updatedDisplayFilters = filters as IIssueDisplayFilterOptions;
          _filters.displayFilters = { ..._filters.displayFilters, ...updatedDisplayFilters };

          // set sub_group_by to null if group_by is set to null
          if (_filters.displayFilters.group_by === null) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set sub_group_by to null if layout is switched to kanban group_by and sub_group_by are same
          if (
            _filters.displayFilters.layout === "kanban" &&
            _filters.displayFilters.group_by === _filters.displayFilters.sub_group_by
          ) {
            _filters.displayFilters.sub_group_by = null;
            updatedDisplayFilters.sub_group_by = null;
          }
          // set group_by to priority if layout is switched to kanban and group_by is null
          if (_filters.displayFilters.layout === "kanban" && _filters.displayFilters.group_by === null) {
            _filters.displayFilters.group_by = "priority";
            updatedDisplayFilters.group_by = "priority";
          }

          runInAction(() => {
            Object.keys(updatedDisplayFilters).forEach((_key) => {
              set(
                this.filters,
                [workspaceSlug, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          this.rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(workspaceSlug, workspaceSlug, "mutation");

          this.handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, type, workspaceSlug, workspaceSlug, undefined, {
            display_filters: _filters.displayFilters,
          });

          break;
        }
        case EIssueFilterType.DISPLAY_PROPERTIES: {
          const updatedDisplayProperties = filters as IIssueDisplayProperties;
          _filters.displayProperties = { ..._filters.displayProperties, ...updatedDisplayProperties };

          runInAction(() => {
            Object.keys(updatedDisplayProperties).forEach((_key) => {
              set(
                this.filters,
                [workspaceSlug, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          this.handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, type, workspaceSlug, workspaceSlug, undefined, {
            display_properties: _filters.displayProperties,
          });
          break;
        }

        default:
          break;
      }
    } catch (error) {
      if (workspaceSlug) this.fetchFilters(workspaceSlug);
      throw error;
    }
  };
}
