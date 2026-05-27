/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module-scoped issue filter store. Owns the active filter expression,
 * display filters, display properties, and kanban toggles for each
 * module's issues view; persists rich filters / display filters / display
 * properties to the backend via `IssueFiltersService`, while kanban
 * toggles remain local-only via per-user, per-workspace local storage
 * scoped by `EIssuesStoreType.MODULE`.
 *
 * Extends IssueFilterHelperStore (`../helpers/issue-filter-helper.store`)
 * for shared `computedIssueFilters`, `computedFilteredParams`,
 * `computedDisplayFilters`, `computedDisplayProperties`,
 * `getPaginationParams`, `getShouldClearIssues`, `getShouldReFetchIssues`,
 * and the `handleIssuesLocalFilters` local-storage helper. Stores are
 * injected via React context (MobX exclusively — not Redux) per
 * AAP §0.2.2.
 *
 * State slice (observable):
 *   - filters: Record<string, IIssueFilters> — per-module filter bundle
 *     keyed by `moduleId`. Each entry holds `richFilters`,
 *     `displayFilters`, `displayProperties`, and `kanbanFilters`.
 *     Hydrated lazily on first `fetchFilters(moduleId)` call.
 *   - rootIssueStore: IIssueRootStore — back-reference for cross-store
 *     reads (`moduleId`, `currentUserId`, `moduleIssues`).
 *   - issueFilterService: IssueFiltersService — backend client for the
 *     module filter REST surface.
 *
 * Computed:
 *   - issueFilters — bundle for `rootIssueStore.moduleId`; recomputes
 *     when the active `moduleId` changes or `filters[moduleId]` mutates.
 *   - appliedFilters — query-param shape derived from `issueFilters` by
 *     layout via `handleIssueQueryParamsByLayout("issues")`; recomputes
 *     on the same triggers. Strips the redundant `module` token — it is
 *     re-added explicitly by `getFilterParams`.
 *   - getFilterParams(options, moduleId, cursor, groupId, subGroupId) —
 *     `computedFn` from `mobx-utils` that composes `getAppliedFilters` +
 *     `getPaginationParams` and force-sets `module = moduleId` on every
 *     call.
 *
 * Actions:
 *   - fetchFilters(workspaceSlug, projectId, moduleId): Promise<void>
 *       Side effects: GET via
 *       `IssueFiltersService.fetchModuleIssueFilters`; normalizes display
 *       filters/properties through helper methods; reads per-user kanban
 *       toggles from local storage scoped by `EIssuesStoreType.MODULE`
 *       and current user; commits the merged bundle to
 *       `filters[moduleId]` inside `runInAction`.
 *   - updateFilterExpression(workspaceSlug, projectId, moduleId, filters):
 *     Promise<void>
 *       Side effects: optimistic write of `richFilters` into
 *       `filters[moduleId].richFilters`; triggers
 *       `rootIssueStore.moduleIssues.fetchIssuesWithExistingPagination`;
 *       then PATCHes `{ rich_filters }` to the backend. Designed as a
 *       fallback for the work item filter store — see the inline note
 *       above the method body.
 *   - updateFilters(workspaceSlug, projectId, type, filters, moduleId):
 *     Promise<void>
 *       Dispatches by `EIssueFilterType`:
 *         • DISPLAY_FILTERS — merges into `filters[moduleId].displayFilters`;
 *           normalizes group_by/sub_group_by (clears sub_group_by when
 *           group_by is null; collapses duplicates under kanban; defaults
 *           kanban group_by to "state" when null); calls
 *           `rootIssueStore.moduleIssues.clear(true)` when
 *           `getShouldClearIssues` is true; triggers
 *           `fetchIssuesWithExistingPagination` when
 *           `getShouldReFetchIssues` is true; PATCHes
 *           `{ display_filters }` to the backend.
 *         • DISPLAY_PROPERTIES — merges into
 *           `filters[moduleId].displayProperties` and PATCHes
 *           `{ display_properties }` to the backend.
 *         • KANBAN_FILTERS — local-only; persists via
 *           `handleIssuesLocalFilters.set(EIssuesStoreType.MODULE, …)`
 *           keyed by current user + workspace + moduleId. NO backend
 *           write — kanban grouping toggles are deliberately
 *           per-user-per-device.
 *       On error, refetches backend filters via `fetchFilters` to
 *       restore store consistency before rethrowing.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/list/roots/module-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/kanban/roots/module-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/calendar/roots/module-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/gantt/roots/module-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/spreadsheet/base-spreadsheet-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/roots/module-layout-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/filters/** (filter widgets)
 *   - apps/web/core/hooks/store/use-issues.ts (selects via
 *     `EIssuesStoreType.MODULE`)
 *   - ./issue.store.ts (`ModuleIssues.fetchIssues` /
 *     `fetchNextIssues` read params via `getFilterParams`)
 *   - apps/web/core/store/issue/root.store.ts (singleton wiring under
 *     `moduleIssuesFilter`).
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

export interface IModuleIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    moduleId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(moduleId: string): IIssueFilters | undefined;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate,
    moduleId: string
  ) => Promise<void>;
}

export class ModuleIssuesFilter extends IssueFilterHelperStore implements IModuleIssuesFilter {
  // observables
  filters: { [moduleId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore: IIssueRootStore;
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
    const moduleId = this.rootIssueStore.moduleId;
    if (!moduleId) return undefined;

    return this.getIssueFilters(moduleId);
  }

  get appliedFilters() {
    const moduleId = this.rootIssueStore.moduleId;
    if (!moduleId) return undefined;

    return this.getAppliedFilters(moduleId);
  }

  getIssueFilters(moduleId: string) {
    const displayFilters = this.filters[moduleId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(moduleId: string) {
    const userFilters = this.getIssueFilters(moduleId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
    if (!filteredParams) return undefined;

    if (filteredParams.includes("module")) filteredParams.splice(filteredParams.indexOf("module"), 1);

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
      moduleId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      let filterParams = this.getAppliedFilters(moduleId);

      if (!filterParams) {
        filterParams = {};
      }
      filterParams["module"] = moduleId;

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  fetchFilters = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    const _filters = await this.issueFilterService.fetchModuleIssueFilters(workspaceSlug, projectId, moduleId);

    const richFilters: TWorkItemFilterExpression = _filters?.rich_filters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters(_filters?.display_filters);
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(_filters?.display_properties);

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.MODULE,
        workspaceSlug,
        moduleId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

    runInAction(() => {
      set(this.filters, [moduleId, "richFilters"], richFilters);
      set(this.filters, [moduleId, "displayFilters"], displayFilters);
      set(this.filters, [moduleId, "displayProperties"], displayProperties);
      set(this.filters, [moduleId, "kanbanFilters"], kanbanFilters);
    });
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IModuleIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    moduleId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [moduleId, "richFilters"], filters);
      });

      this.rootIssueStore.moduleIssues.fetchIssuesWithExistingPagination(
        workspaceSlug,
        projectId,
        "mutation",
        moduleId
      );
      await this.issueFilterService.patchModuleIssueFilters(workspaceSlug, projectId, moduleId, {
        rich_filters: filters,
      });
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IModuleIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters, moduleId) => {
    try {
      if (isEmpty(this.filters) || isEmpty(this.filters[moduleId])) return;

      const _filters = {
        richFilters: this.filters[moduleId].richFilters,
        displayFilters: this.filters[moduleId].displayFilters as IIssueDisplayFilterOptions,
        displayProperties: this.filters[moduleId].displayProperties as IIssueDisplayProperties,
        kanbanFilters: this.filters[moduleId].kanbanFilters as TIssueKanbanFilters,
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
                [moduleId, "displayFilters", _key],
                updatedDisplayFilters[_key as keyof IIssueDisplayFilterOptions]
              );
            });
          });

          if (this.getShouldClearIssues(updatedDisplayFilters)) {
            this.rootIssueStore.moduleIssues.clear(true); // clear issues for local store when some filters like layout changes
          }

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.moduleIssues.fetchIssuesWithExistingPagination(
              workspaceSlug,
              projectId,
              "mutation",
              moduleId
            );
          }

          await this.issueFilterService.patchModuleIssueFilters(workspaceSlug, projectId, moduleId, {
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
                [moduleId, "displayProperties", _key],
                updatedDisplayProperties[_key as keyof IIssueDisplayProperties]
              );
            });
          });

          await this.issueFilterService.patchModuleIssueFilters(workspaceSlug, projectId, moduleId, {
            display_properties: _filters.displayProperties,
          });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.MODULE, type, workspaceSlug, moduleId, currentUserId, {
              kanban_filters: _filters.kanbanFilters,
            });

          runInAction(() => {
            Object.keys(updatedKanbanFilters).forEach((_key) => {
              set(
                this.filters,
                [moduleId, "kanbanFilters", _key],
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
      if (moduleId) this.fetchFilters(workspaceSlug, projectId, moduleId);
      throw error;
    }
  };
}
