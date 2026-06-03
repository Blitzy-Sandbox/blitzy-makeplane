/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace-scoped "global view" store: caches workspace-level work-item views
 * (cross-project "all my work" views) keyed by view id, exposes filtering and
 * search over the cached set, and orchestrates CRUD against `WorkspaceService`.
 *
 * State slice:
 *   - globalViewMap: Record<string, IWorkspaceView> — every fetched workspace
 *     view keyed by `view.id`. Multi-workspace safe because each entry carries
 *     its own `workspace` id used for scoping in computed selectors.
 *
 * Computed:
 *   - currentWorkspaceViews: string[] | null — ids of cached views whose
 *     `workspace` matches `rootStore.workspaceRoot.currentWorkspace.id`.
 *     Recomputes when `globalViewMap` mutates or the active workspace changes;
 *     returns `null` until the active workspace is resolved.
 *
 * Computed actions (`computedFn` from mobx-utils — parameterized, memoized):
 *   - getSearchedViews(searchQuery): string[] | null — workspace-scoped ids
 *     filtered by case-insensitive `name` substring match against
 *     `searchQuery`. Recomputes when inputs or `globalViewMap` change.
 *   - getViewDetailsById(viewId): IWorkspaceView | null — direct cache lookup.
 *
 * Actions (all wrapped via `makeObservable(..., { ...: action })`):
 *   - fetchAllGlobalViews(workspaceSlug) → WorkspaceService.getAllViews;
 *     hydrates `globalViewMap` inside `runInAction`.
 *   - fetchGlobalViewDetails(workspaceSlug, viewId) → WorkspaceService
 *     .getViewDetails; upserts the single entry into `globalViewMap`.
 *   - createGlobalView(workspaceSlug, data) → WorkspaceService.createView;
 *     adds the persisted view to `globalViewMap`. Rethrows on failure.
 *   - updateGlobalView(workspaceSlug, viewId, data, shouldSyncFilters = true)
 *     → optimistically patches `globalViewMap[viewId]`, calls WorkspaceService
 *     .updateView, and — when `shouldSyncFilters` is true AND `rich_filters`
 *     changed — propagates the new filter expression to
 *     `rootStore.issue.workspaceIssuesFilter.updateFilterExpression` and
 *     re-fetches issues via
 *     `rootStore.issue.workspaceIssues.fetchIssuesWithExistingPagination`
 *     (mutation mode). Rolls the optimistic patch back on failure.
 *   - deleteGlobalView(workspaceSlug, viewId) → WorkspaceService.deleteView;
 *     removes the entry from `globalViewMap` inside `runInAction`.
 *
 * Cross-store interactions:
 *   - Reads `rootStore.workspaceRoot.currentWorkspace` for workspace scoping
 *     in `currentWorkspaceViews` and `getSearchedViews`.
 *   - Writes through `rootStore.issue.workspaceIssuesFilter` and
 *     `rootStore.issue.workspaceIssues` to keep the issue layout consistent
 *     with the persisted view filters when a view is updated.
 *
 * Consumers (via `useGlobalView()` from
 * `apps/web/core/hooks/store/use-global-view.ts`):
 *   - apps/web/core/components/workspace/views/** (header, views-list,
 *     view-list-item, modal, delete-view-modal) — workspace view CRUD UI
 *   - apps/web/core/components/issues/issue-layouts/roots/
 *     all-issue-layout-root.tsx and
 *     issues/issue-layouts/spreadsheet/roots/workspace-root.tsx —
 *     workspace-level issue layouts that resolve the active view
 *   - apps/web/core/components/work-item-filters/filters-hoc/
 *     workspace-level.tsx — filter chrome wrapping workspace views
 *   - apps/web/core/components/views/helper.tsx — shared view helpers
 *   - apps/web/core/store/router.store.ts,
 *     apps/web/core/store/issue/root.store.ts, and
 *     apps/web/core/store/issue/workspace/filter.store.ts —
 *     cross-store reads of cached view details
 */

import { set, cloneDeep, isEqual } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { IWorkspaceView } from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";
// store
import type { CoreRootStore } from "./root.store";

export interface IGlobalViewStore {
  // observables
  globalViewMap: Record<string, IWorkspaceView>;
  // computed
  currentWorkspaceViews: string[] | null;
  // computed actions
  getSearchedViews: (searchQuery: string) => string[] | null;
  getViewDetailsById: (viewId: string) => IWorkspaceView | null;
  // fetch actions
  fetchAllGlobalViews: (workspaceSlug: string) => Promise<IWorkspaceView[]>;
  fetchGlobalViewDetails: (workspaceSlug: string, viewId: string) => Promise<IWorkspaceView>;
  // crud actions
  createGlobalView: (workspaceSlug: string, data: Partial<IWorkspaceView>) => Promise<IWorkspaceView>;
  updateGlobalView: (
    workspaceSlug: string,
    viewId: string,
    data: Partial<IWorkspaceView>,
    shouldSyncFilters?: boolean
  ) => Promise<IWorkspaceView | undefined>;
  deleteGlobalView: (workspaceSlug: string, viewId: string) => Promise<any>;
}

export class GlobalViewStore implements IGlobalViewStore {
  // observables
  globalViewMap: Record<string, IWorkspaceView> = {};
  // root store
  rootStore;
  // services
  workspaceService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      globalViewMap: observable,
      // computed
      currentWorkspaceViews: computed,
      // actions
      fetchAllGlobalViews: action,
      fetchGlobalViewDetails: action,
      deleteGlobalView: action,
      updateGlobalView: action,
      createGlobalView: action,
    });

    // root store
    this.rootStore = _rootStore;
    // services
    this.workspaceService = new WorkspaceService();

    this.createGlobalView = this.createGlobalView.bind(this);
    this.updateGlobalView = this.updateGlobalView.bind(this);
  }

  /**
   * @description returns list of views for current workspace
   */
  get currentWorkspaceViews() {
    const currentWorkspaceDetails = this.rootStore.workspaceRoot.currentWorkspace;
    if (!currentWorkspaceDetails) return null;

    return (
      Object.keys(this.globalViewMap ?? {})?.filter(
        (viewId) => this.globalViewMap[viewId]?.workspace === currentWorkspaceDetails.id
      ) ?? null
    );
  }

  /**
   * @description returns list of views for current workspace based on search query
   * @param searchQuery
   * @returns
   */
  getSearchedViews = computedFn((searchQuery: string) => {
    const currentWorkspaceDetails = this.rootStore.workspaceRoot.currentWorkspace;
    if (!currentWorkspaceDetails) return null;

    return (
      Object.keys(this.globalViewMap ?? {})?.filter(
        (viewId) =>
          this.globalViewMap[viewId]?.workspace === currentWorkspaceDetails.id &&
          this.globalViewMap[viewId]?.name?.toLowerCase().includes(searchQuery.toLowerCase())
      ) ?? null
    );
  });

  /**
   * @description returns view details for given viewId
   * @param viewId
   */
  getViewDetailsById = computedFn((viewId: string): IWorkspaceView | null => this.globalViewMap[viewId] ?? null);

  /**
   * @description fetch all global views for given workspace
   * @param workspaceSlug
   */
  fetchAllGlobalViews = async (workspaceSlug: string): Promise<IWorkspaceView[]> =>
    await this.workspaceService.getAllViews(workspaceSlug).then((response) => {
      runInAction(() => {
        response.forEach((view) => {
          set(this.globalViewMap, view.id, view);
        });
      });
      return response;
    });

  /**
   * @description fetch view details for given viewId
   * @param viewId
   */
  fetchGlobalViewDetails = async (workspaceSlug: string, viewId: string): Promise<IWorkspaceView> =>
    await this.workspaceService.getViewDetails(workspaceSlug, viewId).then((response) => {
      runInAction(() => {
        set(this.globalViewMap, viewId, response);
      });
      return response;
    });

  /**
   * @description create new global view
   * @param workspaceSlug
   * @param data
   */
  async createGlobalView(workspaceSlug: string, data: Partial<IWorkspaceView>) {
    try {
      const response = await this.workspaceService.createView(workspaceSlug, data);
      runInAction(() => {
        set(this.globalViewMap, response.id, response);
      });

      return response;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  /**
   * @description update global view
   * @param workspaceSlug
   * @param viewId
   * @param data
   */
  async updateGlobalView(
    workspaceSlug: string,
    viewId: string,
    data: Partial<IWorkspaceView>,
    shouldSyncFilters: boolean = true
  ): Promise<IWorkspaceView | undefined> {
    const currentViewData = this.getViewDetailsById(viewId) ? cloneDeep(this.getViewDetailsById(viewId)) : undefined;
    try {
      Object.keys(data).forEach((key) => {
        const currentKey = key as keyof IWorkspaceView;
        set(this.globalViewMap, [viewId, currentKey], data[currentKey]);
      });

      const currentView = await this.workspaceService.updateView(workspaceSlug, viewId, data);

      // applying the filters in the global view
      if (shouldSyncFilters && !isEqual(currentViewData?.rich_filters || {}, currentView?.rich_filters || {})) {
        await this.rootStore.issue.workspaceIssuesFilter.updateFilterExpression(
          workspaceSlug,
          viewId,
          currentView?.rich_filters || {}
        );
        this.rootStore.issue.workspaceIssues.fetchIssuesWithExistingPagination(workspaceSlug, viewId, "mutation");
      }
      return currentView;
    } catch {
      Object.keys(data).forEach((key) => {
        const currentKey = key as keyof IWorkspaceView;
        if (currentViewData) set(this.globalViewMap, [viewId, currentKey], currentViewData[currentKey]);
      });
    }
  }

  /**
   * @description delete global view
   * @param workspaceSlug
   * @param viewId
   */
  deleteGlobalView = async (workspaceSlug: string, viewId: string): Promise<any> =>
    await this.workspaceService.deleteView(workspaceSlug, viewId).then(() => {
      runInAction(() => {
        delete this.globalViewMap[viewId];
      });
    });
}
