/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module domain store: per-project module cache, lifecycle CRUD, archive
 * workflows, and link / favorite coordination for the web client. Owns the
 * source-of-truth `IModule` records keyed by id and exposes derived selectors
 * consumed by `apps/web/core/components/modules/**`.
 *
 * State slice:
 *   - loader: boolean — in-flight indicator for project-scoped fetches
 *   - moduleMap: Record<string, IModule> — all known modules keyed by module id
 *   - plotType: Record<string, TModulePlotType> — burndown / burnup chart
 *     selection per module (mirrored to the analytics sidebar)
 *   - fetchedMap: Record<string, boolean> — per-project "modules loaded" flag
 *     gating `null` versus `[]` semantics in selectors
 *
 * Computed:
 *   - projectModuleIds — non-archived module ids for `rootStore.router.projectId`
 *     sorted by `sort_order`; recomputes when `moduleMap`, `fetchedMap`, or the
 *     active `router.projectId` change
 *   - projectArchivedModuleIds — archived counterpart of the above with the
 *     same recomputation inputs
 *
 * Computed actions (`computedFn` from mobx-utils — memoized per argument):
 *   - getModulesFetchStatusByProjectId(projectId): boolean — `fetchedMap` lookup
 *   - getFilteredModuleIds(projectId): string[] | null — applies
 *     `rootStore.moduleFilter.{getDisplayFiltersByProjectId,
 *     getFiltersByProjectId, searchQuery}` to non-archived modules; orders via
 *     `orderModules` from `@plane/utils`
 *   - getFilteredArchivedModuleIds(projectId): string[] | null — same as above
 *     but reads `moduleFilter.{getArchivedFiltersByProjectId,
 *     archivedModulesSearchQuery}` and limits to archived rows
 *   - getModuleById(moduleId): IModule | null — direct `moduleMap` lookup
 *   - getModuleNameById(moduleId): string | undefined — name accessor
 *   - getProjectModuleDetails(projectId): IModule[] | null — sorted non-archived
 *     rows for the supplied project
 *   - getProjectModuleIds(projectId): string[] | null — id projection of the above
 *
 * Actions:
 *   - setPlotType(moduleId, plotType): void
 *       Mutates `plotType[moduleId]`.
 *   - getPlotTypeByModuleId(moduleId): TModulePlotType
 *       Reads `plotType[moduleId]`; falls back to `"burndown"` when estimates
 *       are disabled via `rootStore.projectEstimate.areEstimateEnabledByProjectId`.
 *   - updateModuleDistribution(distributionUpdates, moduleId): void
 *       Local-only mutation of `moduleMap[moduleId]` via the `updateDistribution`
 *       helper; reflects issue-state changes without a refetch.
 *   - fetchWorkspaceModules(workspaceSlug): Promise<IModule[]>
 *       Calls `ModuleService.getWorkspaceModules`; mutates `moduleMap` and sets
 *       `fetchedMap` for every project id observed in the response.
 *   - fetchModules(workspaceSlug, projectId): Promise<undefined | IModule[]>
 *       Calls `ModuleService.getModules`; mutates `moduleMap`,
 *       `fetchedMap[projectId]`, and toggles `loader`.
 *   - fetchModulesSlim(workspaceSlug, projectId): Promise<undefined | IModule[]>
 *       Calls `ModuleService.getWorkspaceModules` then client-side filters by
 *       `projectId`; same observable mutations as `fetchModules`.
 *   - fetchArchivedModules(workspaceSlug, projectId): Promise<undefined | IModule[]>
 *       Calls `ModuleArchiveService.getArchivedModules`; mutates `moduleMap`
 *       and toggles `loader`.
 *   - fetchArchivedModuleDetails(workspaceSlug, projectId, moduleId): Promise<IModule>
 *       Calls `ModuleArchiveService.getArchivedModuleDetails`; mutates
 *       `moduleMap[id]`.
 *   - fetchModuleDetails(workspaceSlug, projectId, moduleId): Promise<IModule>
 *       Calls `ModuleService.getModuleDetails`; mutates `moduleMap[id]`.
 *   - createModule(workspaceSlug, projectId, data): Promise<IModule>
 *       Calls `ModuleService.createModule`; inserts into `moduleMap`.
 *   - updateModuleDetails(workspaceSlug, projectId, moduleId, data): Promise<IModule>
 *       Optimistic patch of `moduleMap[id]` then `ModuleService.patchModule`;
 *       reverts to the pre-update snapshot on error.
 *   - deleteModule(workspaceSlug, projectId, moduleId): Promise<void>
 *       Calls `ModuleService.deleteModule`; removes from `moduleMap` and, when
 *       a favorite row exists, calls `rootStore.favorite.removeFavoriteFromStore`.
 *   - createModuleLink / updateModuleLink / deleteModuleLink: per-link CRUD on
 *       `moduleMap[id].link_module` via `ModuleService.{createModuleLink,
 *       updateModuleLink, deleteModuleLink}`; `updateModuleLink` is optimistic
 *       with error-revert.
 *   - addModuleToFavorites(workspaceSlug, projectId, moduleId): Promise<void>
 *       Optimistic flip of `is_favorite` then `rootStore.favorite.addFavorite`;
 *       reverts on error.
 *   - removeModuleFromFavorites(workspaceSlug, projectId, moduleId): Promise<void>
 *       Optimistic flip then `rootStore.favorite.removeFavoriteEntity`;
 *       reverts on error.
 *   - archiveModule(workspaceSlug, projectId, moduleId): Promise<void>
 *       Calls `ModuleArchiveService.archiveModule`; sets `archived_at` from the
 *       response and removes any favorite via
 *       `rootStore.favorite.removeFavoriteFromStore`.
 *   - restoreModule(workspaceSlug, projectId, moduleId): Promise<void>
 *       Calls `ModuleArchiveService.restoreModule`; clears `archived_at`.
 *
 * Cross-store reads (via `this.rootStore`):
 *   - router.projectId
 *   - moduleFilter.{getDisplayFiltersByProjectId, getFiltersByProjectId,
 *     getArchivedFiltersByProjectId, searchQuery, archivedModulesSearchQuery}
 *   - projectEstimate.areEstimateEnabledByProjectId
 *   - favorite.{entityMap, addFavorite, removeFavoriteEntity,
 *     removeFavoriteFromStore}
 *
 * Consumers:
 *   - apps/web/core/components/modules/** (list, modal, view header, quick
 *     actions, links, archived modules, analytics sidebar)
 *   - apps/web/core/store/issue/module/** (cross-store reads from the issue layer)
 *   - apps/web/core/store/module_filter.store.ts (supplies the filter, search,
 *     and ordering inputs consumed by the `getFiltered*` selectors above)
 *   - apps/web/core/store/root.store.ts (composition root — registers
 *     `module: IModuleStore`)
 */

import { update, concat, set, sortBy } from "lodash-es";
import { action, computed, observable, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { IModule, ILinkDetails, TModulePlotType } from "@plane/types";
import type { DistributionUpdates } from "@plane/utils";
import { updateDistribution, orderModules, shouldFilterModule } from "@plane/utils";
// helpers
// services
import { ModuleService } from "@/services/module.service";
import { ModuleArchiveService } from "@/services/module_archive.service";
import { ProjectService } from "@/services/project";
// store
import type { CoreRootStore } from "./root.store";

export interface IModuleStore {
  //Loaders
  loader: boolean;
  fetchedMap: Record<string, boolean>;
  plotType: Record<string, TModulePlotType>;
  // observables
  moduleMap: Record<string, IModule>;
  // computed
  projectModuleIds: string[] | null;
  projectArchivedModuleIds: string[] | null;
  // computed actions
  getModulesFetchStatusByProjectId: (projectId: string) => boolean;
  getFilteredModuleIds: (projectId: string) => string[] | null;
  getFilteredArchivedModuleIds: (projectId: string) => string[] | null;
  getModuleById: (moduleId: string) => IModule | null;
  getModuleNameById: (moduleId: string) => string;
  getProjectModuleDetails: (projectId: string) => IModule[] | null;
  getProjectModuleIds: (projectId: string) => string[] | null;
  getPlotTypeByModuleId: (moduleId: string) => TModulePlotType;
  // actions
  setPlotType: (moduleId: string, plotType: TModulePlotType) => void;
  // fetch
  updateModuleDistribution: (distributionUpdates: DistributionUpdates, moduleId: string) => void;
  fetchWorkspaceModules: (workspaceSlug: string) => Promise<IModule[]>;
  fetchModules: (workspaceSlug: string, projectId: string) => Promise<undefined | IModule[]>;
  fetchModulesSlim: (workspaceSlug: string, projectId: string) => Promise<undefined | IModule[]>;
  fetchArchivedModules: (workspaceSlug: string, projectId: string) => Promise<undefined | IModule[]>;
  fetchArchivedModuleDetails: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<IModule>;
  fetchModuleDetails: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<IModule>;
  // crud
  createModule: (workspaceSlug: string, projectId: string, data: Partial<IModule>) => Promise<IModule>;
  updateModuleDetails: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    data: Partial<IModule>
  ) => Promise<IModule>;
  deleteModule: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
  createModuleLink: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    data: Partial<ILinkDetails>
  ) => Promise<ILinkDetails>;
  updateModuleLink: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    linkId: string,
    data: Partial<ILinkDetails>
  ) => Promise<ILinkDetails>;
  deleteModuleLink: (workspaceSlug: string, projectId: string, moduleId: string, linkId: string) => Promise<void>;
  // favorites
  addModuleToFavorites: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
  removeModuleFromFavorites: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
  // archive
  archiveModule: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
  restoreModule: (workspaceSlug: string, projectId: string, moduleId: string) => Promise<void>;
}

export class ModulesStore implements IModuleStore {
  // observables
  loader: boolean = false;
  moduleMap: Record<string, IModule> = {};
  plotType: Record<string, TModulePlotType> = {};
  //loaders
  fetchedMap: Record<string, boolean> = {};
  // root store
  rootStore;
  // services
  projectService;
  moduleService;
  moduleArchiveService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      moduleMap: observable,
      plotType: observable.ref,
      fetchedMap: observable,
      // computed
      projectModuleIds: computed,
      projectArchivedModuleIds: computed,
      // actions
      setPlotType: action,
      fetchWorkspaceModules: action,
      fetchModules: action,
      fetchArchivedModules: action,
      fetchArchivedModuleDetails: action,
      fetchModuleDetails: action,
      createModule: action,
      updateModuleDetails: action,
      deleteModule: action,
      createModuleLink: action,
      updateModuleLink: action,
      deleteModuleLink: action,
      addModuleToFavorites: action,
      removeModuleFromFavorites: action,
      archiveModule: action,
      restoreModule: action,
    });

    this.rootStore = _rootStore;

    // services
    this.projectService = new ProjectService();
    this.moduleService = new ModuleService();
    this.moduleArchiveService = new ModuleArchiveService();
  }

  // computed
  /**
   * get all module ids for the current project
   */
  get projectModuleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let projectModules = Object.values(this.moduleMap).filter((m) => m.project_id === projectId && !m?.archived_at);
    projectModules = sortBy(projectModules, [(m) => m.sort_order]);
    const projectModuleIds = projectModules.map((m) => m.id);
    return projectModuleIds || null;
  }

  /**
   * get all archived module ids for the current project
   */
  get projectArchivedModuleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let archivedModules = Object.values(this.moduleMap).filter((m) => m.project_id === projectId && !!m?.archived_at);
    archivedModules = sortBy(archivedModules, [(m) => m.sort_order]);
    const projectModuleIds = archivedModules.map((m) => m.id);
    return projectModuleIds || null;
  }

  /**
   * Returns the fetch status for a specific project
   * @param projectId
   * @returns boolean
   */
  getModulesFetchStatusByProjectId = computedFn((projectId: string) => this.fetchedMap[projectId] ?? false);

  /**
   * @description returns filtered module ids based on display filters and filters
   * @param {TModuleDisplayFilters} displayFilters
   * @param {TModuleFilters} filters
   * @returns {string[] | null}
   */
  getFilteredModuleIds = computedFn((projectId: string) => {
    const displayFilters = this.rootStore.moduleFilter.getDisplayFiltersByProjectId(projectId);
    const filters = this.rootStore.moduleFilter.getFiltersByProjectId(projectId);
    const searchQuery = this.rootStore.moduleFilter.searchQuery;
    if (!this.fetchedMap[projectId]) return null;
    let modules = Object.values(this.moduleMap ?? {}).filter(
      (m) =>
        m.project_id === projectId &&
        !m.archived_at &&
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        shouldFilterModule(m, displayFilters ?? {}, filters ?? {})
    );
    modules = orderModules(modules, displayFilters?.order_by);
    const moduleIds = modules.map((m) => m.id);
    return moduleIds;
  });

  /**
   * @description returns filtered archived module ids based on display filters and filters
   * @param {string} projectId
   * @returns {string[] | null}
   */
  getFilteredArchivedModuleIds = computedFn((projectId: string) => {
    const displayFilters = this.rootStore.moduleFilter.getDisplayFiltersByProjectId(projectId);
    const filters = this.rootStore.moduleFilter.getArchivedFiltersByProjectId(projectId);
    const searchQuery = this.rootStore.moduleFilter.archivedModulesSearchQuery;
    if (!this.fetchedMap[projectId]) return null;
    let modules = Object.values(this.moduleMap ?? {}).filter(
      (m) =>
        m.project_id === projectId &&
        !!m.archived_at &&
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        shouldFilterModule(m, displayFilters ?? {}, filters ?? {})
    );
    modules = orderModules(modules, displayFilters?.order_by);
    const moduleIds = modules.map((m) => m.id);
    return moduleIds;
  });

  /**
   * @description get module by id
   * @param moduleId
   * @returns IModule | null
   */
  getModuleById = computedFn((moduleId: string) => this.moduleMap?.[moduleId] || null);

  /**
   * @description get module by id
   * @param moduleId
   * @returns IModule | null
   */
  getModuleNameById = computedFn((moduleId: string) => this.moduleMap?.[moduleId]?.name);

  /**
   * @description returns list of module details of the project id passed as argument
   * @param projectId
   */
  getProjectModuleDetails = computedFn((projectId: string) => {
    if (!this.fetchedMap[projectId]) return null;
    let projectModules = Object.values(this.moduleMap).filter((m) => m.project_id === projectId && !m.archived_at);
    projectModules = sortBy(projectModules, [(m) => m.sort_order]);
    return projectModules;
  });

  /**
   * @description returns list of module ids of the project id passed as argument
   * @param projectId
   */
  getProjectModuleIds = computedFn((projectId: string) => {
    const projectModules = this.getProjectModuleDetails(projectId);
    if (!projectModules) return null;
    const projectModuleIds = projectModules.map((m) => m.id);
    return projectModuleIds;
  });

  /**
   * @description gets the plot type for the module store
   * @param {TModulePlotType} plotType
   */
  getPlotTypeByModuleId = (moduleId: string) => {
    const { projectId } = this.rootStore.router;

    return projectId && this.rootStore.projectEstimate.areEstimateEnabledByProjectId(projectId)
      ? this.plotType[moduleId] || "burndown"
      : "burndown";
  };

  /**
   * @description updates the plot type for the module store
   * @param {TModulePlotType} plotType
   */
  setPlotType = (moduleId: string, plotType: TModulePlotType) => {
    set(this.plotType, [moduleId], plotType);
  };

  /**
   * @description fetch all modules
   * @param workspaceSlug
   * @returns IModule[]
   */
  fetchWorkspaceModules = async (workspaceSlug: string) =>
    await this.moduleService.getWorkspaceModules(workspaceSlug).then((response) => {
      runInAction(() => {
        response.forEach((module) => {
          set(this.moduleMap, [module.id], { ...this.moduleMap[module.id], ...module });
        });
        // check for all unique project ids and update the fetchedMap
        const uniqueProjectIds = new Set(response.map((module) => module.project_id));
        uniqueProjectIds.forEach((projectId) => {
          set(this.fetchedMap, projectId, true);
        });
      });
      return response;
    });

  /**
   * @description fetch all modules
   * @param workspaceSlug
   * @param projectId
   * @returns IModule[]
   */
  fetchModules = async (workspaceSlug: string, projectId: string) => {
    try {
      this.loader = true;
      await this.moduleService.getModules(workspaceSlug, projectId).then((response) => {
        runInAction(() => {
          response.forEach((module) => {
            set(this.moduleMap, [module.id], { ...this.moduleMap[module.id], ...module });
          });
          set(this.fetchedMap, projectId, true);
          this.loader = false;
        });
        return response;
      });
    } catch {
      this.loader = false;
      return undefined;
    }
  };

  /**
   * @description fetch all modules
   * @param workspaceSlug
   * @param projectId
   * @returns IModule[]
   */
  fetchModulesSlim = async (workspaceSlug: string, projectId: string) => {
    try {
      this.loader = true;
      await this.moduleService.getWorkspaceModules(workspaceSlug).then((response) => {
        const projectModules = response.filter((module) => module.project_id === projectId);
        runInAction(() => {
          projectModules.forEach((module) => {
            set(this.moduleMap, [module.id], { ...this.moduleMap[module.id], ...module });
          });
          set(this.fetchedMap, projectId, true);
          this.loader = false;
        });
        return projectModules;
      });
    } catch {
      this.loader = false;
      return undefined;
    }
  };

  /**
   * @description fetch all archived modules
   * @param workspaceSlug
   * @param projectId
   * @returns IModule[]
   */
  fetchArchivedModules = async (workspaceSlug: string, projectId: string) => {
    this.loader = true;
    return await this.moduleArchiveService
      .getArchivedModules(workspaceSlug, projectId)
      .then((response) => {
        runInAction(() => {
          response.forEach((module) => {
            set(this.moduleMap, [module.id], { ...this.moduleMap[module.id], ...module });
          });
          this.loader = false;
        });
        return response;
      })
      .catch(() => {
        this.loader = false;
        return undefined;
      });
  };

  /**
   * @description fetch module details
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns IModule
   */
  fetchArchivedModuleDetails = async (workspaceSlug: string, projectId: string, moduleId: string) =>
    await this.moduleArchiveService.getArchivedModuleDetails(workspaceSlug, projectId, moduleId).then((response) => {
      runInAction(() => {
        set(this.moduleMap, [response.id], { ...this.moduleMap?.[response.id], ...response });
      });
      return response;
    });

  /**
   * This method updates the module's stats locally without fetching the updated stats from backend
   * @param distributionUpdates
   * @param moduleId
   * @returns
   */
  updateModuleDistribution = (distributionUpdates: DistributionUpdates, moduleId: string) => {
    const moduleInfo = this.moduleMap[moduleId];

    if (!moduleInfo) return;

    runInAction(() => {
      updateDistribution(moduleInfo, distributionUpdates);
    });
  };

  /**
   * @description fetch module details
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns IModule
   */
  fetchModuleDetails = async (workspaceSlug: string, projectId: string, moduleId: string) =>
    await this.moduleService.getModuleDetails(workspaceSlug, projectId, moduleId).then((response) => {
      runInAction(() => {
        set(this.moduleMap, [moduleId], response);
      });
      return response;
    });

  /**
   * @description creates a new module
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns IModule
   */
  createModule = async (workspaceSlug: string, projectId: string, data: Partial<IModule>) =>
    await this.moduleService.createModule(workspaceSlug, projectId, data).then((response) => {
      runInAction(() => {
        set(this.moduleMap, [response?.id], response);
      });
      return response;
    });

  /**
   * @description updates module details
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @param data
   * @returns IModule
   */
  updateModuleDetails = async (workspaceSlug: string, projectId: string, moduleId: string, data: Partial<IModule>) => {
    const originalModuleDetails = this.getModuleById(moduleId);
    try {
      runInAction(() => {
        set(this.moduleMap, [moduleId], { ...originalModuleDetails, ...data });
      });
      const response = await this.moduleService.patchModule(workspaceSlug, projectId, moduleId, data);
      return response;
    } catch (error) {
      console.error("Failed to update module in module store", error);
      runInAction(() => {
        set(this.moduleMap, [moduleId], { ...originalModuleDetails });
      });
      throw error;
    }
  };

  /**
   * @description deletes a module
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   */
  deleteModule = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    const moduleDetails = this.getModuleById(moduleId);
    if (!moduleDetails) return;
    await this.moduleService.deleteModule(workspaceSlug, projectId, moduleId).then(() => {
      runInAction(() => {
        delete this.moduleMap[moduleId];
        if (this.rootStore.favorite.entityMap[moduleId]) this.rootStore.favorite.removeFavoriteFromStore(moduleId);
      });
    });
  };

  /**
   * @description creates a new module link
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @param data
   * @returns ILinkDetails
   */
  createModuleLink = async (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    data: Partial<ILinkDetails>
  ) => {
    try {
      const moduleLink = await this.moduleService.createModuleLink(workspaceSlug, projectId, moduleId, data);
      runInAction(() => {
        update(this.moduleMap, [moduleId, "link_module"], (moduleLinks = []) => concat(moduleLinks, moduleLink));
      });
      return moduleLink;
    } catch (error) {
      throw error;
    }
  };

  /**
   * @description updates module link details
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @param linkId
   * @param data
   * @returns ILinkDetails
   */
  updateModuleLink = async (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    linkId: string,
    data: Partial<ILinkDetails>
  ) => {
    const originalModuleDetails = this.getModuleById(moduleId);
    try {
      const linkModules = originalModuleDetails?.link_module?.map((link) =>
        link.id === linkId ? { ...link, ...data } : link
      );
      runInAction(() => {
        set(this.moduleMap, [moduleId, "link_module"], linkModules);
      });
      const response = await this.moduleService.updateModuleLink(workspaceSlug, projectId, moduleId, linkId, data);
      return response;
    } catch (error) {
      console.error("Failed to update module link in module store", error);
      runInAction(() => {
        set(this.moduleMap, [moduleId, "link_module"], originalModuleDetails?.link_module);
      });
      throw error;
    }
  };

  /**
   * @description deletes a module link
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @param linkId
   */
  deleteModuleLink = async (workspaceSlug: string, projectId: string, moduleId: string, linkId: string) => {
    try {
      const moduleLink = await this.moduleService.deleteModuleLink(workspaceSlug, projectId, moduleId, linkId);
      runInAction(() => {
        update(this.moduleMap, [moduleId, "link_module"], (moduleLinks = []) =>
          moduleLinks.filter((link: ILinkDetails) => link.id !== linkId)
        );
      });
      return moduleLink;
    } catch (error) {
      throw error;
    }
  };

  /**
   * @description adds a module to favorites
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns
   */
  addModuleToFavorites = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    try {
      const moduleDetails = this.getModuleById(moduleId);
      if (moduleDetails?.is_favorite) return;
      runInAction(() => {
        set(this.moduleMap, [moduleId, "is_favorite"], true);
      });
      await this.rootStore.favorite.addFavorite(workspaceSlug.toString(), {
        entity_type: "module",
        entity_identifier: moduleId,
        project_id: projectId,
        entity_data: { name: this.moduleMap[moduleId].name || "" },
      });
    } catch (error) {
      console.error("Failed to add module to favorites in module store", error);
      runInAction(() => {
        set(this.moduleMap, [moduleId, "is_favorite"], false);
      });
    }
  };

  /**
   * @description removes a module from favorites
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns
   */
  removeModuleFromFavorites = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    try {
      const moduleDetails = this.getModuleById(moduleId);
      if (!moduleDetails?.is_favorite) return;
      runInAction(() => {
        set(this.moduleMap, [moduleId, "is_favorite"], false);
      });
      await this.rootStore.favorite.removeFavoriteEntity(workspaceSlug, moduleId);
    } catch (error) {
      console.error("Failed to remove module from favorites in module store", error);
      runInAction(() => {
        set(this.moduleMap, [moduleId, "is_favorite"], true);
      });
    }
  };

  /**
   * @description archives a module
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns
   */
  archiveModule = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    const moduleDetails = this.getModuleById(moduleId);
    if (moduleDetails?.archived_at) return;
    await this.moduleArchiveService
      .archiveModule(workspaceSlug, projectId, moduleId)
      .then((response) => {
        runInAction(() => {
          set(this.moduleMap, [moduleId, "archived_at"], response.archived_at);
          if (this.rootStore.favorite.entityMap[moduleId]) this.rootStore.favorite.removeFavoriteFromStore(moduleId);
        });
      })
      .catch((error) => {
        console.error("Failed to archive module in module store", error);
      });
  };

  /**
   * @description restores a module
   * @param workspaceSlug
   * @param projectId
   * @param moduleId
   * @returns
   */
  restoreModule = async (workspaceSlug: string, projectId: string, moduleId: string) => {
    const moduleDetails = this.getModuleById(moduleId);
    if (!moduleDetails?.archived_at) return;
    await this.moduleArchiveService
      .restoreModule(workspaceSlug, projectId, moduleId)
      .then(() => {
        runInAction(() => {
          set(this.moduleMap, [moduleId, "archived_at"], null);
        });
      })
      .catch((error) => {
        console.error("Failed to restore module in module store", error);
      });
  };
}
