/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX filter store for Plane custom Project Views — the `EIssuesStoreType.PROJECT_VIEW`
 * adapter atop the shared `IssueFilterHelperStore`. Owns per-view filter state hydrated from
 * the persisted Project View definition, derives route-query parameters for issue fetching,
 * persists kanban toggle preferences to local storage, and triggers issue clears/refetches
 * when filter changes invalidate the active result set.
 *
 * Inheritance:
 *   - extends `IssueFilterHelperStore` (from `../helpers/issue-filter-helper.store`) —
 *     inherits `computedIssueFilters`, `computedDisplayFilters`, `computedDisplayProperties`,
 *     `computedFilteredParams`, `getPaginationParams`, `handleIssuesLocalFilters`
 *     (local-storage adapter), `getShouldClearIssues`, and `getShouldReFetchIssues`.
 *   - implements `IProjectViewIssuesFilter` which extends `IBaseIssueFilterStore`.
 *
 * State slice:
 *   - `filters: { [viewId: string]: IIssueFilters }` — observable map keyed by saved-view
 *     `viewId`, with each entry containing `richFilters`, `displayFilters`,
 *     `displayProperties`, and `kanbanFilters`. Initialized to `{}` and populated lazily by
 *     `mutateFilters`.
 *   - `rootIssueStore: IIssueRootStore` — back-reference to the issue domain root; supplies
 *     `viewId`, `currentUserId`, and cross-store access to `rootIssueStore.projectViewIssues`
 *     for refetch triggers and `rootIssueStore.projectIssues` for the local clear-on-layout
 *     transition.
 *   - `issueFilterService: ViewService` — view-detail-fetching service. The field is named
 *     `issueFilterService` for parity with sibling filter stores, but the underlying service
 *     is the View service: a project view's persisted filter snapshot lives on the view
 *     record itself, not on a separate filters endpoint.
 *
 * Computed:
 *   - `issueFilters` (`computed`) — normalized filter snapshot for the active
 *     `rootIssueStore.viewId` (via `getIssueFilters`), or `undefined` when no view is in
 *     scope. Recomputes when `filters` or `rootIssueStore.viewId` change.
 *   - `appliedFilters` (`computed`) — route/query-ready params for the active
 *     `rootIssueStore.viewId` (via `getAppliedFilters`), or `undefined` when no view is in
 *     scope. Recomputes on the same dependencies.
 *   - `getIssueFilters(viewId)` — helper that normalizes the raw `filters[viewId]` snapshot
 *     via the inherited `computedIssueFilters`; returns `undefined` when the entry is
 *     missing.
 *   - `getAppliedFilters(viewId)` — helper that derives the route-query param object via
 *     `handleIssueQueryParamsByLayout` + the inherited `computedFilteredParams`; returns
 *     `undefined` when filters are missing.
 *   - `getFilterParams(options, viewId, cursor, groupId, subGroupId)` — `computedFn` factory
 *     composing `getAppliedFilters` with the inherited `getPaginationParams`; memoized per
 *     argument tuple; recomputes when the view's filter snapshot changes.
 *
 * Actions:
 *   - `mutateFilters(workspaceSlug, viewId, viewDetails)` — hydrates `filters[viewId]` from a
 *     `ProjectView` payload. Extracts `viewDetails.rich_filters` into `richFilters`,
 *     normalizes `display_filters` and `display_properties` via the inherited helpers, and
 *     merges in any locally-persisted kanban toggle helpers read from
 *     `handleIssuesLocalFilters.get(EIssuesStoreType.PROJECT_VIEW, ...)`. All four slot
 *     writes are committed in a single `runInAction`.
 *   - `fetchFilters(workspaceSlug, projectId, viewId)` — hydration entry point. Calls
 *     `ViewService.getViewDetails` and forwards the result to `mutateFilters`. Unlike
 *     per-project filter stores there is no dedicated filters endpoint — the canonical filter
 *     snapshot for a custom view is the view record itself.
 *   - `updateFilterExpression(workspaceSlug, projectId, viewId, filters)` — sets
 *     `richFilters` on the local view slot and triggers
 *     `rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(..., "mutation")`.
 *     Designed as a fallback / initialization path; callers should normally route through the
 *     work-item-filter store.
 *   - `updateFilters(workspaceSlug, projectId, type, filters, viewId)` — branches on
 *     `EIssueFilterType`:
 *       * `DISPLAY_FILTERS` — merges into local state; enforces kanban-layout invariants
 *         (`sub_group_by=null` when `group_by=null`; `sub_group_by=null` when kanban has
 *         `group_by===sub_group_by`; default `group_by="state"` when entering kanban with
 *         null `group_by`); clears `rootIssueStore.projectIssues` when
 *         `getShouldClearIssues` is true; refetches via
 *         `rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination` when
 *         `getShouldReFetchIssues` is true.
 *       * `DISPLAY_PROPERTIES` — merges into local state only (display-only changes do not
 *         require a refetch).
 *       * `KANBAN_FILTERS` — merges into local state AND persists to local storage scoped to
 *         `EIssuesStoreType.PROJECT_VIEW` so kanban column-collapse / sub-group toggles
 *         survive reloads.
 *     On any error, calls `fetchFilters(workspaceSlug, projectId, viewId)` to restore
 *     canonical state and re-throws.
 *   - `resetFilters(workspaceSlug, viewId)` — re-applies the canonical view definition by
 *     reading it from the route-level `rootStore.projectView.getViewById(viewId)` cache and
 *     replaying `mutateFilters`. No network request is issued; the view definition is
 *     expected to already be warm in the parent store.
 *
 * Local-storage scope: every persisted preference (currently kanban toggle helpers) is keyed
 * by `EIssuesStoreType.PROJECT_VIEW`, so each issue-store context (project, cycle, module,
 * archived, workspace, profile, project-view, etc.) maintains its own independent UI state.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-layouts/roots/project-view-layout-root.tsx` —
 *     primary consumer via `useIssues(EIssuesStoreType.PROJECT_VIEW)`; reads `issuesFilter`
 *     from this store.
 *   - All issue-layout subtree components under
 *     `apps/web/core/components/issues/issue-layouts/{kanban,list,calendar,gantt,spreadsheet,
 *     filters,empty-states,quick-add,quick-action-dropdowns,properties,roots}` when invoked
 *     in the project-view context.
 *   - `apps/web/core/components/issues/issue-layouts/empty-states/project-view.tsx`.
 *   - Sibling `./issue.store.ts` (`ProjectViewIssues`) — `fetchIssues` / `fetchNextIssues`
 *     call `getFilterParams(...)` for backend query construction.
 *   - Accessed via `apps/web/core/hooks/store/use-issues.ts`
 *     (`useIssues(EIssuesStoreType.PROJECT_VIEW)` returns the paired filter + issue store).
 *   - Composed by `apps/web/core/store/issue/root.store.ts` as `projectViewIssuesFilter` and
 *     exposed via the sibling barrel `./index.ts`.
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
  IProjectView,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
// services
import { ViewService } from "@/services/view.service";
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
// constants

export interface IProjectViewIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    viewId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(viewId: string): IIssueFilters | undefined;
  // helper actions
  mutateFilters: (workspaceSlug: string, viewId: string, viewDetails: IProjectView) => void;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string, viewId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate,
    viewId: string
  ) => Promise<void>;
  resetFilters: (workspaceSlug: string, viewId: string) => void;
}

export class ProjectViewIssuesFilter extends IssueFilterHelperStore implements IProjectViewIssuesFilter {
  // observables
  filters: { [viewId: string]: IIssueFilters } = {};
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
      resetFilters: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.issueFilterService = new ViewService();
  }

  get issueFilters() {
    const viewId = this.rootIssueStore.viewId;
    if (!viewId) return undefined;

    return this.getIssueFilters(viewId);
  }

  get appliedFilters() {
    const viewId = this.rootIssueStore.viewId;
    if (!viewId) return undefined;

    return this.getAppliedFilters(viewId);
  }

  getIssueFilters(viewId: string) {
    const displayFilters = this.filters[viewId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(viewId: string) {
    const userFilters = this.getIssueFilters(viewId);
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
      viewId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(viewId);

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  mutateFilters: IProjectViewIssuesFilter["mutateFilters"] = action((workspaceSlug, viewId, viewDetails) => {
    const richFilters: TWorkItemFilterExpression = viewDetails?.rich_filters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters(viewDetails?.display_filters);
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(viewDetails?.display_properties);

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.PROJECT_VIEW,
        workspaceSlug,
        viewId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

    runInAction(() => {
      set(this.filters, [viewId, "richFilters"], richFilters);
      set(this.filters, [viewId, "displayFilters"], displayFilters);
      set(this.filters, [viewId, "displayProperties"], displayProperties);
      set(this.filters, [viewId, "kanbanFilters"], kanbanFilters);
    });
  });

  fetchFilters = async (workspaceSlug: string, projectId: string, viewId: string) => {
    try {
      const viewDetails = await this.issueFilterService.getViewDetails(workspaceSlug, projectId, viewId);
      this.mutateFilters(workspaceSlug, viewId, viewDetails);
    } catch (error) {
      console.log("error while fetching project view filters", error);
      throw error;
    }
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IProjectViewIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    viewId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [viewId, "richFilters"], filters);
      });

      this.rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(
        workspaceSlug,
        projectId,
        viewId,
        "mutation"
      );
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IProjectViewIssuesFilter["updateFilters"] = async (
    workspaceSlug,
    projectId,
    type,
    filters,
    viewId
  ) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[viewId])) return;

      const _filters = {
        richFilters: this.filters[viewId].richFilters,
        displayFilters: this.filters[viewId].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[viewId].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[viewId].kanbanFilters as TIssueKanbanFilters,
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
                [viewId, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          if (this.getShouldClearIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.clear(true); // clear issues for local store when some filters like layout changes
          }

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(
              workspaceSlug,
              projectId,
              viewId,
              "mutation"
            );
          }

          break;
        }
        case EIssueFilterType.DISPLAY_PROPERTIES: {
          const updatedDisplayProperties = filters as IIssueDisplayProperties;
          _filters.displayProperties = { ..._filters.displayProperties, ...updatedDisplayProperties };

          runInAction(() => {
            Object.keys(updatedDisplayProperties).forEach((_key) => {
              set(
                this.filters,
                [viewId, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          break;
        }
        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(
              EIssuesStoreType.PROJECT_VIEW,
              type,
              workspaceSlug,
              viewId,
              currentUserId,
              {
                kanban_filters: _filters.kanbanFilters,
              }
            );

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [viewId, "kanbanFilters", _key],
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
      if (viewId) this.fetchFilters(workspaceSlug, projectId, viewId);
      throw error;
    }
  };

  /**
   * @description resets the filters for a project view
   * @param workspaceSlug
   * @param viewId
   */
  resetFilters: IProjectViewIssuesFilter["resetFilters"] = action((workspaceSlug, viewId) => {
    const viewDetails = this.rootIssueStore.rootStore.projectView.getViewById(viewId);
    if (!viewDetails) return;
    this.mutateFilters(workspaceSlug, viewId, viewDetails);
  });
}
