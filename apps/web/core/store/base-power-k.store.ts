/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * PowerK base store: reusable MobX foundation for the PowerK command-palette
 * surface; extended by `PowerKStore` at `apps/web/ce/store/power-k.store.ts`
 * (imported via the `@/plane-web/store/power-k.store` alias) which is wired
 * into the composition root as `CoreRootStore.powerK`.
 *
 * State slice:
 *   - isPowerKModalOpen: boolean (observable.ref) — whether the PowerK command-palette modal is open
 *   - isShortcutsListModalOpen: boolean (observable.ref) — whether the keyboard shortcuts list modal is open
 *   - commandRegistry: IPowerKCommandRegistry (observable.ref) — registry of available PowerK commands
 *   - activeContext: TPowerKContextType | null (observable) — entity context the palette is acting on
 *   - activePage: TPowerKPageType | null (observable) — current drill-down page inside the palette
 *   - topNavInputRef: React.RefObject<HTMLInputElement> | null (observable.ref) — ref to the top-nav input, target of keyboard shortcuts
 *   - topNavSearchInputRef: React.RefObject<HTMLInputElement> | null (observable.ref) — ref to the top-nav search input
 *
 * Actions:
 *   - togglePowerKModal(value?: boolean) — sets isPowerKModalOpen to `value` when provided, else toggles it
 *   - toggleShortcutsListModal(value?: boolean) — sets isShortcutsListModalOpen to `value` when provided, else toggles it
 *   - setActiveContext(entity: TPowerKContextType | null) — mutates activeContext
 *   - setActivePage(page: TPowerKPageType | null) — mutates activePage
 *   - setTopNavInputRef(ref: React.RefObject<HTMLInputElement> | null) — mutates topNavInputRef so keyboard shortcuts can focus the input
 *   - setTopNavSearchInputRef(ref: React.RefObject<HTMLInputElement> | null) — mutates topNavSearchInputRef so keyboard shortcuts can focus the search input
 *
 * Computed:
 *   - None at the base layer — derived selectors live in hooks/components that consume this store
 *
 * Consumers:
 *   - apps/web/ce/store/power-k.store.ts (`PowerKStore` subclass wired into `CoreRootStore.powerK`)
 *   - apps/web/core/hooks/store/use-power-k.ts (`usePowerK` hook returning `IPowerKStore` via `StoreContext`)
 *   - apps/web/core/components/power-k/** (PowerK UI: command palette, shortcuts list, global shortcuts)
 *   - apps/web/ce/components/command-palette/power-k/** (edition-specific palette views)
 */

import { observable, action, makeObservable } from "mobx";
// plane imports
import type { EIssuesStoreType } from "@plane/types";
// components
import type { IPowerKCommandRegistry } from "@/components/power-k/core/registry";
import { PowerKCommandRegistry } from "@/components/power-k/core/registry";
import type { TPowerKContextType, TPowerKPageType } from "@/components/power-k/core/types";

export interface ModalData {
  store: EIssuesStoreType;
  viewId: string;
}

export interface IBasePowerKStore {
  // observables
  isPowerKModalOpen: boolean;
  isShortcutsListModalOpen: boolean;
  commandRegistry: IPowerKCommandRegistry;
  activeContext: TPowerKContextType | null;
  activePage: TPowerKPageType | null;
  topNavInputRef: React.RefObject<HTMLInputElement> | null;
  topNavSearchInputRef: React.RefObject<HTMLInputElement> | null;
  setActiveContext: (entity: TPowerKContextType | null) => void;
  setActivePage: (page: TPowerKPageType | null) => void;
  setTopNavInputRef: (ref: React.RefObject<HTMLInputElement> | null) => void;
  setTopNavSearchInputRef: (ref: React.RefObject<HTMLInputElement> | null) => void;
  // toggle actions
  togglePowerKModal: (value?: boolean) => void;
  toggleShortcutsListModal: (value?: boolean) => void;
}

export abstract class BasePowerKStore implements IBasePowerKStore {
  // observables
  isPowerKModalOpen: boolean = false;
  isShortcutsListModalOpen: boolean = false;
  commandRegistry: IPowerKCommandRegistry = new PowerKCommandRegistry();
  activeContext: TPowerKContextType | null = null;
  activePage: TPowerKPageType | null = null;
  topNavInputRef: React.RefObject<HTMLInputElement> | null = null;
  topNavSearchInputRef: React.RefObject<HTMLInputElement> | null = null;

  constructor() {
    makeObservable(this, {
      // observable
      isPowerKModalOpen: observable.ref,
      isShortcutsListModalOpen: observable.ref,
      commandRegistry: observable.ref,
      activeContext: observable,
      activePage: observable,
      topNavInputRef: observable.ref,
      topNavSearchInputRef: observable.ref,
      // toggle actions
      togglePowerKModal: action,
      toggleShortcutsListModal: action,
      setActiveContext: action,
      setActivePage: action,
      setTopNavInputRef: action,
      setTopNavSearchInputRef: action,
    });
  }

  /**
   * Sets the active context entity
   * @param entity
   */
  setActiveContext = (entity: TPowerKContextType | null) => {
    this.activeContext = entity;
  };

  /**
   * Sets the active page
   * @param page
   */
  setActivePage = (page: TPowerKPageType | null) => {
    this.activePage = page;
  };

  /**
   * Sets the top nav input ref for keyboard shortcut access
   * @param ref
   */
  setTopNavInputRef = (ref: React.RefObject<HTMLInputElement> | null) => {
    this.topNavInputRef = ref;
  };

  /**
   * Sets the top nav search input ref for keyboard shortcut access
   * @param ref
   */
  setTopNavSearchInputRef = (ref: React.RefObject<HTMLInputElement> | null) => {
    this.topNavSearchInputRef = ref;
  };

  /**
   * Toggles the command palette modal
   * @param value
   * @returns
   */
  togglePowerKModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isPowerKModalOpen = value;
    } else {
      this.isPowerKModalOpen = !this.isPowerKModalOpen;
    }
  };

  /**
   * Toggles the shortcut modal
   * @param value
   * @returns
   */
  toggleShortcutsListModal = (value?: boolean) => {
    if (value !== undefined) {
      this.isShortcutsListModalOpen = value;
    } else {
      this.isShortcutsListModalOpen = !this.isShortcutsListModalOpen;
    }
  };
}
