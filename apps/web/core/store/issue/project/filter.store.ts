/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project issues filter store — per-project work-items filter state for the web client,
 * with hybrid persistence: rich/display state is mirrored to the backend (so filters
 * follow the user across devices) while kanban grouping toggles stay device-local
 * via `localStorage` (because grouping is a UI preference, not a portable filter).
 *
 * Inheritance:
 *   - extends `IssueFilterHelperStore` (from ../helpers/issue-filter-helper.store)
 *   - implements `IProjectIssuesFilter` (extends `IBaseIssueFilterStore`)
 *   Inherits the canonical-shape normalizers (`computedIssueFilters`,
 *   `computedDisplayFilters`, `computedDisplayProperties`), the layout-aware
 *   query-param derivation (`computedFilteredParams`), the change-detection
 *   helpers (`getShouldClearIssues` / `getShouldReFetchIssues`), the pagination
 *   composer (`getPaginationParams`), and the `handleIssuesLocalFilters`
 *   wrapper around `localStorage`.
 *
 * State slice (registered in `makeObservable`):
 *   - filters: { [projectId: string]: IIssueFilters }
 *       Per-project filter bag map; each entry holds
 *       `richFilters: TWorkItemFilterExpression`,
 *       `displayFilters: IIssueDisplayFilterOptions`,
 *       `displayProperties: IIssueDisplayProperties`,
 *       `kanbanFilters: TIssueKanbanFilters`. Keyed by projectId so the map
 *       survives project route switches without re-fetch.
 *   - rootIssueStore: IIssueRootStore
 *       Parent issue root store reference; consulted for the current route
 *       `projectId` and the `currentUserId` used to scope local-storage keys.
 *   - projectService: ProjectService
 *       REST client for `getProjectUserProperties` (read) and
 *       `updateProjectUserProperties` (write).
 *
 * Computed (registered in `makeObservable`):
 *   - issueFilters: IIssueFilters | undefined
 *       Current-project normalized filters for consumer reads; resolves
 *       `rootIssueStore.projectId` and delegates to `getIssueFilters`.
 *       Recomputes when `rootIssueStore.projectId` or the matching entry in
 *       `filters` changes.
 *   - appliedFilters: Partial<Record<TIssueParams, string | boolean>> | undefined
 *       Query-param-ready derivation of `issueFilters` for the current layout;
 *       recomputes when the current project's filters or layout selection
 *       change.
 *
 * Helpers (memoized via `computedFn` — NOT registered in `makeObservable`):
 *   - getIssueFilters(projectId) — per-project read of normalized filters;
 *       returns `undefined` if the entry is missing or empty.
 *   - getAppliedFilters(projectId) — combines `getIssueFilters(projectId)` with
 *       the inherited `handleIssueQueryParamsByLayout` + `computedFilteredParams`
 *       to produce REST-bound query params; returns `undefined` when filters
 *       are absent or the layout isn't recognized.
 *   - getFilterParams(options, projectId, cursor, groupId, subGroupId)
 *       `computedFn` factory composing `getAppliedFilters(projectId)` with the
 *       inherited `getPaginationParams`; memoized per
 *       (options, projectId, cursor, groupId, subGroupId) tuple. Consumed by
 *       the companion `ProjectIssues.fetchIssues` / `fetchNextIssues` to build
 *       paginated request params.
 *
 * Actions (registered in `makeObservable`):
 *   - fetchFilters(workspaceSlug, projectId) — hydrates the project entry.
 *       Calls `projectService.getProjectUserProperties` for the backend payload,
 *       normalizes display filters/properties via inherited helpers, then
 *       OVERLAYS `kanbanFilters.group_by` / `sub_group_by` from
 *       `handleIssuesLocalFilters.get(EIssuesStoreType.PROJECT, …)` so
 *       per-device kanban toggles survive page refreshes. Commits atomically
 *       via `runInAction` + lodash `set`.
 *   - updateFilterExpression(workspaceSlug, projectId, filters) — optimistically
 *       writes `richFilters` locally, calls
 *       `rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(... , "mutation")`
 *       to refresh the list, then persists with
 *       `projectService.updateProjectUserProperties({ rich_filters })`.
 *       NOTE: this method is the FALLBACK path — typical rich-filter updates
 *       go through the work-item filter store; see the inline NOTE block above
 *       the method body for the routing precedence.
 *   - updateFilters(workspaceSlug, projectId, type, filters) — dispatches on
 *       `EIssueFilterType`:
 *       - DISPLAY_FILTERS: enforces kanban invariants (kanban requires a
 *         `group_by`, and `group_by` may not equal `sub_group_by`) — when the
 *         layout switches to kanban with no `group_by`, defaults to `"state"`;
 *         when `group_by` is null OR matches `sub_group_by` under kanban,
 *         nulls `sub_group_by`. Then commits via lodash `set` in `runInAction`,
 *         conditionally calls `projectIssues.clear(true)` (per inherited
 *         `getShouldClearIssues`) and `projectIssues.fetchIssuesWithExistingPagination`
 *         (per inherited `getShouldReFetchIssues`), and PERSISTS to backend via
 *         `updateProjectUserProperties({ display_filters })`.
 *       - DISPLAY_PROPERTIES: shallow-merges into
 *         `filters[projectId].displayProperties` and PERSISTS to backend via
 *         `updateProjectUserProperties({ display_properties })`.
 *       - KANBAN_FILTERS: shallow-merges into `filters[projectId].kanbanFilters`
 *         and PERSISTS ONLY to `localStorage` via
 *         `handleIssuesLocalFilters.set(EIssuesStoreType.PROJECT, …)` —
 *         intentionally NO backend write, because kanban toggles are per-device.
 *       On any error, re-hydrates via `fetchFilters(workspaceSlug, projectId)`
 *       to recover from optimistic-update drift, then re-throws.
 *
 * Persistence map (key architectural fact):
 *   - Backend (ProjectService.updateProjectUserProperties): `rich_filters`,
 *     `display_filters`, `display_properties`.
 *   - Browser localStorage (handleIssuesLocalFilters, scope
 *     `EIssuesStoreType.PROJECT`): `kanban_filters` ONLY — per-user-per-device
 *     UI toggles, not portable user preferences. The PROJECT scope keeps these
 *     keys isolated from cycle/module/workspace/archived/profile filter stores
 *     on the same browser.
 *
 * Consumers:
 *   - Companion store: apps/web/core/store/issue/project/issue.store.ts
 *     (`ProjectIssues`) — calls `getFilterParams(...)` to build paginated
 *     request params for `fetchIssues` / `fetchNextIssues`.
 *   - Layout components (indirectly via layout roots, filter and properties
 *     panels): apps/web/core/components/issues/issue-layouts/{list,kanban,
 *     spreadsheet,calendar,gantt}/**.
 *   - Filter/properties controls:
 *     apps/web/core/components/issues/issue-layouts/filters/**,
 *     apps/web/core/components/issues/issue-layouts/properties/**,
 *     apps/web/core/components/issues/filters.tsx — read `issueFilters` /
 *     `appliedFilters` and dispatch `updateFilterExpression` / `updateFilters`.
 *   - Empty state:
 *     apps/web/core/components/issues/issue-layouts/empty-states/project-issues.tsx.
 *   - Composition: instantiated in apps/web/core/store/issue/root.store.ts as
 *     `projectIssuesFilter = new ProjectIssuesFilter(this)`, paired with the
 *     companion `ProjectIssues` store.
 *   - Hook access: apps/web/core/hooks/store/use-issues.ts via
 *     `useIssues(EIssuesStoreType.PROJECT)`.
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
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
import { ProjectService } from "@/services/project";
// constants
// services

export interface IProjectIssuesFilter extends IBaseIssueFilterStore {
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

export class ProjectIssuesFilter extends IssueFilterHelperStore implements IProjectIssuesFilter {
  // observables
  filters: { [projectId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore: IIssueRootStore;
  // services
  projectService;

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
      updateFilterExpression: action,
      updateFilters: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.projectService = new ProjectService();
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

    return this.computedIssueFilters(displayFilters);
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
    const _filters = await this.projectService.getProjectUserProperties(workspaceSlug, projectId);

    const richFilters = _filters?.rich_filters;
    const displayFilters = this.computedDisplayFilters(_filters?.display_filters);
    const displayProperties = this.computedDisplayProperties(_filters?.display_properties);

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.PROJECT,
        workspaceSlug,
        projectId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

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
  updateFilterExpression: IProjectIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [projectId, "richFilters"], filters);
      });

      this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
      await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
        rich_filters: filters,
      });
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IProjectIssuesFilter["updateFilters"] = async (workspaceSlug, projectId, type, filters) => {
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

          if (this.getShouldClearIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.clear(true); // clear issues for local store when some filters like layout changes
          }

          if (this.getShouldReFetchIssues(updatedDisplayFilters)) {
            this.rootIssueStore.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
          }

          await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
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

          await this.projectService.updateProjectUserProperties(workspaceSlug, projectId, {
            display_properties: _filters.displayProperties,
          });
          break;
        }

        case EIssueFilterType.KANBAN_FILTERS: {
          const updatedKanbanFilters = filters as TIssueKanbanFilters;
          _filters.kanbanFilters = { ..._filters.kanbanFilters, ...updatedKanbanFilters };

          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(EIssuesStoreType.PROJECT, type, workspaceSlug, projectId, currentUserId, {
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
