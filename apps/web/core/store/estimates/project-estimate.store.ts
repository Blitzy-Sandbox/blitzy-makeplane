/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project estimate collection store: per-workspace/per-project Estimate model
 * cache, lifecycle CRUD, and active/archived estimate derivation for the web
 * client's estimates feature. Registered as `CoreRootStore.projectEstimate`
 * and instantiated once in the root-store constructor and again in
 * `resetOnSignOut`.
 *
 * State slice (all `observable`; `loader` is `observable.ref`):
 *   - loader: TEstimateLoader — "init-loader" | "mutation-loader" | undefined;
 *       distinguishes initial list loading (cache empty) from mutation-driven
 *       refreshes so consumers can render skeletons only on the cold-start
 *       fetch.
 *   - estimates: Record<string, IEstimate> — keyed by estimate id. Values are
 *       hydrated `Estimate` model instances from
 *       `@/plane-web/store/estimates/estimate` (not raw API payloads), so
 *       consumers get reactive sub-models with their own estimate-point
 *       children. Do not re-wrap or deep-equal these values.
 *   - error: TErrorCodes | undefined — last action error ({ status, message? }),
 *       cleared at the start of each action.
 *
 * Actions (each calls `estimateService` from `@/services/estimate.service` and
 * batches cache writes inside `runInAction`; on failure each sets `this.error`
 * then re-throws so React Query / SWR / toast layers can react):
 *   - getWorkspaceEstimates(workspaceSlug, loader?) → fetchWorkspaceEstimates.
 *       Sets `loader` to caller value (default "mutation-loader") unless the
 *       cache is empty — in which case it forces "init-loader" so the UI knows
 *       this is a cold load. Merges each result into `estimates` via
 *       `set(this.estimates, [estimate.id], new Estimate(...))`.
 *   - getProjectEstimates(workspaceSlug, projectId, loader?) →
 *       fetchProjectEstimates. Same merge semantics as the workspace fetch,
 *       but the init-vs-mutation loader decision uses
 *       `estimateIdsByProjectId(projectId)` rather than the global cache size
 *       so the per-project cold path is detected even when other projects'
 *       estimates are already loaded.
 *   - getEstimateById(estimateId): IEstimate | undefined — synchronous
 *       `this.estimates[estimateId]` lookup; declared as a MobX `action` for
 *       symmetry with the interface, not because it mutates state.
 *   - createEstimate(workspaceSlug, projectId, payload: IEstimateFormData) →
 *       createEstimate. Inserts the returned `Estimate` into `estimates`. Does
 *       NOT update the parent project's `estimate` field — that mutation is
 *       intentionally commented out at the call site; project-level estimate-
 *       id binding currently flows through the API response, not this client
 *       action. // INTENT UNCLEAR: whether the commented-out
 *       `projectRoot.project.updateProject({ estimate: estimate.id })` block
 *       is a permanent removal or a temporary disablement.
 *   - deleteEstimate(workspaceSlug, projectId, estimateId) → deleteEstimate.
 *       Removes the entry via `unset(this.estimates, [estimateId])` on
 *       success; sets error and re-throws on failure.
 *
 * Estimate "system" normalization (non-obvious data-shape contract):
 *   Every action that constructs an `Estimate` lowercases the server-returned
 *   `estimate.type` via `estimate.type?.toLowerCase() as TEstimateSystemKeys`.
 *   `TEstimateSystemKeys` is the discriminant for how points are interpreted
 *   downstream: "points" → numeric story points, "categories" → labeled
 *   buckets (XS/S/M/L), "time" → hours/minutes durations. Consumers can
 *   therefore switch on the canonical lowercase key without re-normalizing.
 *
 * Computed (recompute when `estimates` map or `router.projectId` change):
 *   - currentActiveEstimateId: string | undefined — id of the estimate flagged
 *       `last_used` for the current `router.projectId` (one active estimate
 *       per project at a time).
 *   - currentActiveEstimate: IEstimate | undefined — the full `Estimate`
 *       instance for the same lookup; consumers prefer this over re-reading
 *       by id because it preserves reactivity on nested fields (e.g.
 *       estimate-point children).
 *   - archivedEstimateIds: string[] | undefined — estimates where
 *       `project === router.projectId && !last_used`, ordered by `created_at`
 *       descending (newest first).
 *   - currentProjectEstimateType: TEstimateSystemKeys | undefined — the
 *       `type` of the currently active estimate; drives whether the UI
 *       renders numeric points, labeled categories, or hh:mm durations.
 *
 * Computed actions (`computedFn` from mobx-utils — memoize per-argument set;
 * MobX recomputes only when the inputs the body reads change). These exist
 * alongside the route-driven getters above so cross-store callers can read
 * estimate state for projects OTHER than the active route:
 *   - areEstimateEnabledByProjectId(projectId): boolean — reads
 *       `this.store.projectRoot.project.getProjectById(projectId).estimate`;
 *       true iff that project has an estimate id bound. This is THE gate that
 *       cycle/module stores and issue-property components use to show/hide
 *       estimate dropdowns.
 *   - estimateIdsByProjectId(projectId): string[] | undefined — every estimate
 *       id (active + archived) belonging to the given project; undefined when
 *       `projectId` is falsy.
 *   - currentActiveEstimateIdByProjectId(projectId): string | undefined —
 *       parameterized variant of `currentActiveEstimateId` that does NOT
 *       depend on `router.projectId`; used by callers that already have an
 *       explicit projectId in hand (e.g. base-issues store keying caches per
 *       project).
 *   - estimateById(estimateId): IEstimate | undefined — O(1) lookup into
 *       `estimates`; returns the live `Estimate` instance so reads on its
 *       fields stay reactive.
 *
 * Consumers (verified import sites of `IProjectEstimateStore` /
 * `useProjectEstimate` / `rootStore.projectEstimate`):
 *   - apps/web/core/hooks/store/estimates/use-project-estimate.ts — exposes
 *       the store to components via `useContext` over `StoreContext`.
 *   - apps/web/core/hooks/use-project-issue-properties.ts — calls
 *       `getProjectEstimates` during project-issue property hydration.
 *   - apps/web/core/hooks/use-workspace-issue-properties.ts — calls
 *       `getWorkspaceEstimates` during workspace-issue property hydration.
 *   - apps/web/core/layouts/auth-layout/project-wrapper.tsx — calls
 *       `getProjectEstimates` on project navigation.
 *   - apps/web/core/store/issue/helpers/base-issues.store.ts — reads
 *       `currentActiveEstimateIdByProjectId` + `estimateById` for issue
 *       estimate-point resolution per project.
 *   - apps/web/core/components/cycles/analytics-sidebar/sidebar-details.tsx,
 *     apps/web/core/components/cycles/dropdowns/estimate-type-dropdown.tsx —
 *     cycle UI reads for estimate gating + type display.
 *   - apps/web/core/components/modules/analytics-sidebar/root.tsx,
 *     apps/web/core/components/modules/analytics-sidebar/issue-progress.tsx —
 *     module UI reads.
 *   - apps/web/core/components/issues/issue-modal/components/default-properties.tsx,
 *     apps/web/core/components/issues/issue-layouts/properties/all-properties.tsx,
 *     apps/web/core/components/issues/issue-detail/sidebar.tsx,
 *     apps/web/core/components/issues/workspace-draft/draft-issue-properties.tsx —
 *     read `areEstimateEnabledByProjectId` to gate estimate dropdowns.
 *   - apps/web/core/components/estimates/{root, estimate-list-item,
 *     estimate-disable-switch, create/modal, delete/modal}.tsx — settings-page
 *     consumers for list, create, update, delete, and disable flows.
 *   - apps/web/core/components/readonly/estimate.tsx,
 *     apps/web/core/components/dropdowns/estimate.tsx — read-only and
 *     interactive estimate selectors used across issue forms.
 *   - apps/web/core/components/inbox/modals/create-modal/issue-properties.tsx,
 *     apps/web/core/components/analytics/select/select-y-axis.tsx,
 *     apps/web/core/components/power-k/ui/pages/context-based/work-item/{commands,estimates-menu}.tsx —
 *     inbox / analytics / power-k surfaces.
 */
import { unset, orderBy, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { IEstimate as IEstimateType, IEstimateFormData, TEstimateSystemKeys } from "@plane/types";
// plane web services
import estimateService from "@/services/estimate.service";
// plane web store
import type { IEstimate } from "@/plane-web/store/estimates/estimate";
import { Estimate } from "@/plane-web/store/estimates/estimate";
// store
import type { CoreRootStore } from "../root.store";

type TEstimateLoader = "init-loader" | "mutation-loader" | undefined;
type TErrorCodes = {
  status: string;
  message?: string;
};

export interface IProjectEstimateStore {
  // observables
  loader: TEstimateLoader;
  estimates: Record<string, IEstimate>;
  error: TErrorCodes | undefined;
  // computed
  currentActiveEstimateId: string | undefined;
  currentActiveEstimate: IEstimate | undefined;
  archivedEstimateIds: string[] | undefined;
  currentProjectEstimateType: TEstimateSystemKeys | undefined;
  areEstimateEnabledByProjectId: (projectId: string) => boolean;
  estimateIdsByProjectId: (projectId: string) => string[] | undefined;
  currentActiveEstimateIdByProjectId: (projectId: string) => string | undefined;
  estimateById: (estimateId: string) => IEstimate | undefined;
  // actions
  getWorkspaceEstimates: (workspaceSlug: string, loader?: TEstimateLoader) => Promise<IEstimateType[] | undefined>;
  getProjectEstimates: (
    workspaceSlug: string,
    projectId: string,
    loader?: TEstimateLoader
  ) => Promise<IEstimateType[] | undefined>;
  getEstimateById: (estimateId: string) => IEstimate | undefined;
  createEstimate: (
    workspaceSlug: string,
    projectId: string,
    data: IEstimateFormData
  ) => Promise<IEstimateType | undefined>;
  deleteEstimate: (workspaceSlug: string, projectId: string, estimateId: string) => Promise<void>;
}

export class ProjectEstimateStore implements IProjectEstimateStore {
  // observables
  loader: TEstimateLoader = undefined;
  estimates: Record<string, IEstimate> = {}; // estimate_id -> estimate
  error: TErrorCodes | undefined = undefined;

  constructor(private store: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      estimates: observable,
      error: observable,
      // computed
      currentActiveEstimateId: computed,
      currentActiveEstimate: computed,
      archivedEstimateIds: computed,
      currentProjectEstimateType: computed,
      // actions
      getWorkspaceEstimates: action,
      getProjectEstimates: action,
      getEstimateById: action,
      createEstimate: action,
      deleteEstimate: action,
    });
  }

  // computed

  get currentProjectEstimateType(): TEstimateSystemKeys | undefined {
    return this.currentActiveEstimateId ? this.estimates[this.currentActiveEstimateId]?.type : undefined;
  }

  /**
   * @description get current active estimate id for a project
   * @returns { string | undefined }
   */
  get currentActiveEstimateId(): string | undefined {
    const { projectId } = this.store.router;
    if (!projectId) return undefined;
    const currentActiveEstimateId = Object.values(this.estimates || {}).find(
      (p) => p.project === projectId && p.last_used
    );
    return currentActiveEstimateId?.id ?? undefined;
  }

  // computed
  /**
   * @description get current active estimate for a project
   * @returns { string | undefined }
   */
  get currentActiveEstimate(): IEstimate | undefined {
    const { projectId } = this.store.router;
    if (!projectId) return undefined;
    const currentActiveEstimate = Object.values(this.estimates || {}).find(
      (p) => p.project === projectId && p.last_used
    );
    return currentActiveEstimate ?? undefined;
  }

  /**
   * @description get all archived estimate ids for a project
   * @returns { string[] | undefined }
   */
  get archivedEstimateIds(): string[] | undefined {
    const { projectId } = this.store.router;
    if (!projectId) return undefined;
    const archivedEstimates = orderBy(
      Object.values(this.estimates || {}).filter((p) => p.project === projectId && !p.last_used),
      ["created_at"],
      "desc"
    );
    const archivedEstimateIds = archivedEstimates.map((p) => p.id) as string[];
    return archivedEstimateIds ?? undefined;
  }

  /**
   * @description get estimates are enabled in the project or not
   * @returns { boolean }
   */
  areEstimateEnabledByProjectId = computedFn((projectId: string) => {
    if (!projectId) return false;
    const projectDetails = this.store.projectRoot.project.getProjectById(projectId);
    if (!projectDetails) return false;
    return Boolean(projectDetails.estimate) || false;
  });

  /**
   * @description get all estimate ids for a project
   * @returns { string[] | undefined }
   */
  estimateIdsByProjectId = computedFn((projectId: string) => {
    if (!projectId) return undefined;
    const projectEstimatesIds = Object.values(this.estimates || {})
      .filter((p) => p.project === projectId)
      .map((p) => p.id) as string[];
    return projectEstimatesIds ?? undefined;
  });

  /**
   * @description get current active estimate id for a project
   * @returns { string | undefined }
   */
  currentActiveEstimateIdByProjectId = computedFn((projectId: string): string | undefined => {
    if (!projectId) return undefined;
    const currentActiveEstimateId = Object.values(this.estimates || {}).find(
      (p) => p.project === projectId && p.last_used
    );
    return currentActiveEstimateId?.id ?? undefined;
  });

  /**
   * @description get estimate by id
   * @returns { IEstimate | undefined }
   */
  estimateById = computedFn((estimateId: string) => {
    if (!estimateId) return undefined;
    return this.estimates[estimateId] ?? undefined;
  });

  // actions
  /**
   * @description fetch all estimates for a workspace
   * @param { string } workspaceSlug
   * @returns { IEstimateType[] | undefined }
   */
  getWorkspaceEstimates = async (
    workspaceSlug: string,
    loader: TEstimateLoader = "mutation-loader"
  ): Promise<IEstimateType[] | undefined> => {
    try {
      this.error = undefined;
      if (Object.keys(this.estimates || {}).length <= 0) this.loader = loader ? loader : "init-loader";

      const estimates = await estimateService.fetchWorkspaceEstimates(workspaceSlug);
      if (estimates && estimates.length > 0) {
        runInAction(() => {
          estimates.forEach((estimate) => {
            if (estimate.id)
              set(
                this.estimates,
                [estimate.id],
                new Estimate(this.store, { ...estimate, type: estimate.type?.toLowerCase() as TEstimateSystemKeys })
              );
          });
        });
      }

      return estimates;
    } catch (error) {
      this.loader = undefined;
      this.error = {
        status: "error",
        message: "Error fetching estimates",
      };
      throw error;
    }
  };

  /**
   * @description fetch all estimates for a project
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @returns { IEstimateType[] | undefined }
   */
  getProjectEstimates = async (
    workspaceSlug: string,
    projectId: string,
    loader: TEstimateLoader = "mutation-loader"
  ): Promise<IEstimateType[] | undefined> => {
    try {
      this.error = undefined;
      if (!this.estimateIdsByProjectId(projectId)) this.loader = loader ? loader : "init-loader";

      const estimates = await estimateService.fetchProjectEstimates(workspaceSlug, projectId);
      if (estimates && estimates.length > 0) {
        runInAction(() => {
          estimates.forEach((estimate) => {
            if (estimate.id)
              set(
                this.estimates,
                [estimate.id],
                new Estimate(this.store, { ...estimate, type: estimate.type?.toLowerCase() as TEstimateSystemKeys })
              );
          });
        });
      }

      return estimates;
    } catch (error) {
      this.loader = undefined;
      this.error = {
        status: "error",
        message: "Error fetching estimates",
      };
      throw error;
    }
  };

  /**
   * @param { string } estimateId
   * @returns IEstimateType | undefined
   */
  getEstimateById = (estimateId: string): IEstimate | undefined => this.estimates[estimateId];

  /**
   * @description create an estimate for a project
   * @param { string } workspaceSlug
   * @param { string } projectId
   * @param { Partial<IEstimateFormData> } payload
   * @returns
   */
  createEstimate = async (
    workspaceSlug: string,
    projectId: string,
    payload: IEstimateFormData
  ): Promise<IEstimateType | undefined> => {
    try {
      this.error = undefined;

      const estimate = await estimateService.createEstimate(workspaceSlug, projectId, payload);
      if (estimate) {
        // update estimate_id in current project
        // await this.store.projectRoot.project.updateProject(workspaceSlug, projectId, {
        //   estimate: estimate.id,
        // });
        runInAction(() => {
          if (estimate.id)
            set(
              this.estimates,
              [estimate.id],
              new Estimate(this.store, { ...estimate, type: estimate.type?.toLowerCase() as TEstimateSystemKeys })
            );
        });
      }

      return estimate;
    } catch (error) {
      this.error = {
        status: "error",
        message: "Error creating estimate",
      };
      throw error;
    }
  };

  /**
   * @description delete the estimate for a project
   * @param workspaceSlug
   * @param projectId
   * @param estimateId
   */
  deleteEstimate = async (workspaceSlug: string, projectId: string, estimateId: string) => {
    try {
      await estimateService.deleteEstimate(workspaceSlug, projectId, estimateId);
      runInAction(() => estimateId && unset(this.estimates, [estimateId]));
    } catch (error) {
      this.error = {
        status: "error",
        message: "Error deleting estimate",
      };
      throw error;
    }
  };
}
