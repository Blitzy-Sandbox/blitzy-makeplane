/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Instance store: holds the deployment-level instance configuration (license,
 * features enabled, instance name/admin) fetched once at app boot from the
 * Django backend so the rest of the app can branch on license tier, setup
 * completion, and admin configuration without re-fetching.
 *
 * State slice:
 *   - isLoading: boolean — boot-time fetch flag; gates render in InstanceWrapper
 *   - instance: IInstance | undefined — instance metadata (license, identifier, setup flags) from GET /api/instances/
 *   - config: IInstanceConfig | undefined — feature-flag and SMTP/auth toggle payload returned by the same endpoint
 *   - error: TError | undefined — { status, message, data? } envelope on fetch failure; `data` carries `is_activated` / `is_setup_done` hints when present
 *
 * Actions:
 *   - fetchInstanceInfo() — calls InstanceService.getInstanceInfo() (GET /api/instances/), populates `instance` + `config` via runInAction, clears `isLoading`, records `error` and re-throws on failure
 *
 * Computed:
 *   - (none) — consumers read `instance` / `config` directly; no derived selectors are defined here
 *
 * Consumers:
 *   - apps/web/core/lib/wrappers/instance-wrapper.tsx — triggers the boot-time fetch via useSWR("INSTANCE_INFORMATION", ...) and renders InstanceNotReady / MaintenanceView based on state
 *   - apps/web/core/hooks/store/use-instance.ts — `useInstance()` hook exposes this store to components via React StoreContext
 *   - apps/web/core/store/root.store.ts — composition root instantiates InstanceStore and exposes it as `rootStore.instance`
 *   - apps/web/core/components/** — onboarding, auth, settings, sidebar, and integration components consume via `useInstance()` for feature-flag gating
 */

import { observable, action, makeObservable, runInAction } from "mobx";
// types
import type { IInstance, IInstanceConfig } from "@plane/types";
// services
import { InstanceService } from "@/services/instance.service";

type TError = {
  status: string;
  message: string;
  data?: {
    is_activated: boolean;
    is_setup_done: boolean;
  };
};

export interface IInstanceStore {
  // issues
  isLoading: boolean;
  instance: IInstance | undefined;
  config: IInstanceConfig | undefined;
  error: TError | undefined;
  // action
  fetchInstanceInfo: () => Promise<void>;
}

export class InstanceStore implements IInstanceStore {
  isLoading: boolean = true;
  instance: IInstance | undefined = undefined;
  config: IInstanceConfig | undefined = undefined;
  error: TError | undefined = undefined;
  // services
  instanceService;

  constructor() {
    makeObservable(this, {
      // observable
      isLoading: observable.ref,
      instance: observable,
      config: observable,
      error: observable,
      // actions
      fetchInstanceInfo: action,
    });
    // services
    this.instanceService = new InstanceService();
  }

  /**
   * @description fetching instance information
   */
  fetchInstanceInfo = async () => {
    try {
      this.isLoading = true;
      this.error = undefined;
      const instanceInfo = await this.instanceService.getInstanceInfo();
      runInAction(() => {
        this.isLoading = false;
        this.instance = instanceInfo.instance;
        this.config = instanceInfo.config;
      });
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
        this.error = {
          status: "error",
          message: "Failed to fetch instance info",
        };
      });
      throw error;
    }
  };
}
