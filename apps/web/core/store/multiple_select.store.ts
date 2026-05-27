/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Multiple-select store: shared multi-entity selection state with active-entity
 * navigation pointers and computed selection helpers; used by bulk-action UI
 * primitives and selectable list/spreadsheet/gantt layouts in `apps/web`.
 *
 * Selection state is purely in-memory — none of the actions registered in
 * `makeObservable` issue network calls. Keyboard and mouse semantics
 * (ctrl/shift-click range fill, arrow-key navigation, route-change reset) are
 * layered on top through the `useMultipleSelect` hook at
 * `apps/web/core/hooks/use-multiple-select.ts`.
 *
 * State slice (observables on `MultipleSelectStore`):
 *   - selectedEntityDetails: TEntityDetails[] — currently selected entities,
 *     each tagged with its group key so range fills can stay within a group.
 *   - lastSelectedEntityDetails: TEntityDetails | null — anchor for shift-click
 *     range fill; refreshed on every add/remove.
 *   - activeEntityDetails: TEntityDetails | null — currently focused entity;
 *     drives the keyboard-navigation highlight in consuming components.
 *   - previousActiveEntity / nextActiveEntity: TEntityDetails | null —
 *     pre-computed navigation cursor neighbors so arrow keys advance focus
 *     without re-scanning the rendered list.
 *
 * Wired services (instantiated in the constructor and held as private fields):
 *   - issueService: IssueService (`@/services/issue`)
 *       // INTENT UNCLEAR: instantiated on the store but none of the actions
 *       // registered in `makeObservable` invoke any IssueService method. The
 *       // store's selection actions remain purely in-memory. Retained because
 *       // removing the construction would be a behavioral change outside the
 *       // documentation-only scope of this work, and consumer call sites may
 *       // ultimately reach into it for bulk issue mutations.
 *
 * Computed (top-level getters — recompute when observables mutate):
 *   - isSelectionActive: boolean — true when at least one entity is selected;
 *     gates bulk-action toolbar visibility in consumers.
 *   - selectedEntityIds: string[] — flat id list projected from
 *     selectedEntityDetails for bulk-mutation API payloads.
 *
 * Computed selectors (computedFn — recompute per distinct argument):
 *   - getIsEntitySelected(entityID) / getIsEntityActive(entityID) — per-row
 *     boolean selectors used by every list/spreadsheet/gantt row to render
 *     selected and active visual states.
 *   - getEntityDetailsFromEntityID(entityID) — returns the entity tuple
 *     (id + group key) if currently selected, else null.
 *   - getActiveEntityDetails / getLastSelectedEntityDetails /
 *     getPreviousActiveEntity / getNextActiveEntity — read-only mirrors of the
 *     navigation/anchor observables.
 *
 * Actions (each mutates observables only — wrapped in `runInAction`, no API
 * calls from this file):
 *   - updateSelectedEntityDetails(entityDetails, "add" | "remove") — toggle a
 *     single entity and refresh the last-selected anchor used by range fills.
 *   - bulkUpdateSelectedEntityDetails(entitiesList, "add" | "remove") — batch
 *     path used for shift-click range fills and group-level select-all/clear.
 *   - updateActiveEntityDetails / updatePreviousActiveEntity /
 *     updateNextActiveEntity / updateLastSelectedEntityDetails — cursor and
 *     anchor setters invoked by `useMultipleSelect` in response to keyboard
 *     or mouse input.
 *   - clearSelection() — reset every observable to its empty state; also
 *     invoked from `CoreRootStore.resetOnSignOut` on sign-out.
 *
 * Composition:
 *   - Instantiated once by `CoreRootStore` as `multipleSelect` and re-created
 *     on sign-out (`apps/web/core/store/root.store.ts`). The constructor
 *     takes no arguments — this store does not read sibling stores.
 *
 * Consumers (resolved via the `useMultipleSelectStore` hook at
 * `apps/web/core/hooks/store/use-multiple-select-store.ts`):
 *   - apps/web/core/components/core/multiple-select/** — selection primitives
 *     (select-group, entity-select-action, group-select-action).
 *   - apps/web/core/components/issues/issue-layouts/list/** — list view rows
 *     and group headers.
 *   - apps/web/core/components/issues/issue-layouts/spreadsheet/** —
 *     spreadsheet row and header selection.
 *   - apps/web/core/components/gantt-chart/sidebar/issues/** and
 *     gantt-chart/blocks/** — gantt sidebar and timeline block selection.
 *   - apps/web/core/hooks/use-multiple-select.ts — wires keyboard and mouse
 *     events onto the action surface above.
 */

import { differenceWith, remove, isEqual } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// hooks
import type { TEntityDetails } from "@/hooks/use-multiple-select";
// services
import { IssueService } from "@/services/issue";

export type IMultipleSelectStore = {
  // computed functions
  isSelectionActive: boolean;
  selectedEntityIds: string[];
  // helper actions
  getIsEntitySelected: (entityID: string) => boolean;
  getIsEntityActive: (entityID: string) => boolean;
  getLastSelectedEntityDetails: () => TEntityDetails | null;
  getPreviousActiveEntity: () => TEntityDetails | null;
  getNextActiveEntity: () => TEntityDetails | null;
  getActiveEntityDetails: () => TEntityDetails | null;
  getEntityDetailsFromEntityID: (entityID: string) => TEntityDetails | null;
  // entity actions
  updateSelectedEntityDetails: (entityDetails: TEntityDetails, action: "add" | "remove") => void;
  bulkUpdateSelectedEntityDetails: (entitiesList: TEntityDetails[], action: "add" | "remove") => void;
  updateLastSelectedEntityDetails: (entityDetails: TEntityDetails | null) => void;
  updatePreviousActiveEntity: (entityDetails: TEntityDetails | null) => void;
  updateNextActiveEntity: (entityDetails: TEntityDetails | null) => void;
  updateActiveEntityDetails: (entityDetails: TEntityDetails | null) => void;
  clearSelection: () => void;
};

/**
 * @description the MultipleSelectStore manages multiple selection states by keeping track of the selected entities and providing a bunch of helper functions and actions to maintain the selected states
 * @description use the useMultipleSelectStore custom hook to access the observables
 * @description use the useMultipleSelect custom hook for added functionality on top of the store, including-
 * 1. Keyboard and mouse interaction
 * 2. Clear state on route change
 */
export class MultipleSelectStore implements IMultipleSelectStore {
  // observables
  selectedEntityDetails: TEntityDetails[] = [];
  lastSelectedEntityDetails: TEntityDetails | null = null;
  previousActiveEntity: TEntityDetails | null = null;
  nextActiveEntity: TEntityDetails | null = null;
  activeEntityDetails: TEntityDetails | null = null;
  // service
  issueService;

  constructor() {
    makeObservable(this, {
      // observables
      selectedEntityDetails: observable,
      lastSelectedEntityDetails: observable,
      previousActiveEntity: observable,
      nextActiveEntity: observable,
      activeEntityDetails: observable,
      // computed functions
      isSelectionActive: computed,
      selectedEntityIds: computed,
      // actions
      updateSelectedEntityDetails: action,
      bulkUpdateSelectedEntityDetails: action,
      updateLastSelectedEntityDetails: action,
      updatePreviousActiveEntity: action,
      updateNextActiveEntity: action,
      updateActiveEntityDetails: action,
      clearSelection: action,
    });

    this.issueService = new IssueService();
  }

  get isSelectionActive() {
    return this.selectedEntityDetails.length > 0;
  }

  get selectedEntityIds() {
    return this.selectedEntityDetails.map((en) => en.entityID);
  }

  // helper actions
  /**
   * @description returns if the entity is selected or not
   * @param {string} entityID
   * @returns {boolean}
   */
  getIsEntitySelected = computedFn((entityID: string): boolean =>
    this.selectedEntityDetails.some((en) => en.entityID === entityID)
  );

  /**
   * @description returns if the entity is active or not
   * @param {string} entityID
   * @returns {boolean}
   */
  getIsEntityActive = computedFn((entityID: string): boolean => this.activeEntityDetails?.entityID === entityID);

  /**
   * @description get the last selected entity details
   * @returns {TEntityDetails}
   */
  getLastSelectedEntityDetails = computedFn(() => this.lastSelectedEntityDetails);

  /**
   * @description get the details of the entity preceding the active entity
   * @returns {TEntityDetails}
   */
  getPreviousActiveEntity = computedFn(() => this.previousActiveEntity);

  /**
   * @description get the details of the entity succeeding the active entity
   * @returns {TEntityDetails}
   */
  getNextActiveEntity = computedFn(() => this.nextActiveEntity);

  /**
   * @description get the active entity details
   * @returns {TEntityDetails}
   */
  getActiveEntityDetails = computedFn(() => this.activeEntityDetails);

  /**
   * @description get the entity details from entityID
   * @param {string} entityID
   * @returns {TEntityDetails | null}
   */
  getEntityDetailsFromEntityID = computedFn(
    (entityID: string): TEntityDetails | null =>
      this.selectedEntityDetails.find((en) => en.entityID === entityID) ?? null
  );

  // entity actions
  /**
   * @description add or remove entities
   * @param {TEntityDetails} entityDetails
   * @param {"add" | "remove"} action
   */
  updateSelectedEntityDetails = (entityDetails: TEntityDetails, action: "add" | "remove") => {
    if (action === "add") {
      runInAction(() => {
        if (this.getIsEntitySelected(entityDetails.entityID)) {
          remove(this.selectedEntityDetails, (en) => en.entityID === entityDetails.entityID);
        }
        this.selectedEntityDetails.push(entityDetails);
        this.updateLastSelectedEntityDetails(entityDetails);
      });
    } else {
      let currentSelection = [...this.selectedEntityDetails];
      currentSelection = currentSelection.filter((en) => en.entityID !== entityDetails.entityID);
      runInAction(() => {
        remove(this.selectedEntityDetails, (en) => en.entityID === entityDetails.entityID);
        this.updateLastSelectedEntityDetails(currentSelection[currentSelection.length - 1] ?? null);
      });
    }
  };

  /**
   * @description add or remove multiple entities
   * @param {TEntityDetails[]} entitiesList
   * @param {"add" | "remove"} action
   */
  bulkUpdateSelectedEntityDetails = (entitiesList: TEntityDetails[], action: "add" | "remove") => {
    if (action === "add") {
      runInAction(() => {
        let newEntities: TEntityDetails[] = [];
        newEntities = differenceWith(this.selectedEntityDetails, entitiesList, isEqual);
        newEntities = newEntities.concat(entitiesList);
        this.selectedEntityDetails = newEntities;
        if (entitiesList.length > 0) this.updateLastSelectedEntityDetails(entitiesList[entitiesList.length - 1]);
      });
    } else {
      const newEntities = differenceWith(this.selectedEntityDetails, entitiesList, (obj1, obj2) =>
        isEqual(obj1.entityID, obj2.entityID)
      );
      runInAction(() => {
        this.selectedEntityDetails = newEntities;
      });
    }
  };

  /**
   * @description update last selected entity
   * @param {TEntityDetails} entityDetails
   */
  updateLastSelectedEntityDetails = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.lastSelectedEntityDetails = entityDetails;
    });
  };

  /**
   * @description update previous active entity
   * @param {TEntityDetails} entityDetails
   */
  updatePreviousActiveEntity = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.previousActiveEntity = entityDetails;
    });
  };

  /**
   * @description update next active entity
   * @param {TEntityDetails} entityDetails
   */
  updateNextActiveEntity = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.nextActiveEntity = entityDetails;
    });
  };

  /**
   * @description update active entity
   * @param {TEntityDetails} entityDetails
   */
  updateActiveEntityDetails = (entityDetails: TEntityDetails | null) => {
    runInAction(() => {
      this.activeEntityDetails = entityDetails;
    });
  };

  /**
   * @description clear selection and reset all the observables
   */
  clearSelection = () => {
    runInAction(() => {
      this.selectedEntityDetails = [];
      this.lastSelectedEntityDetails = null;
      this.previousActiveEntity = null;
      this.nextActiveEntity = null;
      this.activeEntityDetails = null;
    });
  };
}
