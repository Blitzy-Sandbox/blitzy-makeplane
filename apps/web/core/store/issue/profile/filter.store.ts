/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Profile-scoped MobX filter store backing the `/profile/[userId]` work-item
 * views; extends `IssueFilterHelperStore` (`../helpers/issue-filter-helper.store`)
 * so the profile context reuses the shared rich/display/property/kanban
 * normalization, layout-aware param derivation, and local-storage helpers
 * (`computedIssueFilters`, `computedFilteredParams`, `computedDisplayFilters`,
 * `computedDisplayProperties`, `getPaginationParams`, `handleIssuesLocalFilters`)
 * used by the project / cycle / module filter stores. Specialization: filter
 * snapshots are keyed by `userId` (the profile being viewed) rather than by
 * project / cycle / module identifier.
 *
 * State slice:
 *   - userId (observable.ref): string — currently-loaded profile user id,
 *       assigned during fetchFilters; defaults to "".
 *   - filters (observable): { [userId]: IIssueFilters } — per-user filter
 *       snapshots keyed by the profile being viewed; each snapshot owns
 *       richFilters, displayFilters, displayProperties, and kanbanFilters.
 *   - rootIssueStore: IIssueRootStore — used to trigger downstream refetches
 *       via rootIssueStore.profileIssues.fetchIssuesWithExistingPagination.
 *   - issueFilterService: IssueFiltersService — retained service instance;
 *       the current profile path persists exclusively through local storage,
 *       so this is held for future remote-persistence parity.
 *
 * Computed:
 *   - issueFilters (computed): normalized IIssueFilters for the active
 *       root-store user via getIssueFilters(rootIssueStore.userId);
 *       recomputes when rootIssueStore.userId or filters[userId] change.
 *   - appliedFilters (computed): layout-aware query params for the active
 *       root-store user derived via handleIssueQueryParamsByLayout under the
 *       route key "profile_issues" and the inherited computedFilteredParams;
 *       recomputes when the underlying issueFilters observables change.
 *   - getFilterParams (computedFn from mobx-utils): parameterized derivation
 *       of pagination params over (options, userId, cursor, groupId, subGroupId);
 *       memoized per argument tuple and invalidated when the upstream
 *       appliedFilters for `userId` change. The `userId` argument is the
 *       profile being filtered and may differ from rootIssueStore.userId when
 *       a viewer reads another user's profile.
 *
 * Helper accessors (not part of makeObservable, invoked by the computed
 * getters and by external consumers):
 *   - getIssueFilters(userId): resolves the per-user IIssueFilters snapshot or
 *       undefined when the snapshot is empty.
 *   - getAppliedFilters(userId): derives the layout-applicable param set or
 *       undefined when there are no filters or no layout-matched params.
 *
 * Actions:
 *   - fetchFilters(workspaceSlug, userId) (action): hydrates the user's
 *       filter snapshot from local storage scoped to EIssuesStoreType.PROFILE,
 *       normalizes display filters and display properties through the
 *       inherited helpers, and writes all four sub-slices in a single
 *       runInAction. No network call (profile filters live in browser
 *       local storage only).
 *   - updateFilterExpression(workspaceSlug, userId, filters): writes the
 *       user's richFilters, triggers a refetch of the paired profileIssues
 *       store, and persists to local storage under EIssuesStoreType.PROFILE
 *       + EIssueFilterType.FILTERS. See the in-source note above the method
 *       declaration for the work-item-filter-store fallback rationale.
 *   - updateFilters(workspaceSlug, projectId, filterType, filters, userId)
 *       (action): dispatches on filterType — DISPLAY_FILTERS applies kanban-
 *       aware normalization (nullifies sub_group_by when group_by is null or
 *       when layout is kanban with matching group_by/sub_group_by, and
 *       defaults group_by to "priority" when layout is kanban and group_by
 *       is null), mutates observables key-by-key, refetches via the paired
 *       profileIssues store, and persists; DISPLAY_PROPERTIES persists
 *       without refetch (display properties do not affect query params);
 *       KANBAN_FILTERS persists when rootIssueStore.currentUserId is set
 *       and never refetches (kanban filters are client-side display state).
 *       On any error, rehydrates from storage via fetchFilters and rethrows.
 *
 * Storage scope: all local-storage reads/writes pass EIssuesStoreType.PROFILE
 * as the namespace discriminant, isolating profile filter state from
 * project / cycle / module filter state in the shared `issue_local_filters`
 * localStorage key.
 *
 * Side effects:
 *   - Observable mutations on userId and filters[userId].{richFilters,
 *     displayFilters, displayProperties, kanbanFilters}.
 *   - Local-storage reads/writes under EIssuesStoreType.PROFILE on every
 *     successful updateFilters / updateFilterExpression call.
 *   - Downstream refetch via
 *     rootIssueStore.profileIssues.fetchIssuesWithExistingPagination after
 *     rich-filter or display-filter updates.
 *   - No remote network calls in the current code path.
 *
 * Consumers:
 *   - apps/web/core/components/profile/profile-issues-filter.tsx
 *     (renders the profile filter UI via useIssues(EIssuesStoreType.PROFILE)).
 *   - apps/web/core/components/profile/profile-issues.tsx
 *     (reads applied filters via useIssues(EIssuesStoreType.PROFILE)).
 *   - apps/web/core/hooks/use-issues-actions.tsx
 *     (profile filter dispatch site under EIssuesStoreType.PROFILE).
 *   - apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/mobile-header.tsx
 *     (mobile profile filter UI).
 *   - ./issue.store.ts (paired ProfileIssues store reads getFilterParams
 *     during fetchIssues / fetchNextIssues).
 *   - Composed in apps/web/core/store/issue/root.store.ts as
 *     rootIssueStore.profileIssuesFilter and injected into ProfileIssues.
 *
 * Preset filter semantics: profile views map to user-scoped lists
 * (assigned / created / subscribed / all-issues) via discriminants in the
 * paired ./issue.store.ts; this store accepts arbitrary filter mutations
 * and any "preset readonly" constraint is enforced at the consumer layer
 * rather than inside this class.
 */

import { isEmpty, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// base class
import { computedFn } from "mobx-utils";
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
import { IssueFiltersService } from "@/services/issue_filter.service";
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
// constants
// services

export interface IProfileIssuesFilter extends IBaseIssueFilterStore {
  // observables
  userId: string;
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    userId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  // action
  fetchFilters: (workspaceSlug: string, userId: string) => Promise<void>;
  updateFilterExpression: (workspaceSlug: string, userId: string, filters: TWorkItemFilterExpression) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string | undefined,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate,
    userId: string
  ) => Promise<void>;
}

export class ProfileIssuesFilter extends IssueFilterHelperStore implements IProfileIssuesFilter {
  // observables
  userId: string = "";
  filters: { [userId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  issueFilterService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
      userId: observable.ref,
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
    const userId = this.rootIssueStore.userId;
    if (!userId) return undefined;

    return this.getIssueFilters(userId);
  }

  get appliedFilters() {
    const userId = this.rootIssueStore.userId;
    if (!userId) return undefined;

    return this.getAppliedFilters(userId);
  }

  getIssueFilters(userId: string) {
    const displayFilters = this.filters[userId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(userId: string) {
    const userFilters = this.getIssueFilters(userId);
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
      const filterParams = this.getAppliedFilters(userId);

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, userId: string) => {
    this.userId = userId;
    const _filters = this.handleIssuesLocalFilters.get(EIssuesStoreType.PROFILE, workspaceSlug, userId, undefined);

    const richFilters: TWorkItemFilterExpression = _filters?.rich_filters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters(_filters?.display_filters);
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(_filters?.display_properties);
    const kanbanFilters = {
      group_by: _filters?.kanban_filters?.group_by || [],
      sub_group_by: _filters?.kanban_filters?.sub_group_by || [],
    };

    runInAction(() => {
      set(this.filters, [userId, "richFilters"], richFilters);
      set(this.filters, [userId, "displayFilters"], displayFilters);
      set(this.filters, [userId, "displayProperties"], displayProperties);
      set(this.filters, [userId, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IProfileIssuesFilter["updateFilterExpression"] = async (workspaceSlug, userId, filters) => {
    try {
      runInAction(() => {
        set(this.filters, [userId, "richFilters"], filters);
      });

      this.rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(workspaceSlug, userId, "mutation");
      this.handleIssuesLocalFilters.set(
        EIssuesStoreType.PROFILE,
        EIssueFilterType.FILTERS,
        workspaceSlug,
        userId,
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

  updateFilters: IProfileIssuesFilter["updateFilters"] = async (workspaceSlug, _projectId, type, filters, userId) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[userId])) return;

      const _filters = {
        richFilters: this.filters[userId].richFilters,
        displayFilters: this.filters[userId].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[userId].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[userId].kanbanFilters as TIssueKanbanFilters,
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
                [userId, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          this.rootIssueStore.profileIssues.fetchIssuesWithExistingPagination(workspaceSlug, userId, "mutation");

          this.handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, type, workspaceSlug, userId, undefined, {
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
                [userId, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          this.handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, type, workspaceSlug, userId, undefined, {
            display_properties: _filters.displayProperties,
          });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.PROFILE, type, workspaceSlug, userId, undefined, {
              kanban_filters: _filters.kanbanFilters,
            });

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [userId, "kanbanFilters", _key],
                updatedKanbanFilters[_key as keyof TIssueKanbanFilters]
              );
            });
          });

          break;
        }
        default:
          break;
      }
    } catch (error) {
      if (userId) this.fetchFilters(workspaceSlug, userId);
      throw error;
    }
  };
}
