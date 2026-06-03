/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Archived issues filter store — per-project filter state for the archived
 * work-items view. Extends `IssueFilterHelperStore` (from
 * ../helpers/issue-filter-helper.store) to inherit filter normalization
 * (`computedIssueFilters`, `computedDisplayFilters`,
 * `computedDisplayProperties`), applied-param derivation
 * (`computedFilteredParams`), pagination-param composition
 * (`getPaginationParams`), and the `handleIssuesLocalFilters` wrapper around
 * `localStorage` — specialized for the `EIssuesStoreType.ARCHIVED` scope.
 *
 * Persistence model:
 *   Archived filter state is hydrated and written EXCLUSIVELY through
 *   `handleIssuesLocalFilters` against the `EIssuesStoreType.ARCHIVED` scope
 *   so its localStorage keys stay isolated from cycle/module/project/profile
 *   filter stores on the same browser. There is no backend write path on
 *   this store; `issueFilterService` is instantiated for parity with
 *   sibling filter stores but is not invoked by any archived flow.
 *
 * State slice (registered in `makeObservable`):
 *   - filters: { [projectId: string]: IIssueFilters }
 *       Per-project bag holding `richFilters: TWorkItemFilterExpression`,
 *       `displayFilters: IIssueDisplayFilterOptions`,
 *       `displayProperties: IIssueDisplayProperties`,
 *       `kanbanFilters: TIssueKanbanFilters`. Keyed by `projectId`; mutated
 *       via lodash `set` paths inside `runInAction`.
 *
 * References (NOT observable):
 *   - rootIssueStore: IIssueRootStore — injected via the constructor;
 *       consulted for the current `projectId`, the `currentUserId` used to
 *       scope kanban-filter persistence, and the companion `archivedIssues`
 *       store used to refetch after filter mutations.
 *   - issueFilterService: IssueFiltersService — instantiated for parity with
 *       sibling filter stores; the archived flow currently hydrates only
 *       from localStorage and does not invoke this service.
 *
 * Computed (registered in `makeObservable`):
 *   - issueFilters: IIssueFilters | undefined
 *       Current-project normalized filters; resolves
 *       `rootIssueStore.projectId` and delegates to `getIssueFilters`.
 *       Recomputes when `filters` or `rootIssueStore.projectId` changes.
 *   - appliedFilters: Partial<Record<TIssueParams, string | boolean>> | undefined
 *       Query-param-ready derivation of `issueFilters` for the current
 *       layout via `handleIssueQueryParamsByLayout(layout, "issues")` +
 *       `computedFilteredParams`. Recomputes when `filters` or
 *       `rootIssueStore.projectId` changes.
 *
 * Memoized helpers (`computedFn` from `mobx-utils` — NOT registered in `makeObservable`):
 *   - getFilterParams(options, projectId, cursor, groupId, subGroupId)
 *       `computedFn` factory composing `getAppliedFilters(projectId)` with
 *       the inherited `getPaginationParams` to build paginated request
 *       params. Memoized per-argument-tuple; recomputes when its argument
 *       tuple or `filters` changes. Consumed by the companion
 *       `ArchivedIssues.fetchIssues` / `fetchNextIssues`.
 *
 * Other public helpers (NOT in `makeObservable`):
 *   - getIssueFilters(projectId) — returns the normalized `IIssueFilters`
 *       for `projectId`, or `undefined` if the slot is missing/empty.
 *   - getAppliedFilters(projectId) — backbone of the `appliedFilters`
 *       computed getter; returns `undefined` when filters are absent or
 *       the layout is not recognized.
 *
 * Actions:
 *   - fetchFilters(workspaceSlug, projectId) — registered as `action`.
 *       Hydrates the archived slot for `projectId` from
 *       `handleIssuesLocalFilters.get(EIssuesStoreType.ARCHIVED, …)`.
 *       ARCHIVED-SPECIFIC: always forces `displayFilters.sub_issue = true`
 *       so archived sub-issues remain visible by default — a deliberate
 *       divergence from non-archived filter stores. Merges defaults via
 *       `computedDisplayFilters` / `computedDisplayProperties` and writes
 *       `richFilters` / `displayFilters` / `displayProperties` /
 *       `kanbanFilters` atomically inside `runInAction`.
 *   - updateFilterExpression(workspaceSlug, projectId, filters) — NOT
 *       registered in `makeObservable`; uses `runInAction` directly. Sets
 *       `filters[projectId].richFilters`, triggers
 *       `rootIssueStore.archivedIssues.fetchIssuesWithExistingPagination(
 *       workspaceSlug, projectId, "mutation")`, and persists to localStorage
 *       via `handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED,
 *       EIssueFilterType.FILTERS, …, { rich_filters })`. The pre-existing
 *       JSDoc above the method body documents its intent as a fallback for
 *       the work-item filter store and is preserved unchanged.
 *   - updateFilters(workspaceSlug, projectId, type, filters) — registered
 *       as `action`. Dispatches on `EIssueFilterType`:
 *       - DISPLAY_FILTERS: shallow-merges into
 *         `filters[projectId].displayFilters` and enforces three
 *         layout-coherence invariants — (1) `sub_group_by` is forced to
 *         `null` whenever `group_by` is `null`; (2) under `kanban` layout
 *         when `group_by === sub_group_by`, `sub_group_by` becomes `null`;
 *         (3) under `kanban` layout when `group_by` is `null`, `group_by`
 *         defaults to `"state"`. Commits via lodash `set` inside
 *         `runInAction`, persists via
 *         `handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED, …,
 *         { display_filters })`, and conditionally refetches via
 *         `archivedIssues.fetchIssuesWithExistingPagination` when the
 *         inherited `getShouldReFetchIssues(updatedDisplayFilters)` is
 *         true.
 *       - DISPLAY_PROPERTIES: shallow-merges into
 *         `filters[projectId].displayProperties` and persists via
 *         `handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED, …,
 *         { display_properties })`. No refetch.
 *       - KANBAN_FILTERS: shallow-merges into
 *         `filters[projectId].kanbanFilters`. PERSISTS ONLY when
 *         `rootIssueStore.currentUserId` is truthy — anonymous sessions
 *         intentionally skip the localStorage write so kanban-collapse
 *         state stays user-scoped and does not leak across users on
 *         shared devices. No refetch.
 *     On any error, re-hydrates via `fetchFilters(workspaceSlug, projectId)`
 *     to recover from drift, then re-throws.
 *
 * Refetch contract:
 *   A refetch on the companion `archivedIssues` store is triggered ONLY for
 *   `richFilters` updates (via `updateFilterExpression`) and for
 *   DISPLAY_FILTERS updates where `getShouldReFetchIssues` returns true;
 *   DISPLAY_PROPERTIES and KANBAN_FILTERS writes never refetch.
 *
 * Consumers:
 *   - Companion store: apps/web/core/store/issue/archived/issue.store.ts
 *       (`ArchivedIssues`) — calls `getFilterParams(...)` to build paginated
 *       request params for `fetchIssues` / `fetchNextIssues`.
 *   - Layout root:
 *       apps/web/core/components/issues/issue-layouts/roots/archived-issue-layout-root.tsx
 *       — mounts the `EIssuesStoreType.ARCHIVED` context and consumes
 *       `issuesFilter`.
 *   - Layout controls and empty state:
 *       apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/archived-issue.tsx,
 *       apps/web/core/components/issues/issue-layouts/empty-states/archived-issues.tsx,
 *       apps/web/core/components/issues/archived-issues-header.tsx.
 *   - Peek overview:
 *       apps/web/core/components/issues/peek-overview/header.tsx and
 *       apps/web/core/components/issues/peek-overview/root.tsx — read the
 *       archived filter context via `useIssues(EIssuesStoreType.ARCHIVED)`.
 *   - Composition: instantiated in apps/web/core/store/issue/root.store.ts
 *       as `archivedIssuesFilter = new ArchivedIssuesFilter(this)`, paired
 *       with the companion `ArchivedIssues` store from `./issue.store`.
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

export interface IArchivedIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    projectId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(projectId: string): IIssueFilters | undefined;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
}

export class ArchivedIssuesFilter extends IssueFilterHelperStore implements IArchivedIssuesFilter {
  // observables
  filters: { [projectId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore;
  // services
  issueFilterService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
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
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getIssueFilters(projectId);
  }

  get appliedFilters() {
    const projectId = this.rootIssueStore.projectId;
    if (!projectId) return undefined;

    return this.getAppliedFilters(projectId);
  }

  getIssueFilters(projectId: string) {
    const displayFilters = this.filters[projectId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(projectId: string) {
    const userFilters = this.getIssueFilters(projectId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
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
      projectId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(projectId);

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, projectId: string) => {
    const _filters = this.handleIssuesLocalFilters.get(EIssuesStoreType.ARCHIVED, workspaceSlug, projectId, undefined);

    const richFilters: TWorkItemFilterExpression = _filters?.richFilters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters({
      ..._filters?.display_filters,
      sub_issue: true,
    });
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(_filters?.display_properties);
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    kanbanFilters.group_by = _filters?.kanban_filters?.group_by || [];
    kanbanFilters.sub_group_by = _filters?.kanban_filters?.sub_group_by || [];

    runInAction(() => {
      set(this.filters, [projectId, "richFilters"], richFilters);
      set(this.filters, [projectId, "displayFilters"], displayFilters);
      set(this.filters, [projectId, "displayProperties"], displayProperties);
      set(this.filters, [projectId, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IArchivedIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [projectId, "richFilters"], filters);
      });

      this.rootIssueStore.archivedIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
      this.handleIssuesLocalFilters.set(
        EIssuesStoreType.ARCHIVED,
        EIssueFilterType.FILTERS,
        workspaceSlug,
        projectId,
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

  updateFilters: IArchivedIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[projectId])) return;

      const _filters = {
        richFilters: this.filters[projectId].richFilters,
        displayFilters: this.filters[projectId].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[projectId].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[projectId].kanbanFilters as TIssueKanbanFilters,
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
          // set group_by to state if layout is switched to kanban and group_by is null
          if (_filters.displayFilters.layout === "kanban" && _filters.displayFilters.group_by === null) {
            _filters.displayFilters.group_by = "state";
            updatedDisplayFilters.group_by = "state";
          }

          runInAction(() => {
            Object.keys(updatedDisplayFilters).forEach((_key) => {
              set(
                this.filters,
                [projectId, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.archivedIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
          }

          this.handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED, type, workspaceSlug, projectId, undefined, {
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
                [projectId, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          this.handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED, type, workspaceSlug, projectId, undefined, {
            display_properties: _filters.displayProperties,
          });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.ARCHIVED, type, workspaceSlug, projectId, undefined, {
              kanban_filters: _filters.kanbanFilters,
            });

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [projectId, "kanbanFilters", _key],
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
      this.fetchFilters(workspaceSlug, projectId);
      throw error;
    }
  };
}
