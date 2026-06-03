/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Estimate-point reactive model: a single per-point entity wrapper composed
 * into the parent `Estimate` instance (from
 * `@/plane-web/store/estimates/estimate`), which in turn lives inside
 * `project-estimate.store.ts`'s `estimates` map. Each `EstimatePoint` owns
 * its own observable field set, an `asJson` snapshot projection, an
 * optimistic local-update helper, and an async `updateEstimatePoint` action
 * that persists changes through `estimateService.updateEstimatePoint`.
 *
 * State slice (every data-model field is `observable.ref` and starts as
 * `undefined` until the constructor hydrates it from `data`):
 *   - id: string | undefined — server-assigned point uuid.
 *   - key: number | undefined — display order / numeric position within the
 *       owning estimate (1..N for points, ordinal for categories).
 *   - value: string | undefined — the user-visible point value; semantics
 *       depend on the parent estimate's `TEstimateSystemKeys` (numeric
 *       points, category label, or duration in hh:mm).
 *   - description: string | undefined — optional long-form description.
 *   - workspace / project / estimate: string | undefined — id references
 *       back up the workspace -> project -> estimate ownership chain.
 *       `estimate` holds the parent estimate id (NOT a parent object
 *       reference — see the composition contract below).
 *   - created_at / updated_at: Date | undefined — server timestamps.
 *   - created_by / updated_by: string | undefined — actor user ids.
 *   - error: TErrorCodes | undefined — last action error (status + optional
 *       message); currently set only by upstream callers, not by the
 *       actions in this class.
 *
 * Computed (registered in `makeObservable`):
 *   - asJson: IEstimatePointType — plain-object snapshot of all 11
 *       data-model fields. Recomputes whenever any data-model observable
 *       changes. Used by form initial values, copy/duplicate flows, and
 *       external consumers that need a non-reactive object (e.g. payload
 *       assembly).
 *
 * Helper action (intentionally NOT in the `makeObservable` block — it is a
 * plain arrow-function field, not a tracked MobX action). This is safe
 * because the mutation goes through `lodash-es/set` against the class
 * instance whose fields are themselves `observable.ref`, so subscribers
 * still fire on the underlying field writes:
 *   - updateEstimatePointObject(estimatePoint): void — synchronously copies
 *       the provided fields onto `this`. Used by parent flows that need
 *       optimistic UI updates BEFORE the network round-trip (e.g. inline
 *       editing).
 *
 * Actions (registered in `makeObservable`):
 *   - updateEstimatePoint(workspaceSlug, projectId, payload):
 *       Promise<IEstimatePointType | undefined> — calls
 *       `estimateService.updateEstimatePoint(workspaceSlug, projectId,
 *       this.projectEstimate.id, this.id, payload)`. On success, copies the
 *       returned fields back into this instance inside `runInAction` using
 *       per-key `set` calls (preserves observable identity so MobX
 *       subscribers fire correctly). Bails out with `undefined` if the
 *       parent estimate id, this point's id, or the payload is missing.
 *       Re-throws on service error — the file-level
 *       `eslint-disable no-useless-catch` directive at the top silences the
 *       linter for the explicit try/catch that is retained as a hook for
 *       future logging.
 *
 * Composition contract:
 *   - Constructor signature is `(store, projectEstimate, data)`. The parent
 *     estimate is the SECOND argument by deliberate choice: the parent
 *     `Estimate` model is always known at construction time while `data`
 *     may come from a fetch response. Future EE extensions must not swap
 *     this ordering.
 *   - The parent reference is captured by closure because the data payload
 *     itself only carries `estimate: string` (the parent's id), not a
 *     parent object pointer — without the constructor capture this class
 *     would have no way to call `updateEstimatePoint` against the correct
 *     estimate.
 *   - `store: CoreRootStore` is captured for forward-compatibility with
 *     cross-store reads (e.g. user/permission-aware overrides in EE
 *     extensions); the core class does not currently read from it, but the
 *     parameter must NOT be pruned.
 *
 * Consumers:
 *   - apps/web/ce/store/estimates/estimate.ts — the parent `Estimate` class
 *       constructs `EstimatePoint` instances and exposes them via
 *       `estimate.estimatePoints` and `estimate.estimatePointById` (the
 *       composition root for the per-point sub-models).
 *   - apps/web/core/hooks/store/estimates/use-estimate-point.ts — exposes
 *       points to React components via the path
 *       `context.projectEstimate.estimates?.[estimateId]?.estimatePoints?.[estimatePointId]`.
 *   - apps/web/core/components/estimates/points/update.tsx — per-point edit
 *       UI consumes `useEstimatePoint` and invokes `updateEstimatePoint`.
 *   - apps/web/core/components/estimates/estimate-list-item.tsx — reads
 *       `estimatePointById(...).value` for display.
 *   - apps/web/core/components/readonly/estimate.tsx — read-only estimate
 *       value renderer reads `value` and interprets it per the parent
 *       estimate's `TEstimateSystemKeys`.
 */

/* eslint-disable no-useless-catch */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// types
import type { IEstimate, IEstimatePoint as IEstimatePointType } from "@plane/types";
// plane web services
import estimateService from "@/services/estimate.service";
// store
import type { CoreRootStore } from "@/store/root.store";

type TErrorCodes = {
  status: string;
  message?: string;
};

export interface IEstimatePoint extends IEstimatePointType {
  // observables
  error: TErrorCodes | undefined;
  // computed
  asJson: IEstimatePointType;
  // helper actions
  updateEstimatePointObject: (estimatePoint: Partial<IEstimatePointType>) => void;
  // actions
  updateEstimatePoint: (
    workspaceSlug: string,
    projectId: string,
    payload: Partial<IEstimatePointType>
  ) => Promise<IEstimatePointType | undefined>;
}

export class EstimatePoint implements IEstimatePoint {
  // data model observables
  id: string | undefined = undefined;
  key: number | undefined = undefined;
  value: string | undefined = undefined;
  description: string | undefined = undefined;
  workspace: string | undefined = undefined;
  project: string | undefined = undefined;
  estimate: string | undefined = undefined;
  created_at: Date | undefined = undefined;
  updated_at: Date | undefined = undefined;
  created_by: string | undefined = undefined;
  updated_by: string | undefined = undefined;
  // observables
  error: TErrorCodes | undefined = undefined;

  constructor(
    private store: CoreRootStore,
    private projectEstimate: IEstimate,
    private data: IEstimatePointType
  ) {
    makeObservable(this, {
      // data model observables
      id: observable.ref,
      key: observable.ref,
      value: observable.ref,
      description: observable.ref,
      workspace: observable.ref,
      project: observable.ref,
      estimate: observable.ref,
      created_at: observable.ref,
      updated_at: observable.ref,
      created_by: observable.ref,
      updated_by: observable.ref,
      // observables
      error: observable.ref,
      // computed
      asJson: computed,
      // actions
      updateEstimatePoint: action,
    });
    this.id = this.data.id;
    this.key = this.data.key;
    this.value = this.data.value;
    this.description = this.data.description;
    this.workspace = this.data.workspace;
    this.project = this.data.project;
    this.estimate = this.data.estimate;
    this.created_at = this.data.created_at;
    this.updated_at = this.data.updated_at;
    this.created_by = this.data.created_by;
    this.updated_by = this.data.updated_by;
  }

  // computed
  get asJson() {
    return {
      id: this.id,
      key: this.key,
      value: this.value,
      description: this.description,
      workspace: this.workspace,
      project: this.project,
      estimate: this.estimate,
      created_at: this.created_at,
      updated_at: this.updated_at,
      created_by: this.created_by,
      updated_by: this.updated_by,
    };
  }

  // helper actions
  /**
   * @description updating an estimate point object in local store
   * @param { Partial<IEstimatePointType> } estimatePoint
   * @returns { void }
   */
  updateEstimatePointObject = (estimatePoint: Partial<IEstimatePointType>) => {
    Object.keys(estimatePoint).map((key) => {
      const estimatePointKey = key as keyof IEstimatePointType;
      set(this, estimatePointKey, estimatePoint[estimatePointKey]);
    });
  };

  // actions
  /**
   * @description updating an estimate point
   * @param { Partial<IEstimatePointType> } payload
   * @returns { IEstimatePointType | undefined }
   */
  updateEstimatePoint = async (
    workspaceSlug: string,
    projectId: string,
    payload: Partial<IEstimatePointType>
  ): Promise<IEstimatePointType | undefined> => {
    try {
      if (!this.projectEstimate?.id || !this.id || !payload) return undefined;

      const estimatePoint = await estimateService.updateEstimatePoint(
        workspaceSlug,
        projectId,
        this.projectEstimate?.id,
        this.id,
        payload
      );
      if (estimatePoint) {
        runInAction(() => {
          Object.keys(payload).map((key) => {
            const estimatePointKey = key as keyof IEstimatePointType;
            set(this, estimatePointKey, estimatePoint[estimatePointKey]);
          });
        });
      }

      return estimatePoint;
    } catch (error) {
      throw error;
    }
  };
}
