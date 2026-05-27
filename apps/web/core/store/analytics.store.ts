/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Analytics base store: shared analytics filter and duration state used by
 * the plane-web `AnalyticsStore` subclass and the analytics components
 * subtree.
 *
 * This module exports the abstract `BaseAnalyticsStore` class and its
 * `IBaseAnalyticsStore` interface contract. It is never instantiated
 * directly — concrete subclasses (community edition:
 * `apps/web/ce/store/analytics.store.ts`) are wired into the `RootStore`
 * via the `@/plane-web/store/analytics.store` alias and injected into
 * React components through MobX context.
 *
 * State slice (observables):
 *   - currentTab: TAnalyticsTabsBase — active analytics tab key (default "overview")
 *   - selectedProjects: string[] — workspace projects scoping the analytics view
 *   - selectedDuration: DurationType — active duration filter key (default "last_30_days")
 *   - selectedCycle: string — cycle filter id ("" = no cycle filter)
 *   - selectedModule: string — module filter id ("" = no module filter)
 *   - isPeekView: boolean — true when analytics renders inside a peek/preview panel
 *   - isEpic: boolean — true when analytics is scoped to an epic context
 *
 * Actions (all synchronous, mutate observables via `runInAction`; no API or
 * persistence side effects — durable persistence is the caller's responsibility):
 *   - updateSelectedProjects(projects: string[]) — assigns selectedProjects;
 *     logs and re-throws on failure
 *   - updateSelectedDuration(duration: DurationType) — assigns selectedDuration;
 *     logs and re-throws on failure
 *   - updateSelectedCycle(cycle: string) — assigns selectedCycle
 *   - updateSelectedModule(module: string) — assigns selectedModule
 *   - updateIsPeekView(isPeekView: boolean) — assigns isPeekView
 *   - updateIsEpic(isEpic: boolean) — assigns isEpic
 *
 * Computed:
 *   - selectedDurationLabel — resolves `selectedDuration` to its display label by
 *     lookup against `ANALYTICS_DURATION_FILTER_OPTIONS`; recomputes when
 *     `selectedDuration` changes; returns null when the value is not found
 *
 * Consumers:
 *   - apps/web/ce/store/analytics.store.ts — concrete community-edition subclass
 *     (re-exported as `AnalyticsStore` via `@/plane-web/store/analytics.store`
 *     and registered on `RootStore`)
 *   - apps/web/core/components/analytics/** — analytics UI (filter actions,
 *     overview, work-items, insight tables) reads observables and dispatches
 *     actions through the injected `AnalyticsStore`
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { ANALYTICS_DURATION_FILTER_OPTIONS } from "@plane/constants";
import type { TAnalyticsTabsBase } from "@plane/types";

type DurationType = (typeof ANALYTICS_DURATION_FILTER_OPTIONS)[number]["value"];

export interface IBaseAnalyticsStore {
  //observables
  currentTab: TAnalyticsTabsBase;
  selectedProjects: string[];
  selectedDuration: DurationType;
  selectedCycle: string;
  selectedModule: string;
  isPeekView?: boolean;
  isEpic?: boolean;
  //computed
  selectedDurationLabel: DurationType | null;

  //actions
  updateSelectedProjects: (projects: string[]) => void;
  updateSelectedDuration: (duration: DurationType) => void;
  updateSelectedCycle: (cycle: string) => void;
  updateSelectedModule: (module: string) => void;
  updateIsPeekView: (isPeekView: boolean) => void;
  updateIsEpic: (isEpic: boolean) => void;
}

export abstract class BaseAnalyticsStore implements IBaseAnalyticsStore {
  //observables
  currentTab: TAnalyticsTabsBase = "overview";
  selectedProjects: string[] = [];
  selectedDuration: DurationType = "last_30_days";
  selectedCycle: string = "";
  selectedModule: string = "";
  isPeekView: boolean = false;
  isEpic: boolean = false;
  constructor() {
    makeObservable(this, {
      // observables
      currentTab: observable.ref,
      selectedDuration: observable.ref,
      selectedProjects: observable,
      selectedCycle: observable.ref,
      selectedModule: observable.ref,
      isPeekView: observable.ref,
      isEpic: observable.ref,
      // computed
      selectedDurationLabel: computed,
      // actions
      updateSelectedProjects: action,
      updateSelectedDuration: action,
      updateSelectedCycle: action,
      updateSelectedModule: action,
      updateIsPeekView: action,
      updateIsEpic: action,
    });
  }

  get selectedDurationLabel() {
    return ANALYTICS_DURATION_FILTER_OPTIONS.find((item) => item.value === this.selectedDuration)?.name ?? null;
  }

  updateSelectedProjects = (projects: string[]) => {
    try {
      runInAction(() => {
        this.selectedProjects = projects;
      });
    } catch (error) {
      console.error("Failed to update selected project");
      throw error;
    }
  };

  updateSelectedDuration = (duration: DurationType) => {
    try {
      runInAction(() => {
        this.selectedDuration = duration;
      });
    } catch (error) {
      console.error("Failed to update selected duration");
      throw error;
    }
  };

  updateSelectedCycle = (cycle: string) => {
    runInAction(() => {
      this.selectedCycle = cycle;
    });
  };

  updateSelectedModule = (module: string) => {
    runInAction(() => {
      this.selectedModule = module;
    });
  };

  updateIsPeekView = (isPeekView: boolean) => {
    runInAction(() => {
      this.isPeekView = isPeekView;
    });
  };

  updateIsEpic = (isEpic: boolean) => {
    runInAction(() => {
      this.isEpic = isEpic;
    });
  };
}
