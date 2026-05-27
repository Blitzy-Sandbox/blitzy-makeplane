/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-scoped view store: caches project-level saved views with filtering,
 * search, ordering, CRUD, and favorite synchronization against the
 * `FavoriteStore` held on the `CoreRootStore`.
 *
 * State slice (observables):
 *   - loader: boolean — true while `fetchViews` is in flight; toggled
 *     synchronously around the `ViewService.getViews` call.
 *   - viewMap: Record<string, IProjectView> — all loaded views keyed by
 *     view id. Project association is preserved on each view's `project`
 *     field rather than via an outer projectId key, so a single map serves
 *     every visited project.
 *   - fetchedMap: Record<string, boolean> — keyed by projectId; gates
 *     selectors to `undefined` / `null` until the first fetch resolves.
 *   - filters: TViewFilters — `{ searchQuery, sortKey, sortBy, filters? }`
 *     consumed by the filtered + ordered selectors.
 *
 * Actions:
 *   - fetchViews(workspaceSlug, projectId) → `ViewService.getViews`;
 *     populates `viewMap` and sets `fetchedMap[projectId] = true`.
 *   - fetchViewDetails(workspaceSlug, projectId, viewId) →
 *     `ViewService.getViewDetails`; refreshes a single entry in `viewMap`.
 *   - createView(workspaceSlug, projectId, data) → `ViewService.createView`
 *     (payload normalized via `getValidatedViewFilters`); inserts the
 *     server-returned view into `viewMap`.
 *   - updateView(workspaceSlug, projectId, viewId, data) — optimistic
 *     merge into `viewMap[viewId]` followed by `ViewService.patchView`.
 *   - deleteView(workspaceSlug, projectId, viewId) →
 *     `ViewService.deleteView`; removes the entry from `viewMap` and, if
 *     mirrored as a favorite, calls
 *     `this.rootStore.favorite.removeFavoriteFromStore(viewId)`.
 *   - updateFilters(filterKey, filterValue) — mutates a single slice of
 *     the `filters` observable via `runInAction` + `lodash-es#set`.
 *   - clearAllFilters() — resets `filters.filters` to `{}`; search query,
 *     sort key, and sort direction are preserved.
 *   - addViewToFavorites(workspaceSlug, projectId, viewId) — optimistic
 *     `is_favorite = true` followed by
 *     `this.rootStore.favorite.addFavorite(...)`; reverts on error.
 *   - removeViewFromFavorites(workspaceSlug, projectId, viewId) —
 *     optimistic `is_favorite = false` followed by
 *     `this.rootStore.favorite.removeFavoriteEntity(...)`; reverts on
 *     error.
 *
 * Computed (recomputation conditions):
 *   - projectViewIds — ids of views whose `project` matches
 *     `rootStore.router.projectId`; returns `null` until
 *     `fetchedMap[projectId]` is true. Recomputes when `viewMap`,
 *     `fetchedMap`, or `router.projectId` changes.
 *   - getProjectViews(projectId) — `computedFn` returning views for the
 *     given project ordered by `filters.sortKey` / `filters.sortBy`.
 *     Recomputes when `viewMap`, `fetchedMap`, or sort filters change.
 *   - getFilteredProjectViews(projectId) — `computedFn` applying
 *     `filters.searchQuery` and `filters.filters` (via `shouldFilterView`)
 *     in addition to ordering. Recomputes when `viewMap`, `fetchedMap`,
 *     or any `filters` slice changes.
 *   - getViewById(viewId) — `computedFn` returning a single view or
 *     `null`. Recomputes when `viewMap[viewId]` changes.
 *
 * Consumers (read via the `useProjectView()` hook bound to
 * `CoreRootStore.projectView` through the React `StoreProvider`):
 *   - apps/web/core/components/views/** — views list, list header,
 *     list item action row, create/update modal, delete modal.
 *   - apps/web/core/components/issues/issue-layouts/roots/project-view-layout-root.tsx
 *   - apps/web/core/components/power-k/ui/pages/open-entity/project-views-menu.tsx
 *   - apps/web/core/components/work-item-filters/filters-hoc/project-level.tsx
 *   - apps/web/app/.../[projectId]/views/** route pages (list + detail).
 */

import { set } from "lodash-es";
import { observable, action, makeObservable, runInAction, computed } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { IProjectView, TViewFilters } from "@plane/types";
// constants
// helpers
import { getValidatedViewFilters, getViewName, orderViews, shouldFilterView } from "@plane/utils";
// services
import { ViewService } from "@/services/view.service";
// store
import type { CoreRootStore } from "./root.store";

export interface IProjectViewStore {
  //Loaders
  loader: boolean;
  fetchedMap: Record<string, boolean>;
  // observables
  viewMap: Record<string, IProjectView>;
  filters: TViewFilters;
  // computed
  projectViewIds: string[] | null;
  // computed actions
  getProjectViews: (projectId: string) => IProjectView[] | undefined;
  getFilteredProjectViews: (projectId: string) => IProjectView[] | undefined;
  getViewById: (viewId: string) => IProjectView;
  // fetch actions
  fetchViews: (workspaceSlug: string, projectId: string) => Promise<undefined | IProjectView[]>;
  fetchViewDetails: (workspaceSlug: string, projectId: string, viewId: string) => Promise<IProjectView>;
  // CRUD actions
  createView: (workspaceSlug: string, projectId: string, data: Partial<IProjectView>) => Promise<IProjectView>;
  updateView: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    data: Partial<IProjectView>
  ) => Promise<IProjectView>;
  deleteView: (workspaceSlug: string, projectId: string, viewId: string) => Promise<any>;
  updateFilters: <T extends keyof TViewFilters>(filterKey: T, filterValue: TViewFilters[T]) => void;
  clearAllFilters: () => void;
  // favorites actions
  addViewToFavorites: (workspaceSlug: string, projectId: string, viewId: string) => Promise<any>;
  removeViewFromFavorites: (workspaceSlug: string, projectId: string, viewId: string) => Promise<any>;
}

export class ProjectViewStore implements IProjectViewStore {
  // observables
  loader: boolean = false;
  viewMap: Record<string, IProjectView> = {};
  //loaders
  fetchedMap: Record<string, boolean> = {};
  filters: TViewFilters = { searchQuery: "", sortBy: "desc", sortKey: "updated_at" };
  // root store
  rootStore;
  // services
  viewService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      viewMap: observable,
      fetchedMap: observable,
      filters: observable,
      // computed
      projectViewIds: computed,
      // fetch actions
      fetchViews: action,
      fetchViewDetails: action,
      // CRUD actions
      createView: action,
      updateView: action,
      deleteView: action,
      // actions
      updateFilters: action,
      clearAllFilters: action,
      // favorites actions
      addViewToFavorites: action,
      removeViewFromFavorites: action,
    });
    // root store
    this.rootStore = _rootStore;
    // services
    this.viewService = new ViewService();

    this.createView = this.createView.bind(this);
    this.updateView = this.updateView.bind(this);
  }

  /**
   * Returns array of view ids for current project
   */
  get projectViewIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    const viewIds = Object.keys(this.viewMap ?? {})?.filter((viewId) => this.viewMap?.[viewId]?.project === projectId);
    return viewIds;
  }

  getProjectViews = computedFn((projectId: string) => {
    if (!this.fetchedMap[projectId]) return undefined;

    const ViewsList = Object.values(this.viewMap ?? {});
    // helps to filter views based on the projectId
    let filteredViews = ViewsList.filter((view) => view?.project === projectId);
    filteredViews = orderViews(filteredViews, this.filters.sortKey, this.filters.sortBy);

    return filteredViews ?? undefined;
  });
  /**
   * returns viewsIds of issues
   */
  getFilteredProjectViews = computedFn((projectId: string) => {
    if (!this.fetchedMap[projectId]) return undefined;

    const ViewsList = Object.values(this.viewMap ?? {});
    // helps to filter views based on the projectId, searchQuery and filters
    let filteredViews = ViewsList.filter(
      (view) =>
        view?.project === projectId &&
        getViewName(view.name).toLowerCase().includes(this.filters.searchQuery.toLowerCase()) &&
        shouldFilterView(view, this.filters.filters)
    );
    filteredViews = orderViews(filteredViews, this.filters.sortKey, this.filters.sortBy);

    return filteredViews ?? undefined;
  });

  /**
   * Returns view details by id
   */
  getViewById = computedFn((viewId: string) => this.viewMap?.[viewId] ?? null);

  /**
   * Updates the filter
   * @param filterKey
   * @param filterValue
   */
  updateFilters = <T extends keyof TViewFilters>(filterKey: T, filterValue: TViewFilters[T]) => {
    runInAction(() => {
      set(this.filters, [filterKey], filterValue);
    });
  };

  /**
   * @description clears all the filters
   */
  clearAllFilters = () =>
    runInAction(() => {
      set(this.filters, ["filters"], {});
    });

  /**
   * Fetches views for current project
   * @param workspaceSlug
   * @param projectId
   * @returns Promise<IProjectView[]>
   */
  fetchViews = async (workspaceSlug: string, projectId: string) => {
    try {
      this.loader = true;
      await this.viewService.getViews(workspaceSlug, projectId).then((response) => {
        runInAction(() => {
          response.forEach((view) => {
            set(this.viewMap, [view.id], view);
          });
          set(this.fetchedMap, projectId, true);
          this.loader = false;
        });
        return response;
      });
    } catch (_error) {
      this.loader = false;
      return undefined;
    }
  };

  /**
   * Fetches view details for a specific view
   * @param workspaceSlug
   * @param projectId
   * @param viewId
   * @returns Promise<IProjectView>
   */
  fetchViewDetails = async (workspaceSlug: string, projectId: string, viewId: string): Promise<IProjectView> =>
    await this.viewService.getViewDetails(workspaceSlug, projectId, viewId).then((response) => {
      runInAction(() => {
        set(this.viewMap, [viewId], response);
      });
      return response;
    });

  /**
   * Creates a new view for a specific project and adds it to the store
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns Promise<IProjectView>
   */
  async createView(workspaceSlug: string, projectId: string, data: Partial<IProjectView>): Promise<IProjectView> {
    const response = await this.viewService.createView(workspaceSlug, projectId, getValidatedViewFilters(data));

    runInAction(() => {
      set(this.viewMap, [response.id], response);
    });

    return response;
  }

  /**
   * Updates a view details of specific view and updates it in the store
   * @param workspaceSlug
   * @param projectId
   * @param viewId
   * @param data
   * @returns Promise<IProjectView>
   */
  async updateView(
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    data: Partial<IProjectView>
  ): Promise<IProjectView> {
    const currentView = this.getViewById(viewId);

    runInAction(() => {
      set(this.viewMap, [viewId], { ...currentView, ...data });
    });

    const response = await this.viewService.patchView(workspaceSlug, projectId, viewId, data);

    return response;
  }

  /**
   * Deletes a view and removes it from the viewMap object
   * @param workspaceSlug
   * @param projectId
   * @param viewId
   * @returns
   */
  deleteView = async (workspaceSlug: string, projectId: string, viewId: string): Promise<any> => {
    await this.viewService.deleteView(workspaceSlug, projectId, viewId).then(() => {
      runInAction(() => {
        delete this.viewMap[viewId];
        if (this.rootStore.favorite.entityMap[viewId]) this.rootStore.favorite.removeFavoriteFromStore(viewId);
      });
    });
  };

  /**
   * Adds a view to favorites
   * @param workspaceSlug
   * @param projectId
   * @param viewId
   * @returns
   */
  addViewToFavorites = async (workspaceSlug: string, projectId: string, viewId: string) => {
    try {
      const currentView = this.getViewById(viewId);
      if (currentView?.is_favorite) return;
      runInAction(() => {
        set(this.viewMap, [viewId, "is_favorite"], true);
      });
      await this.rootStore.favorite.addFavorite(workspaceSlug.toString(), {
        entity_type: "view",
        entity_identifier: viewId,
        project_id: projectId,
        entity_data: { name: this.viewMap[viewId].name || "" },
      });
    } catch (error) {
      console.error("Failed to add view to favorites in view store", error);
      runInAction(() => {
        set(this.viewMap, [viewId, "is_favorite"], false);
      });
    }
  };

  /**
   * Removes a view from favorites
   * @param workspaceSlug
   * @param projectId
   * @param viewId
   * @returns
   */
  removeViewFromFavorites = async (workspaceSlug: string, projectId: string, viewId: string) => {
    try {
      const currentView = this.getViewById(viewId);
      if (!currentView?.is_favorite) return;
      runInAction(() => {
        set(this.viewMap, [viewId, "is_favorite"], false);
      });
      await this.rootStore.favorite.removeFavoriteEntity(workspaceSlug, viewId);
    } catch (error) {
      console.error("Failed to remove view from favorites in view store", error);
      runInAction(() => {
        set(this.viewMap, [viewId, "is_favorite"], true);
      });
    }
  };
}
