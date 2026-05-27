/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Command-palette base store: reusable MobX foundation that backs the
 * Cmd+K / Ctrl+K command palette and the cluster of "create" / "delete"
 * dialogs reachable from it. Concrete behavior is finalized by the
 * subclass at `apps/web/ce/store/command-palette.store.ts`
 * (`CommandPaletteStore`), which adds the `isAnyModalOpen` `computed`
 * selector on top of `super.getCoreModalsState()` and is wired into the
 * root composition as `CoreRootStore.commandPalette`.
 *
 * State slice (observables, each registered in the `makeObservable` block):
 *   - `isCreateProjectModalOpen`, `isCreateCycleModalOpen`,
 *     `isCreateModuleModalOpen`, `isCreateViewModalOpen`,
 *     `isCreateIssueModalOpen`, `isDeleteIssueModalOpen`,
 *     `isBulkDeleteIssueModalOpen`, `allStickiesModal`: `boolean`
 *     — per-modal visibility flags (`observable.ref` for the booleans).
 *   - `createPageModal`: `TCreatePageModal` — `{ isOpen, pageAccess }`
 *     payload for the create-page dialog; seeded with
 *     `DEFAULT_CREATE_PAGE_MODAL_DATA` from `@plane/constants`.
 *   - `createIssueStoreType`: `TCreateModalStoreTypes` — selects which
 *     issue-store context (project / cycle / module / workspace draft /
 *     profile / archived) the open create-issue modal should mutate;
 *     defaults to `EIssuesStoreType.PROJECT`.
 *   - `createWorkItemAllowedProjectIds`: `string[] | undefined` — when
 *     defined, restricts the project selector inside the create-issue
 *     modal; `undefined` means no restriction.
 *   - `profileSettingsModal`: `{ activeTab: TProfileSettingsTabs | null;
 *     isOpen: boolean }` — overlay state and currently focused tab for
 *     the profile settings dialog.
 *   - `projectListOpenMap`: `Record<string, boolean>` — per-project
 *     expansion state for the project list inside the palette sidebar.
 *
 * Actions (each registered as `action` in the `makeObservable` block):
 *   - `toggleCreateProjectModal`, `toggleCreateCycleModal`,
 *     `toggleCreateViewModal`, `toggleCreateModuleModal`,
 *     `toggleDeleteIssueModal`, `toggleBulkDeleteIssueModal`,
 *     `toggleAllStickiesModal(value?)` — assign the explicit `value`
 *     when supplied, otherwise flip the current flag.
 *   - `toggleCreatePageModal(value?: TCreatePageModal)` — sets
 *     `{ isOpen, pageAccess }`; falls back to `EPageAccess.PUBLIC` when
 *     `pageAccess` is missing or the toggle is implicit.
 *   - `toggleCreateIssueModal(value?, storeType?, allowedProjectIds?)`
 *     — opens/closes the create-issue modal AND concurrently updates
 *     `createIssueStoreType` and `createWorkItemAllowedProjectIds`;
 *     close branch resets both back to the project default.
 *   - `toggleProjectListOpen(projectId, value?)` — mutates a single key
 *     in `projectListOpenMap` (no full-map replacement).
 *   - `toggleProfileSettingsModal(payload)` — shallow-merges partial
 *     `{ activeTab, isOpen }` into `profileSettingsModal` inside a
 *     `runInAction` block.
 *
 * Computed / derived:
 *   - `getIsProjectListOpen(projectId)`: parameterized `computedFn` from
 *     `mobx-utils` that reads `projectListOpenMap[projectId]`; results
 *     are cached per argument and invalidate when the underlying map
 *     entry changes.
 *   - `getCoreModalsState()`: protected, non-reactive helper that OR-s
 *     every base modal flag with `store.powerK.isShortcutsListModalOpen`
 *     (read via `@/lib/store-context`); the subclass turns this into
 *     the reactive `isAnyModalOpen` `computed`.
 *
 * Consumers:
 *   - `apps/web/ce/store/command-palette.store.ts` — `CommandPaletteStore`
 *     subclass that finalizes the public API and exposes
 *     `isAnyModalOpen`.
 *   - `apps/web/core/store/root.store.ts` — root composition that
 *     instantiates the subclass and injects it via React context.
 *   - `apps/web/ce/components/command-palette/**` — palette UI surface:
 *     `actions/`, `modals/`, `power-k/`, and `helpers.tsx` toggle these
 *     observables in response to keyboard shortcuts and menu clicks.
 */

import { observable, action, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TCreateModalStoreTypes, TCreatePageModal } from "@plane/constants";
import { DEFAULT_CREATE_PAGE_MODAL_DATA, EPageAccess } from "@plane/constants";
import type { TProfileSettingsTabs } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
// lib
import { store } from "@/lib/store-context";

export interface ModalData {
  store: EIssuesStoreType;
  viewId: string;
}

export interface IBaseCommandPaletteStore {
  // observables
  isCreateProjectModalOpen: boolean;
  isCreateCycleModalOpen: boolean;
  isCreateModuleModalOpen: boolean;
  isCreateViewModalOpen: boolean;
  createPageModal: TCreatePageModal;
  isCreateIssueModalOpen: boolean;
  isDeleteIssueModalOpen: boolean;
  isBulkDeleteIssueModalOpen: boolean;
  createIssueStoreType: TCreateModalStoreTypes;
  createWorkItemAllowedProjectIds: string[] | undefined;
  profileSettingsModal: {
    activeTab: TProfileSettingsTabs | null;
    isOpen: boolean;
  };
  allStickiesModal: boolean;
  projectListOpenMap: Record<string, boolean>;
  getIsProjectListOpen: (projectId: string) => boolean;
  // toggle actions
  toggleCreateProjectModal: (value?: boolean) => void;
  toggleCreateCycleModal: (value?: boolean) => void;
  toggleCreateViewModal: (value?: boolean) => void;
  toggleCreatePageModal: (value?: TCreatePageModal) => void;
  toggleCreateIssueModal: (value?: boolean, storeType?: TCreateModalStoreTypes, allowedProjectIds?: string[]) => void;
  toggleCreateModuleModal: (value?: boolean) => void;
  toggleDeleteIssueModal: (value?: boolean) => void;
  toggleBulkDeleteIssueModal: (value?: boolean) => void;
  toggleAllStickiesModal: (value?: boolean) => void;
  toggleProjectListOpen: (projectId: string, value?: boolean) => void;
  toggleProfileSettingsModal: (value: { activeTab?: TProfileSettingsTabs | null; isOpen?: boolean }) => void;
}

export abstract class BaseCommandPaletteStore implements IBaseCommandPaletteStore {
  // observables
  isCreateProjectModalOpen: boolean = false;
  isCreateCycleModalOpen: boolean = false;
  isCreateModuleModalOpen: boolean = false;
  isCreateViewModalOpen: boolean = false;
  isCreateIssueModalOpen: boolean = false;
  isDeleteIssueModalOpen: boolean = false;
  isBulkDeleteIssueModalOpen: boolean = false;
  createPageModal: TCreatePageModal = DEFAULT_CREATE_PAGE_MODAL_DATA;
  createIssueStoreType: TCreateModalStoreTypes = EIssuesStoreType.PROJECT;
  createWorkItemAllowedProjectIds: IBaseCommandPaletteStore["createWorkItemAllowedProjectIds"] = undefined;
  profileSettingsModal: IBaseCommandPaletteStore["profileSettingsModal"] = {
    activeTab: "general",
    isOpen: false,
  };
  allStickiesModal: boolean = false;
  projectListOpenMap: Record<string, boolean> = {};

  constructor() {
    makeObservable(this, {
      // observable
      isCreateProjectModalOpen: observable.ref,
      isCreateCycleModalOpen: observable.ref,
      isCreateModuleModalOpen: observable.ref,
      isCreateViewModalOpen: observable.ref,
      isCreateIssueModalOpen: observable.ref,
      isDeleteIssueModalOpen: observable.ref,
      isBulkDeleteIssueModalOpen: observable.ref,
      createPageModal: observable,
      createIssueStoreType: observable,
      createWorkItemAllowedProjectIds: observable,
      profileSettingsModal: observable,
      allStickiesModal: observable,
      projectListOpenMap: observable,
      // toggle actions
      toggleCreateProjectModal: action,
      toggleCreateCycleModal: action,
      toggleCreateViewModal: action,
      toggleCreatePageModal: action,
      toggleCreateIssueModal: action,
      toggleCreateModuleModal: action,
      toggleDeleteIssueModal: action,
      toggleBulkDeleteIssueModal: action,
      toggleAllStickiesModal: action,
      toggleProjectListOpen: action,
      toggleProfileSettingsModal: action,
    });
  }

  /**
   * Returns whether any base modal is open
   * @protected - allows access from child classes
   */
  protected getCoreModalsState(): boolean {
    return Boolean(
      this.isCreateIssueModalOpen ||
      this.isCreateCycleModalOpen ||
      this.isCreateProjectModalOpen ||
      this.isCreateModuleModalOpen ||
      this.isCreateViewModalOpen ||
      store.powerK.isShortcutsListModalOpen ||
      this.isBulkDeleteIssueModalOpen ||
      this.isDeleteIssueModalOpen ||
      this.createPageModal.isOpen ||
      this.allStickiesModal
    );
  }
  // computedFn
  getIsProjectListOpen = computedFn((projectId: string) => this.projectListOpenMap[projectId]);

  /**
   * Toggles the project list open state
   * @param projectId
   * @param value
   */
  toggleProjectListOpen = (projectId: string, value?: boolean) => {
    if (value !== undefined) this.projectListOpenMap[projectId] = value;
    else this.projectListOpenMap[projectId] = !this.projectListOpenMap[projectId];
  };

  /**
   * Toggles the create project modal
   * @param value
   * @returns
   */
  toggleCreateProjectModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isCreateProjectModalOpen = value;
    } else {
      this.isCreateProjectModalOpen = !this.isCreateProjectModalOpen;
    }
  };

  /**
   * Toggles the create cycle modal
   * @param value
   * @returns
   */
  toggleCreateCycleModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isCreateCycleModalOpen = value;
    } else {
      this.isCreateCycleModalOpen = !this.isCreateCycleModalOpen;
    }
  };

  /**
   * Toggles the create view modal
   * @param value
   * @returns
   */
  toggleCreateViewModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isCreateViewModalOpen = value;
    } else {
      this.isCreateViewModalOpen = !this.isCreateViewModalOpen;
    }
  };

  /**
   * Toggles the create page modal along with the page access
   * @param value
   * @returns
   */
  toggleCreatePageModal = (value?: TCreatePageModal) => {
    if (value) {
      this.createPageModal = {
        isOpen: value.isOpen,
        pageAccess: value.pageAccess || EPageAccess.PUBLIC,
      };
    } else {
      this.createPageModal = {
        isOpen: !this.createPageModal.isOpen,
        pageAccess: EPageAccess.PUBLIC,
      };
    }
  };

  /**
   * Toggles the create issue modal
   * @param value
   * @param storeType
   * @returns
   */
  toggleCreateIssueModal = (value?: boolean, storeType?: TCreateModalStoreTypes, allowedProjectIds?: string[]) => {
    if (value !== undefined) {
      this.isCreateIssueModalOpen = value;
      this.createIssueStoreType = storeType || EIssuesStoreType.PROJECT;
      this.createWorkItemAllowedProjectIds = allowedProjectIds ?? undefined;
    } else {
      this.isCreateIssueModalOpen = !this.isCreateIssueModalOpen;
      this.createIssueStoreType = EIssuesStoreType.PROJECT;
      this.createWorkItemAllowedProjectIds = undefined;
    }
  };

  /**
   * Toggles the delete issue modal
   * @param value
   * @returns
   */
  toggleDeleteIssueModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isDeleteIssueModalOpen = value;
    } else {
      this.isDeleteIssueModalOpen = !this.isDeleteIssueModalOpen;
    }
  };

  /**
   * Toggles the create module modal
   * @param value
   * @returns
   */
  toggleCreateModuleModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isCreateModuleModalOpen = value;
    } else {
      this.isCreateModuleModalOpen = !this.isCreateModuleModalOpen;
    }
  };

  /**
   * Toggles the bulk delete issue modal
   * @param value
   * @returns
   */
  toggleBulkDeleteIssueModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isBulkDeleteIssueModalOpen = value;
    } else {
      this.isBulkDeleteIssueModalOpen = !this.isBulkDeleteIssueModalOpen;
    }
  };

  /**
   * Toggles the all stickies modal
   * @param value
   * @returns
   */
  toggleAllStickiesModal = (value?: boolean) => {
    if (value) {
      this.allStickiesModal = value;
    } else {
      this.allStickiesModal = !this.allStickiesModal;
    }
  };

  /**
   * Toggles the profile settings modal
   * @param value
   * @returns
   */
  toggleProfileSettingsModal: IBaseCommandPaletteStore["toggleProfileSettingsModal"] = (payload) => {
    const updatedSettings: IBaseCommandPaletteStore["profileSettingsModal"] = {
      ...this.profileSettingsModal,
      ...payload,
    };

    runInAction(() => {
      this.profileSettingsModal = updatedSettings;
    });
  };
}
