/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX filter store for workspace-scoped (cross-project) issue views — owns the
 * per-view filter, display-filter, display-property, and kanban-filter state used
 * by the workspace "all issues" surface and global (saved) views, and composes that
 * state into the query parameters consumed by `WorkspaceIssues.fetchIssues` and
 * `fetchNextIssues`.
 *
 * Inheritance:
 *   Extends `IssueFilterHelperStore` (../helpers/issue-filter-helper.store), inheriting
 *   `computedIssueFilters`, `computedDisplayFilters`, `computedDisplayProperties`,
 *   `computedFilteredParams`, `getFilterConditionBasedOnViews`, `getPaginationParams`,
 *   and the `handleIssuesLocalFilters` LocalStorage adapter (keyed by `EIssuesStoreType`).
 *   Unlike the sibling `WorkspaceIssues` issue-collection class, this filter store is
 *   imported directly from `./workspace` by `apps/web/core/store/issue/root.store.ts`
 *   and has no plane-web override seam in the CE tier.
 *
 * State slice (observables):
 *   - `filters: { [viewId: string]: IIssueFilters }` — per-view bucket keyed by the
 *     active workspace view id (resolved through `rootIssueStore.globalViewId`, which
 *     mirrors `router.globalViewId`). Each bucket holds `richFilters`
 *     (`TWorkItemFilterExpression`), `displayFilters`, `displayProperties`, and
 *     `kanbanFilters`.
 *   - `rootIssueStore` — back-reference used to read `globalViewId` / `currentUserId`
 *     and to trigger the sibling `workspaceIssues.fetchIssuesWithExistingPagination`
 *     after every filter mutation.
 *   - `issueFilterService = new WorkspaceService()` — backend client; despite the
 *     field name, the underlying wire calls go through
 *     `WorkspaceService.getViewDetails(workspaceSlug, viewId)` for saved-view
 *     hydration (no separate `IssueFiltersService` exists for this surface).
 *
 * Computed (`@computed` registered via `makeObservable`):
 *   - `issueFilters` — derives the normalized `IIssueFilters` slice for the active
 *     `globalViewId`; recomputes when `globalViewId` or its bucket in `filters` changes.
 *   - `appliedFilters` — derives the layout-keyed query-param map for the active
 *     `globalViewId`; uses the spreadsheet / `"my_issues"` layout key when calling
 *     `handleIssueQueryParamsByLayout`, so the param allowlist reflects the workspace
 *     cross-project layout rather than any per-project layout selection.
 *
 * Parameterized computed (`computedFn` from `mobx-utils`):
 *   - `getFilterParams(options, viewId, cursor, groupId, subGroupId)` — cached per
 *     argument tuple. Composes the applied filter map for `viewId`, augments it with
 *     static-view conditions when `viewId` is in `STATIC_VIEW_TYPES`
 *     (`all-issues` / `assigned` / `created` / `subscribed` via inherited
 *     `getFilterConditionBasedOnViews(currentUserId, viewId)`), and folds in
 *     pagination params (cursor, page size, calendar bounds) via inherited
 *     `getPaginationParams`. Consumed by `WorkspaceIssues.fetchIssues` /
 *     `fetchNextIssues` to build the query string for `WorkspaceService.getViewIssues`.
 *
 * Actions (`@action` registered via `makeObservable`):
 *   - `fetchFilters(workspaceSlug, viewId)` — hydrates `filters[viewId]`. Reads
 *     display filters / properties / kanban filters from local cache via
 *     `handleIssuesLocalFilters.get(EIssuesStoreType.GLOBAL, ...)`, then, for
 *     non-static views, overrides display state and loads `richFilters` from
 *     `WorkspaceService.getViewDetails`. Normalizes
 *     `displayFilters.order_by === "sort_order"` to `"-created_at"` because manual
 *     drag-sort order is local-only and the persisted query uses recency for stable
 *     cursor pagination.
 *   - `updateFilterExpression(workspaceSlug, viewId, filters)` — replaces
 *     `filters[viewId].richFilters` and triggers
 *     `workspaceIssues.fetchIssuesWithExistingPagination(..., "mutation")` so the
 *     list refetches with the new expression. (The pre-existing JSDoc on the method
 *     itself flags it as a fallback entry point for the work-item filter store.)
 *   - `updateFilters(workspaceSlug, projectId, type, filters, viewId)` — branches
 *     by `EIssueFilterType`. Enforces kanban invariants — clears `sub_group_by`
 *     when grouping is removed or when it equals `group_by`, and defaults `group_by`
 *     to `"state"` when kanban layout is selected with `null` grouping. Persists
 *     display filters and display properties under `EIssuesStoreType.GLOBAL` ONLY
 *     for the static-view allowlist (`all-issues` / `assigned` / `created` /
 *     `subscribed`); user-saved global views round-trip through the server only.
 *     Kanban-filter collapse state is persisted whenever `currentUserId` is present
 *     (per-user local cache). On error, rehydrates via
 *     `fetchFilters(workspaceSlug, viewId)` and re-throws.
 *
 * Helper accessors (plain class fields, not observables/actions):
 *   - `getIssueFilters(viewId)` and `getAppliedFilters(viewId)` — same derivations
 *     as the computed getters but parameterized by an arbitrary view id, used by
 *     consumers needing lookups outside the currently active `globalViewId`.
 *
 * Local-storage scope:
 *   All local persistence goes through `EIssuesStoreType.GLOBAL` keyed by
 *   `(workspaceSlug, undefined, viewId)` where the `undefined` slot is the
 *   `projectId` placeholder used by sibling per-project stores — the workspace-equivalent
 *   of the per-project local cache used by sibling project / cycle / module filter
 *   stores. Persistence is intentionally restricted to the four static views above;
 *   rich-filter expressions for user-saved views are canonical on the server and
 *   are never written to LocalStorage.
 *
 * Plane-web companion:
 *   The companion `WorkspaceIssues` issue-collection class is wired in the root
 *   store via the plane-web indirection
 *   `@/plane-web/store/issue/workspace/issue.store` — a CE-tier passthrough to
 *   `./issue.store` that exists as an enterprise-edition override seam. THIS filter
 *   store has no plane-web indirection and is imported directly from `./workspace`.
 *
 * Consumers:
 *   - `apps/web/core/store/issue/root.store.ts` — instantiated as
 *     `workspaceIssuesFilter` and passed into `new WorkspaceIssues(...)`.
 *   - Sibling `WorkspaceIssues` (`./issue.store`) — calls `getFilterParams` for
 *     every page fetch.
 *   - Workspace global-view layout roots:
 *       `apps/web/core/components/issues/issue-layouts/roots/all-issue-layout-root.tsx`
 *       `apps/web/core/components/issues/issue-layouts/spreadsheet/roots/workspace-root.tsx`
 *   - Quick-action dropdown:
 *       `apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/all-issue.tsx`
 *   - Workspace view modals:
 *       `apps/web/core/components/workspace/views/form.tsx`,
 *       `apps/web/core/components/workspace/views/modal.tsx`
 *   - Workspace filter UI surfaces under `issue-layouts/filters` and related layout
 *     helpers.
 */

import { isEmpty, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import { EIssueFilterType } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  TIssueKanbanFilters,
  IIssueFilters,
  TIssueParams,
  TStaticViewTypes,
  IssuePaginationOptions,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes, STATIC_VIEW_TYPES } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
// services
import { WorkspaceService } from "@/services/workspace.service";
// local imports
import type { IBaseIssueFilterStore, IIssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
import type { IIssueRootStore } from "../root.store";

type TWorkspaceFilters = TStaticViewTypes;

export type TBaseFilterStore = IBaseIssueFilterStore & IIssueFilterHelperStore;

export interface IWorkspaceIssuesFilter extends TBaseFilterStore {
  // fetch action
  fetchFilters: (workspaceSlug: string, viewId: string) => Promise<void>;
  updateFilterExpression: (workspaceSlug: string, viewId: string, filters: TWorkItemFilterExpression) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string | undefined,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate,
    viewId: string
  ) => Promise<void>;
  //helper action
  getIssueFilters: (viewId: string | undefined) => IIssueFilters | undefined;
  getAppliedFilters: (viewId: string) => Partial<Record<TIssueParams, string | boolean>> | undefined;
  getFilterParams: (
    options: IssuePaginationOptions,
    viewId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
}

export class WorkspaceIssuesFilter extends IssueFilterHelperStore implements IWorkspaceIssuesFilter {
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
      // fetch actions
      fetchFilters: action,
      updateFilters: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.issueFilterService = new WorkspaceService();
  }

  getIssueFilters = (viewId: string | undefined) => {
    if (!viewId) return undefined;

    const displayFilters = this.filters[viewId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  };

  getAppliedFilters = (viewId: string | undefined) => {
    if (!viewId) return undefined;

    const userFilters = this.getIssueFilters(viewId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(EIssueLayoutTypes.SPREADSHEET, "my_issues");
    if (!filteredParams) return undefined;

    const filteredRouteParams: Partial<Record<TIssueParams, string | boolean>> = this.computedFilteredParams(
      userFilters?.richFilters,
      userFilters?.displayFilters,
      filteredParams
    );

    return filteredRouteParams;
  };

  get issueFilters() {
    const viewId = this.rootIssueStore.globalViewId;
    return this.getIssueFilters(viewId);
  }

  get appliedFilters() {
    const viewId = this.rootIssueStore.globalViewId;
    return this.getAppliedFilters(viewId);
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      viewId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      let filterParams = this.getAppliedFilters(viewId);

      if (!filterParams) {
        filterParams = {};
      }

      if (STATIC_VIEW_TYPES.includes(viewId)) {
        const currentUserId = this.rootIssueStore.currentUserId;
        const paramForStaticView = this.getFilterConditionBasedOnViews(currentUserId, viewId);
        if (paramForStaticView) {
          filterParams = { ...filterParams, ...paramForStaticView };
        }
      }

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, viewId: TWorkspaceFilters) => {
    let richFilters: TWorkItemFilterExpression;
    let displayFilters: IIssueDisplayFilterOptions;
    let displayProperties: IIssueDisplayProperties;
    let kanbanFilters: TIssueKanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };

    const _filters = this.handleIssuesLocalFilters.get(EIssuesStoreType.GLOBAL, workspaceSlug, undefined, viewId);
    displayFilters = this.computedDisplayFilters(_filters?.display_filters, {
      layout: EIssueLayoutTypes.SPREADSHEET,
      order_by: "-created_at",
    });
    displayProperties = this.computedDisplayProperties(_filters?.display_properties);
    kanbanFilters = {
      group_by: _filters?.kanban_filters?.group_by || [],
      sub_group_by: _filters?.kanban_filters?.sub_group_by || [],
    };

    // Get the view details if the view is not a static view
    if (STATIC_VIEW_TYPES.includes(viewId) === false) {
      const _filters = await this.issueFilterService.getViewDetails(workspaceSlug, viewId);
      richFilters = _filters?.rich_filters;
      displayFilters = this.computedDisplayFilters(_filters?.display_filters, {
        layout: EIssueLayoutTypes.SPREADSHEET,
        order_by: "-created_at",
      });
      displayProperties = this.computedDisplayProperties(_filters?.display_properties);
    }

    // override existing order by if ordered by manual sort_order
    if (displayFilters.order_by === "sort_order") {
      displayFilters.order_by = "-created_at";
    }

    runInAction(() => {
      set(this.filters, [viewId, "richFilters"], richFilters);
      set(this.filters, [viewId, "displayFilters"], displayFilters);
      set(this.filters, [viewId, "displayProperties"], displayProperties);
      set(this.filters, [viewId, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IWorkspaceIssuesFilter["updateFilterExpression"] = async (workspaceSlug, viewId, filters) => {
    try {
      runInAction(() => {
        set(this.filters, [viewId, "richFilters"], filters);
      });

      this.rootIssueStore.workspaceIssues.fetchIssuesWithExistingPagination(workspaceSlug, viewId, "mutation");
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IWorkspaceIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters, viewId) => {
    try {
      const issueFilters = this.getIssueFilters(viewId);

      if (!issueFilters) return;

      const _filters = {
        richFilters: issueFilters.richFilters,
        displayFilters: issueFilters.displayFilters as IIssueDisplayFilterOptions,
        displayProperties: issueFilters.displayProperties as IIssueDisplayProperties,
        kanbanFilters: issueFilters.kanbanFilters as TIssueKanbanFilters,
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

          this.rootIssueStore.workspaceIssues.fetchIssuesWithExistingPagination(workspaceSlug, viewId, "mutation");

          if (["all-issues", "assigned", "created", "subscribed"].includes(viewId))
            this.handleIssuesLocalFilters.set(EIssuesStoreType.GLOBAL, type, workspaceSlug, undefined, viewId, {
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
                [viewId, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
            if (["all-issues", "assigned", "created", "subscribed"].includes(viewId))
              this.handleIssuesLocalFilters.set(EIssuesStoreType.GLOBAL, type, workspaceSlug, undefined, viewId, {
                display_properties: _filters.displayProperties,
              });
          });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.GLOBAL, type, workspaceSlug, undefined, viewId, {
              kanban_filters: _filters.kanbanFilters,
            });

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
      if (viewId) this.fetchFilters(workspaceSlug, viewId);
      throw error;
    }
  };
}
