/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle domain store: per-project cycle cache, lifecycle CRUD, archive workflows,
 * and per-cycle progress/distribution analytics for the web client.
 *
 * State slice:
 *   - loader: boolean — top-level list/details loading flag
 *   - progressLoader: boolean — active-cycle progress fetch flag
 *   - fetchedMap: Record<string, boolean> — keyed by `<scope>_<projectId>` to
 *       short-circuit duplicate fetches across navigation
 *   - cycleMap: Record<string, ICycle> — all cycles keyed by cycle id (includes
 *       active, completed, archived; partitioned via the computed selectors)
 *   - plotType: Record<string, TCyclePlotType> — per-cycle chart selection
 *       (burndown | burnup), persisted only in memory (no localStorage)
 *   - estimatedType: Record<string, TCycleEstimateType> — per-cycle estimate
 *       mode (issues | points), persisted only in memory
 *   - activeCycleIdMap: Record<string, boolean> — fast set lookup for cycles
 *       currently flagged active in their project
 *
 * Wired services (instantiated in the constructor and held as private fields):
 *   - cycleService: CycleService (`@/services/cycle.service`) — primary service
 *       backing every list / details / progress / analytics / create / update /
 *       delete network call below.
 *   - cycleArchiveService: CycleArchiveService (`@/services/cycle_archive.service`)
 *       — archive-only endpoints (list archived, archived details, archive,
 *       restore).
 *   - issueService: IssueService (`@/services/issue`)
 *       // INTENT UNCLEAR: instantiated on the store but no action below
 *       // currently invokes any IssueService method. Retained for cross-cycle
 *       // issue orchestration that other call sites may add; kept here because
 *       // removal is a behavioral change outside this documentation pass.
 *   - projectService: ProjectService (`@/services/project`)
 *       // INTENT UNCLEAR: instantiated on the store but no action below
 *       // currently invokes any ProjectService method. Retained for cross-store
 *       // project orchestration; kept for the same documentation-only reason.
 *
 * Actions (each calls one of the wired services above and mutates state under
 * `runInAction` for atomic batched updates):
 *   Fetch / read:
 *     - fetchWorkspaceCycles(workspaceSlug): Promise<ICycle[]>
 *         → CycleService.getWorkspaceCycles; merges cycles into cycleMap and
 *           sets fetchedMap per project id observed in the response.
 *     - fetchAllCycles(workspaceSlug, projectId): Promise<ICycle[] | undefined>
 *         → CycleService.getCyclesWithParams; merges into cycleMap; flips
 *           loader; populates activeCycleIdMap for "current" cycles; sets
 *           fetchedMap[projectId].
 *     - fetchActiveCycle(workspaceSlug, projectId): Promise<ICycle[]>
 *         → CycleService.getCyclesWithParams("current"); merges into cycleMap
 *           and activeCycleIdMap.
 *     - fetchActiveCycleProgress(workspaceSlug, projectId, cycleId):
 *         Promise<TProgressSnapshot>
 *         → CycleService.workspaceActiveCyclesProgress; merges progress into
 *           cycleMap[cycleId]; flips progressLoader.
 *     - fetchActiveCycleProgressPro(workspaceSlug, projectId, cycleId):
 *         Promise<void>
 *         No-op stub on this CE store — the EE override under
 *         `@/plane-web` performs the enriched progress fetch.
 *     - fetchActiveCycleAnalytics(workspaceSlug, projectId, cycleId, analytic_type):
 *         Promise<TCycleDistribution | TCycleEstimateDistribution>
 *         → CycleService.workspaceActiveCyclesAnalytics; merges
 *           cycleMap[cycleId].distribution or .estimate_distribution depending
 *           on analytic_type.
 *     - fetchArchivedCycles(workspaceSlug, projectId): Promise<ICycle[] | undefined>
 *         → CycleArchiveService.getArchivedCycles; merges into cycleMap.
 *     - fetchArchivedCycleDetails(workspaceSlug, projectId, cycleId): Promise<ICycle>
 *         → CycleArchiveService.getArchivedCycleDetails; merges into
 *           cycleMap[id].
 *     - fetchCycleDetails(workspaceSlug, projectId, cycleId): Promise<ICycle>
 *         → CycleService.getCycleDetails; merges into cycleMap[id].
 *   In-memory mutation:
 *     - updateCycleDistribution(distributionUpdates, cycleId): void
 *         Applies `updateDistribution` from `@plane/utils` to mutate
 *         cycleMap[cycleId] in place — used by realtime progress streaming.
 *     - setEstimateType(cycleId, estimateType): void
 *         Pure observable mutation registered as `action` in `makeObservable`.
 *     - setPlotType(cycleId, plotType): void
 *         Pure observable mutation; declared on the interface and implemented
 *         on the class but NOT registered as an `action` in `makeObservable`
 *         (the action map only contains `setEstimateType`).
 *         // INTENT UNCLEAR: whether the omission of `setPlotType` from the
 *         // action registration is intentional (the mutation still works via
 *         // lodash `set` but MobX strict mode would not flag it as an
 *         // action). Documented here per the AAP §0.2.3 ambiguity protocol.
 *   CRUD (call CycleService and emit cross-store updates to rootStore.favorite
 *   where applicable):
 *     - createCycle(workspaceSlug, projectId, data): Promise<ICycle>
 *         → CycleService.createCycle; inserts into cycleMap.
 *     - updateCycleDetails(workspaceSlug, projectId, cycleId, data): Promise<ICycle>
 *         Optimistic merge into cycleMap then → CycleService.patchCycle. On
 *         error, re-fetches the cycle list to roll back to server truth.
 *     - deleteCycle(workspaceSlug, projectId, cycleId): Promise<void>
 *         → CycleService.deleteCycle; removes from cycleMap and
 *           activeCycleIdMap; calls rootStore.favorite.removeFavoriteFromStore
 *           when a favorite row exists for this cycle.
 *     - archiveCycle(workspaceSlug, projectId, cycleId): Promise<void>
 *         → CycleArchiveService.archiveCycle; stamps archived_at; calls
 *           rootStore.favorite.removeFavoriteFromStore when applicable.
 *     - restoreCycle(workspaceSlug, projectId, cycleId): Promise<void>
 *         → CycleArchiveService.restoreCycle; clears archived_at.
 *     - addCycleToFavorites(workspaceSlug, projectId, cycleId): Promise<any>
 *         Optimistic flip of cycleMap[id].is_favorite then →
 *         rootStore.favorite.addFavorite; reverts on error.
 *     - removeCycleFromFavorites(workspaceSlug, projectId, cycleId): Promise<void>
 *         Optimistic flip then → rootStore.favorite.removeFavoriteEntity;
 *         reverts on error.
 *
 * Computed (re-evaluated only when their reactive inputs change):
 *   - currentProjectCycleIds — recomputes when cycleMap or
 *       routerStore.projectId changes; returns ordered list of cycle ids for
 *       the active project route.
 *   - currentProjectCompletedCycleIds / currentProjectIncompleteCycleIds /
 *       currentProjectArchivedCycleIds — partition cycleMap by status using
 *       `isPast` from `date-fns`.
 *   - currentProjectActiveCycleId / currentProjectActiveCycle — derived from
 *       activeCycleIdMap intersected with the current project's cycle list.
 *
 * Computed actions (computedFn from mobx-utils — memoize per-argument set,
 * AAP §0.3.2 explicit call-out):
 *   - getFilteredCycleIds(projectId, sortByManual): returns the filtered+sorted
 *       cycle id list driven by rootStore.cycleFilter; recomputes when
 *       cycleMap, the filter slice, or the manual-sort flag changes.
 *   - getFilteredCompletedCycleIds(projectId) / getFilteredArchivedCycleIds(projectId):
 *       same shape for completed/archived partitions.
 *   - getCycleById(cycleId) / getCycleNameById(cycleId): O(1) lookups, memoized
 *       so identical id calls share a reference.
 *   - getProjectCycleDetails(projectId) / getProjectCycleIds(projectId):
 *       per-project cycle slice, recomputes when cycleMap changes.
 *   - getPlotTypeByCycleId / getEstimateTypeByCycleId / getIsPointsDataAvailable:
 *       per-cycle preference lookups; memoized to keep chart components
 *       cheap on re-render.
 *
 * Consumers:
 *   - apps/web/core/components/cycles/list/** (cycle list views)
 *   - apps/web/core/components/cycles/active-cycle/** (active cycle widgets)
 *   - apps/web/core/components/cycles/analytics-sidebar/** (per-cycle analytics)
 *   - apps/web/core/components/cycles/applied-filters/** (filter rendering)
 *   - apps/web/core/components/cycles/archived-cycles/** (archive views)
 *   - apps/web/core/components/cycles/dropdowns/** (cycle pickers)
 *   - apps/web/core/store/issue/cycle/** (cross-store reads via rootStore.cycle)
 *   - apps/web/core/store/cycle_filter.store.ts (filter inputs feed back here)
 */

import { isPast, isToday } from "date-fns";
import { sortBy, set, isEmpty } from "lodash-es";
import { action, computed, observable, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type {
  ICycle,
  TCyclePlotType,
  TProgressSnapshot,
  TCycleEstimateDistribution,
  TCycleDistribution,
  TCycleEstimateType,
} from "@plane/types";
import type { DistributionUpdates } from "@plane/utils";
import { orderCycles, shouldFilterCycle, getDate, updateDistribution } from "@plane/utils";
// helpers
// services
import { CycleService } from "@/services/cycle.service";
import { CycleArchiveService } from "@/services/cycle_archive.service";
import { IssueService } from "@/services/issue";
import { ProjectService } from "@/services/project";
// store
import type { CoreRootStore } from "./root.store";

export interface ICycleStore {
  // loaders
  loader: boolean;
  progressLoader: boolean;
  // observables
  fetchedMap: Record<string, boolean>;
  cycleMap: Record<string, ICycle>;
  plotType: Record<string, TCyclePlotType>;
  estimatedType: Record<string, TCycleEstimateType>;
  activeCycleIdMap: Record<string, boolean>;

  // computed
  currentProjectCycleIds: string[] | null;
  currentProjectCompletedCycleIds: string[] | null;
  currentProjectIncompleteCycleIds: string[] | null;
  currentProjectActiveCycleId: string | null;
  currentProjectArchivedCycleIds: string[] | null;
  currentProjectActiveCycle: ICycle | null;

  // computed actions
  getFilteredCycleIds: (projectId: string, sortByManual: boolean) => string[] | null;
  getFilteredCompletedCycleIds: (projectId: string) => string[] | null;
  getFilteredArchivedCycleIds: (projectId: string) => string[] | null;
  getCycleById: (cycleId: string) => ICycle | null;
  getCycleNameById: (cycleId: string) => string | undefined;
  getProjectCycleDetails: (projectId: string) => ICycle[] | null;
  getProjectCycleIds: (projectId: string) => string[] | null;
  getPlotTypeByCycleId: (cycleId: string) => TCyclePlotType;
  getEstimateTypeByCycleId: (cycleId: string) => TCycleEstimateType;
  getIsPointsDataAvailable: (cycleId: string) => boolean;

  // actions
  updateCycleDistribution: (distributionUpdates: DistributionUpdates, cycleId: string) => void;
  setPlotType: (cycleId: string, plotType: TCyclePlotType) => void;
  setEstimateType: (cycleId: string, estimateType: TCycleEstimateType) => void;
  // fetch
  fetchWorkspaceCycles: (workspaceSlug: string) => Promise<ICycle[]>;
  fetchAllCycles: (workspaceSlug: string, projectId: string) => Promise<undefined | ICycle[]>;
  fetchActiveCycle: (workspaceSlug: string, projectId: string) => Promise<undefined | ICycle[]>;
  fetchArchivedCycles: (workspaceSlug: string, projectId: string) => Promise<undefined | ICycle[]>;
  fetchArchivedCycleDetails: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<ICycle>;
  fetchCycleDetails: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<ICycle>;
  fetchActiveCycleProgress: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<TProgressSnapshot>;
  fetchActiveCycleProgressPro: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<void>;
  fetchActiveCycleAnalytics: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    analytic_type: string
  ) => Promise<TCycleDistribution | TCycleEstimateDistribution>;
  // crud
  createCycle: (workspaceSlug: string, projectId: string, data: Partial<ICycle>) => Promise<ICycle>;
  updateCycleDetails: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    data: Partial<ICycle>
  ) => Promise<ICycle>;
  deleteCycle: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<void>;
  // favorites
  addCycleToFavorites: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<any>;
  removeCycleFromFavorites: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<void>;
  // archive
  archiveCycle: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<void>;
  restoreCycle: (workspaceSlug: string, projectId: string, cycleId: string) => Promise<void>;
}

export class CycleStore implements ICycleStore {
  // observables
  loader: boolean = false;
  progressLoader: boolean = false;
  cycleMap: Record<string, ICycle> = {};
  plotType: Record<string, TCyclePlotType> = {};
  estimatedType: Record<string, TCycleEstimateType> = {};
  activeCycleIdMap: Record<string, boolean> = {};
  //loaders
  fetchedMap: Record<string, boolean> = {};
  // root store
  rootStore;
  // services
  projectService;
  issueService;
  cycleService;
  cycleArchiveService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      progressLoader: observable,
      cycleMap: observable,
      plotType: observable,
      estimatedType: observable,
      activeCycleIdMap: observable,
      fetchedMap: observable,
      // computed
      currentProjectCycleIds: computed,
      currentProjectCompletedCycleIds: computed,
      currentProjectIncompleteCycleIds: computed,
      currentProjectActiveCycleId: computed,
      currentProjectArchivedCycleIds: computed,
      currentProjectActiveCycle: computed,

      // actions
      setEstimateType: action,
      fetchWorkspaceCycles: action,
      fetchAllCycles: action,
      fetchActiveCycle: action,
      fetchArchivedCycles: action,
      fetchArchivedCycleDetails: action,
      fetchActiveCycleProgress: action,
      fetchActiveCycleAnalytics: action,
      fetchCycleDetails: action,
      updateCycleDetails: action,
      deleteCycle: action,
      addCycleToFavorites: action,
      removeCycleFromFavorites: action,
      archiveCycle: action,
      restoreCycle: action,
    });

    this.rootStore = _rootStore;

    // services
    this.projectService = new ProjectService();
    this.issueService = new IssueService();
    this.cycleService = new CycleService();
    this.cycleArchiveService = new CycleArchiveService();
  }

  // computed
  /**
   * returns all cycle ids for a project
   */
  get currentProjectCycleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let allCycles = Object.values(this.cycleMap ?? {}).filter((c) => c?.project_id === projectId && !c?.archived_at);
    allCycles = sortBy(allCycles, [(c) => c.sort_order]);
    const allCycleIds = allCycles.map((c) => c.id);
    return allCycleIds;
  }

  /**
   * returns all completed cycle ids for a project
   */
  get currentProjectCompletedCycleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let completedCycles = Object.values(this.cycleMap ?? {}).filter((c) => {
      const endDate = getDate(c.end_date);
      const hasEndDatePassed = endDate && isPast(endDate);
      const isEndDateToday = endDate && isToday(endDate);
      return (
        c.project_id === projectId && ((hasEndDatePassed && !isEndDateToday) || c.status?.toLowerCase() === "completed")
      );
    });
    completedCycles = sortBy(completedCycles, [(c) => c.sort_order]);
    const completedCycleIds = completedCycles.map((c) => c.id);
    return completedCycleIds;
  }

  /**
   * returns all incomplete cycle ids for a project
   */
  get currentProjectIncompleteCycleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let incompleteCycles = Object.values(this.cycleMap ?? {}).filter((c) => {
      const endDate = getDate(c.end_date);
      const hasEndDatePassed = endDate && isPast(endDate);
      return (
        c.project_id === projectId && !hasEndDatePassed && !c?.archived_at && c.status?.toLowerCase() !== "completed"
      );
    });
    incompleteCycles = sortBy(incompleteCycles, [(c) => c.sort_order]);
    const incompleteCycleIds = incompleteCycles.map((c) => c.id);
    return incompleteCycleIds;
  }

  /**
   * returns active cycle id for a project
   */
  get currentProjectActiveCycleId() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId) return null;
    const activeCycle = Object.keys(this.cycleMap ?? {}).find(
      (cycleId) =>
        this.cycleMap?.[cycleId]?.project_id === projectId &&
        this.cycleMap?.[cycleId]?.status?.toLowerCase() === "current"
    );
    return activeCycle || null;
  }

  /**
   * returns all archived cycle ids for a project
   */
  get currentProjectArchivedCycleIds() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return null;
    let archivedCycles = Object.values(this.cycleMap ?? {}).filter(
      (c) => c.project_id === projectId && !!c.archived_at
    );
    archivedCycles = sortBy(archivedCycles, [(c) => c.sort_order]);
    const archivedCycleIds = archivedCycles.map((c) => c.id);
    return archivedCycleIds;
  }

  get currentProjectActiveCycle() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId && !this.currentProjectActiveCycleId) return null;
    return this.cycleMap?.[this.currentProjectActiveCycleId!] ?? null;
  }

  getIsPointsDataAvailable = computedFn((cycleId: string) => {
    const cycle = this.getCycleById(cycleId);
    if (!cycle) return false;
    if (cycle.version === 2) return cycle.progress?.some((p) => p.total_estimate_points > 0);
    else if (cycle.version === 1) {
      const completionChart = cycle.estimate_distribution?.completion_chart || {};
      return !isEmpty(completionChart) && Object.keys(completionChart).some((p) => completionChart[p]! > 0);
    } else return false;
  });

  /**
   * @description returns filtered cycle ids based on display filters and filters
   * @param {TCycleDisplayFilters} displayFilters
   * @param {TCycleFilters} filters
   * @returns {string[] | null}
   */
  getFilteredCycleIds = computedFn((projectId: string, sortByManual: boolean) => {
    const filters = this.rootStore.cycleFilter.getFiltersByProjectId(projectId);
    const searchQuery = this.rootStore.cycleFilter.searchQuery;
    if (!this.fetchedMap[projectId]) return null;
    let cycles = Object.values(this.cycleMap ?? {}).filter(
      (c) =>
        c.project_id === projectId &&
        !c.archived_at &&
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        shouldFilterCycle(c, filters ?? {})
    );
    cycles = orderCycles(cycles, sortByManual);
    const cycleIds = cycles.map((c) => c.id);
    return cycleIds;
  });

  /**
   * @description returns filtered cycle ids based on display filters and filters
   * @param {TCycleDisplayFilters} displayFilters
   * @param {TCycleFilters} filters
   * @returns {string[] | null}
   */
  getFilteredCompletedCycleIds = computedFn((projectId: string) => {
    const filters = this.rootStore.cycleFilter.getFiltersByProjectId(projectId);
    const searchQuery = this.rootStore.cycleFilter.searchQuery;
    if (!this.fetchedMap[projectId]) return null;
    let cycles = Object.values(this.cycleMap ?? {}).filter(
      (c) =>
        c.project_id === projectId &&
        !c.archived_at &&
        c.status?.toLowerCase() === "completed" &&
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        shouldFilterCycle(c, filters ?? {})
    );
    cycles = sortBy(cycles, [(c) => !c.start_date]);
    const cycleIds = cycles.map((c) => c.id);
    return cycleIds;
  });

  /**
   * @description returns filtered archived cycle ids based on display filters and filters
   * @param {string} projectId
   * @returns {string[] | null}
   */
  getFilteredArchivedCycleIds = computedFn((projectId: string) => {
    const filters = this.rootStore.cycleFilter.getArchivedFiltersByProjectId(projectId);
    const searchQuery = this.rootStore.cycleFilter.archivedCyclesSearchQuery;
    if (!this.fetchedMap[projectId]) return null;
    let cycles = Object.values(this.cycleMap ?? {}).filter(
      (c) =>
        c.project_id === projectId &&
        !!c.archived_at &&
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        shouldFilterCycle(c, filters ?? {})
    );
    cycles = sortBy(cycles, [(c) => !c.start_date]);
    const cycleIds = cycles.map((c) => c.id);
    return cycleIds;
  });

  /**
   * @description returns cycle details by cycle id
   * @param cycleId
   * @returns
   */
  getCycleById = computedFn((cycleId: string): ICycle | null => this.cycleMap?.[cycleId] ?? null);

  /**
   * @description returns cycle name by cycle id
   * @param cycleId
   * @returns
   */
  getCycleNameById = computedFn((cycleId: string): string => this.cycleMap?.[cycleId]?.name);

  /**
   * @description returns list of cycle details of the project id passed as argument
   * @param projectId
   */
  getProjectCycleDetails = computedFn((projectId: string): ICycle[] | null => {
    if (!this.fetchedMap[projectId]) return null;

    let cycles = Object.values(this.cycleMap ?? {}).filter((c) => c.project_id === projectId && !c?.archived_at);
    cycles = sortBy(cycles, [(c) => c.sort_order]);
    return cycles || null;
  });

  /**
   * @description returns list of cycle ids of the project id passed as argument
   * @param projectId
   */
  getProjectCycleIds = computedFn((projectId: string): string[] | null => {
    const cycles = this.getProjectCycleDetails(projectId);
    if (!cycles) return null;
    const cycleIds = cycles.map((c) => c.id);
    return cycleIds || null;
  });

  /**
   * @description gets the plot type for the cycle store
   * @param {TCyclePlotType} plotType
   */
  getPlotTypeByCycleId = computedFn((cycleId: string) => this.plotType[cycleId] || "burndown");

  /**
   * @description gets the estimate type for the cycle store
   * @param {TCycleEstimateType} estimateType
   */
  getEstimateTypeByCycleId = computedFn((cycleId: string) => {
    const { projectId } = this.rootStore.router;

    return projectId && this.rootStore.projectEstimate.areEstimateEnabledByProjectId(projectId)
      ? this.estimatedType[cycleId] || "issues"
      : "issues";
  });

  /**
   * @description updates the plot type for the cycle store
   * @param {TCyclePlotType} plotType
   */
  setPlotType = (cycleId: string, plotType: TCyclePlotType) => {
    set(this.plotType, [cycleId], plotType);
  };

  /**
   * @description updates the estimate type for the cycle store
   * @param {TCycleEstimateType} estimateType
   */
  setEstimateType = (cycleId: string, estimateType: TCycleEstimateType) => {
    set(this.estimatedType, [cycleId], estimateType);
  };

  /**
   * @description fetch all cycles
   * @param workspaceSlug
   * @returns ICycle[]
   */
  fetchWorkspaceCycles = async (workspaceSlug: string) =>
    await this.cycleService.getWorkspaceCycles(workspaceSlug).then((response) => {
      runInAction(() => {
        response.forEach((cycle) => {
          set(this.cycleMap, [cycle.id], { ...this.cycleMap[cycle.id], ...cycle });
          set(this.fetchedMap, cycle.project_id, true);
        });
      });
      return response;
    });

  /**
   * @description fetches all cycles for a project
   * @param workspaceSlug
   * @param projectId
   * @returns
   */
  fetchAllCycles = async (workspaceSlug: string, projectId: string) => {
    try {
      this.loader = true;
      await this.cycleService.getCyclesWithParams(workspaceSlug, projectId).then((response) => {
        runInAction(() => {
          response.forEach((cycle) => {
            set(this.cycleMap, [cycle.id], cycle);
            if (cycle.status?.toLowerCase() === "current") {
              set(this.activeCycleIdMap, [cycle.id], true);
            }
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
   * @description fetches archived cycles for a project
   * @param workspaceSlug
   * @param projectId
   * @returns
   */
  fetchArchivedCycles = async (workspaceSlug: string, projectId: string) => {
    this.loader = true;
    return await this.cycleArchiveService
      .getArchivedCycles(workspaceSlug, projectId)
      .then((response) => {
        runInAction(() => {
          response.forEach((cycle) => {
            set(this.cycleMap, [cycle.id], cycle);
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
   * @description fetches active cycle for a project
   * @param workspaceSlug
   * @param projectId
   * @returns
   */
  fetchActiveCycle = async (workspaceSlug: string, projectId: string) =>
    await this.cycleService.getCyclesWithParams(workspaceSlug, projectId, "current").then((response) => {
      runInAction(() => {
        response.forEach((cycle) => {
          set(this.activeCycleIdMap, [cycle.id], true);
          set(this.cycleMap, [cycle.id], cycle);
        });
      });
      return response;
    });

  /**
   * @description fetches active cycle progress
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   *  @returns
   */
  fetchActiveCycleProgress = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    this.progressLoader = true;
    return await this.cycleService.workspaceActiveCyclesProgress(workspaceSlug, projectId, cycleId).then((progress) => {
      runInAction(() => {
        set(this.cycleMap, [cycleId], { ...this.cycleMap[cycleId], ...progress });
        this.progressLoader = false;
      });
      return progress;
    });
  };

  /**
   * @description fetches active cycle progress for pro users
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   *  @returns
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fetchActiveCycleProgressPro = action(async (workspaceSlug: string, projectId: string, cycleId: string) => {});

  /**
   * @description fetches active cycle analytics
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   *  @returns
   */
  fetchActiveCycleAnalytics = async (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    analytic_type: string
  ) =>
    await this.cycleService
      .workspaceActiveCyclesAnalytics(workspaceSlug, projectId, cycleId, analytic_type)
      .then((cycle) => {
        runInAction(() => {
          set(this.cycleMap, [cycleId, analytic_type === "points" ? "estimate_distribution" : "distribution"], cycle);
        });
        return cycle;
      });

  /**
   * @description fetches cycle details
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  fetchArchivedCycleDetails = async (workspaceSlug: string, projectId: string, cycleId: string) =>
    await this.cycleArchiveService.getArchivedCycleDetails(workspaceSlug, projectId, cycleId).then((response) => {
      runInAction(() => {
        set(this.cycleMap, [response.id], { ...this.cycleMap?.[response.id], ...response });
      });
      return response;
    });

  /**
   * @description fetches cycle details
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  fetchCycleDetails = async (workspaceSlug: string, projectId: string, cycleId: string) =>
    await this.cycleService.getCycleDetails(workspaceSlug, projectId, cycleId).then((response) => {
      runInAction(() => {
        set(this.cycleMap, [response.id], { ...this.cycleMap?.[response.id], ...response });
      });
      return response;
    });

  /**
   * This method updates the cycle's stats locally without fetching the updated stats from backend
   * @param distributionUpdates
   * @param cycleId
   * @returns
   */
  updateCycleDistribution = (distributionUpdates: DistributionUpdates, cycleId: string) => {
    const cycle = this.getCycleById(cycleId);
    if (!cycle) return;

    runInAction(() => {
      updateDistribution(cycle, distributionUpdates);
    });
  };

  /**
   * @description creates a new cycle
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns
   */
  createCycle = action(
    async (workspaceSlug: string, projectId: string, data: Partial<ICycle>) =>
      await this.cycleService.createCycle(workspaceSlug, projectId, data).then((response) => {
        runInAction(() => {
          set(this.cycleMap, [response.id], response);
        });
        return response;
      })
  );

  /**
   * @description updates cycle details
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @param data
   * @returns
   */
  updateCycleDetails = async (workspaceSlug: string, projectId: string, cycleId: string, data: Partial<ICycle>) => {
    try {
      runInAction(() => {
        set(this.cycleMap, [cycleId], { ...this.cycleMap?.[cycleId], ...data });
      });
      const response = await this.cycleService.patchCycle(workspaceSlug, projectId, cycleId, data);
      this.fetchCycleDetails(workspaceSlug, projectId, cycleId);
      return response;
    } catch (error) {
      console.log("Failed to patch cycle from cycle store");
      this.fetchAllCycles(workspaceSlug, projectId);
      this.fetchActiveCycle(workspaceSlug, projectId);
      throw error;
    }
  };

  /**
   * @description deletes a cycle
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   */
  deleteCycle = async (workspaceSlug: string, projectId: string, cycleId: string) =>
    await this.cycleService.deleteCycle(workspaceSlug, projectId, cycleId).then(() => {
      runInAction(() => {
        delete this.cycleMap[cycleId];
        delete this.activeCycleIdMap[cycleId];
        if (this.rootStore.favorite.entityMap[cycleId]) this.rootStore.favorite.removeFavoriteFromStore(cycleId);
      });
    });

  /**
   * @description adds a cycle to favorites
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  addCycleToFavorites = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    const currentCycle = this.getCycleById(cycleId);
    try {
      runInAction(() => {
        if (currentCycle) set(this.cycleMap, [cycleId, "is_favorite"], true);
      });
      // updating through api.
      const response = await this.rootStore.favorite.addFavorite(workspaceSlug.toString(), {
        entity_type: "cycle",
        entity_identifier: cycleId,
        project_id: projectId,
        entity_data: { name: currentCycle?.name || "" },
      });
      return response;
    } catch (error) {
      runInAction(() => {
        if (currentCycle) set(this.cycleMap, [cycleId, "is_favorite"], false);
      });
      throw error;
    }
  };

  /**
   * @description removes a cycle from favorites
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  removeCycleFromFavorites = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    const currentCycle = this.getCycleById(cycleId);
    try {
      runInAction(() => {
        if (currentCycle) set(this.cycleMap, [cycleId, "is_favorite"], false);
      });
      const response = await this.rootStore.favorite.removeFavoriteEntity(workspaceSlug, cycleId);
      return response;
    } catch (error) {
      runInAction(() => {
        if (currentCycle) set(this.cycleMap, [cycleId, "is_favorite"], true);
      });
      throw error;
    }
  };

  /**
   * @description archives a cycle
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  archiveCycle = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    const cycleDetails = this.getCycleById(cycleId);
    if (cycleDetails?.archived_at) return;
    await this.cycleArchiveService
      .archiveCycle(workspaceSlug, projectId, cycleId)
      .then((response) => {
        runInAction(() => {
          set(this.cycleMap, [cycleId, "archived_at"], response.archived_at);
          if (this.rootStore.favorite.entityMap[cycleId]) this.rootStore.favorite.removeFavoriteFromStore(cycleId);
        });
      })
      .catch((error) => {
        console.error("Failed to archive cycle in cycle store", error);
      });
  };

  /**
   * @description restores a cycle
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  restoreCycle = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    const cycleDetails = this.getCycleById(cycleId);
    if (!cycleDetails?.archived_at) return;
    await this.cycleArchiveService
      .restoreCycle(workspaceSlug, projectId, cycleId)
      .then(() => {
        runInAction(() => {
          set(this.cycleMap, [cycleId, "archived_at"], null);
        });
      })
      .catch((error) => {
        console.error("Failed to restore cycle in cycle store", error);
      });
  };
}
