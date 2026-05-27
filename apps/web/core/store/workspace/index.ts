/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace-scope MobX composition root — defines `IWorkspaceRootStore` and
 * `BaseWorkspaceRootStore`, parallel to `apps/web/core/store/root.store.ts`
 * (the global core composition root). This module owns the workspace slice of
 * the global state graph: workspace CRUD, sidebar/project navigation
 * preferences, and aggregation of the workspace-scoped sub-stores below.
 *
 * Composition (instantiated in the constructor at runtime):
 *   - `home: HomeStore` — workspace home widgets + nested `quickLinks:
 *     WorkspaceLinkStore` (the link store is reachable ONLY via
 *     `home.quickLinks`; it is NOT exposed directly off the workspace root).
 *   - `webhook: WebhookStore` — workspace webhook CRUD + secret-key rotation.
 *   - `apiToken: ApiTokenStore` — per-user workspace API token CRUD.
 *
 * Cross-store wiring (constructor takes `_rootStore: CoreRootStore`):
 *   - `this.router = _rootStore.router` — read by the `currentWorkspace`
 *     computed (via `router.workspaceSlug`).
 *   - `this.user = _rootStore.user` — read by `workspacesCreatedByCurrentUser`
 *     (filters on `user.data.id`) and `getWorkspaceRedirectionUrl` (reads
 *     `user.userSettings.data.workspace.last_workspace_slug` /
 *     `fallback_workspace_slug`).
 *   - `_rootStore` is forwarded into `WebhookStore` and `ApiTokenStore`
 *     constructors (both accept a `CoreRootStore`); `HomeStore` takes no
 *     arguments so the root reference is NOT forwarded there.
 *
 * Extension pattern (this is the only abstract MobX store in this codebase):
 *   - `BaseWorkspaceRootStore` is `abstract`; the single abstract method is
 *     `mutateWorkspaceMembersActivity(workspaceSlug)`.
 *   - The CE concrete subclass at `apps/web/ce/store/workspace/index.ts`
 *     supplies a no-op implementation; the EE/`plane-web` variant supplies
 *     the real implementation.
 *   - The tsconfig path alias `@/plane-web/*` resolves to `./ce/*` in this
 *     CE-only tree, so `CoreRootStore` (at `apps/web/core/store/root.store.ts`)
 *     imports `WorkspaceRootStore` from `@/plane-web/store/workspace` and
 *     receives whichever concrete subclass the active build supplies.
 *
 * Primary state (registered as observables in `makeObservable`):
 *   - `loader: boolean` — true only while `fetchWorkspaces` is in flight.
 *   - `workspaces: Record<string, IWorkspace>` — id-keyed workspace map.
 *   - `navigationPreferencesMap: Record<workspaceSlug, IWorkspaceSidebarNavigation>`
 *     — sidebar pin/order preferences per workspace.
 *   - `projectNavigationPreferencesMap: Record<workspaceSlug, IWorkspaceUserPropertiesResponse>`
 *     — project listing filters/display preferences per workspace.
 *
 * Computed (recomputation conditions):
 *   - `currentWorkspace` — recomputes when `router.workspaceSlug` or any entry
 *     in `workspaces` changes.
 *   - `workspacesCreatedByCurrentUser` — recomputes when `workspaces` or
 *     `user.data` changes.
 *   - `getNavigationPreferences(workspaceSlug)` — `computedFn`-memoized
 *     selector on `navigationPreferencesMap[workspaceSlug]`.
 *   - `getProjectNavigationPreferences(workspaceSlug)` — `computedFn`-memoized
 *     selector on `projectNavigationPreferencesMap[workspaceSlug]`.
 *   - `getWorkspaceBySlug` / `getWorkspaceById` are registered as `action` but
 *     act as synchronous selectors over `workspaces`.
 *
 * Action groups:
 *   - Workspace CRUD: `fetchWorkspaces`, `createWorkspace`, `updateWorkspace`,
 *     `updateWorkspaceLogo` (synchronous; THROWS if the slug is not found),
 *     `deleteWorkspace` (logs and swallows errors instead of re-throwing).
 *   - Sidebar preferences: `fetchSidebarNavigationPreferences`,
 *     `updateSidebarPreference`, `updateBulkSidebarPreferences`.
 *   - Project navigation preferences: `fetchProjectNavigationPreferences`,
 *     `updateProjectNavigationPreferences`.
 *   - Abstract hook: `mutateWorkspaceMembersActivity` (extension point).
 *
 * Optimistic-update-with-rollback pattern: `updateSidebarPreference`,
 * `updateBulkSidebarPreferences`, and `updateProjectNavigationPreferences`
 * snapshot the prior preference state via `clone(...)` before writing, then
 * revert to the snapshot inside the `catch` block if the API call fails. This
 * keeps the UI responsive while guaranteeing eventual consistency with the
 * server on transient failure.
 *
 * Consumer access pattern: components read this store through the typed hooks
 * under `apps/web/core/hooks/store/` — `useWorkspace()` for the workspace root
 * (this module), `useHome()` for `home`, `useWebhook()` for `webhook`, and
 * `useApiTokens()` for `apiToken`.
 */

import { clone, set } from "lodash-es";
import { action, computed, observable, makeObservable, runInAction } from "mobx";
// types
import { computedFn } from "mobx-utils";
import type {
  IWorkspaceSidebarNavigationItem,
  IWorkspace,
  IWorkspaceSidebarNavigation,
  IWorkspaceUserPropertiesResponse,
} from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";
// store
import type { CoreRootStore } from "@/store/root.store";
// sub-stores
import type { IApiTokenStore } from "./api-token.store";
import { ApiTokenStore } from "./api-token.store";
import type { IHomeStore } from "./home";
import { HomeStore } from "./home";
import type { IWebhookStore } from "./webhook.store";
import { WebhookStore } from "./webhook.store";

export interface IWorkspaceRootStore {
  loader: boolean;
  // observables
  workspaces: Record<string, IWorkspace>;
  // computed
  currentWorkspace: IWorkspace | null;
  workspacesCreatedByCurrentUser: IWorkspace[] | null;
  navigationPreferencesMap: Record<string, IWorkspaceSidebarNavigation>;
  projectNavigationPreferencesMap: Record<string, IWorkspaceUserPropertiesResponse>;
  getWorkspaceRedirectionUrl: () => string;
  // computed actions
  getWorkspaceBySlug: (workspaceSlug: string) => IWorkspace | null;
  getWorkspaceById: (workspaceId: string) => IWorkspace | null;
  // fetch actions
  fetchWorkspaces: () => Promise<IWorkspace[]>;
  // crud actions
  createWorkspace: (data: Partial<IWorkspace>) => Promise<IWorkspace>;
  updateWorkspace: (workspaceSlug: string, data: Partial<IWorkspace>) => Promise<IWorkspace>;
  updateWorkspaceLogo: (workspaceSlug: string, logoURL: string) => void;
  deleteWorkspace: (workspaceSlug: string) => Promise<void>;
  fetchSidebarNavigationPreferences: (workspaceSlug: string) => Promise<void>;
  updateSidebarPreference: (
    workspaceSlug: string,
    key: string,
    data: Partial<IWorkspaceSidebarNavigationItem>
  ) => Promise<IWorkspaceSidebarNavigationItem | undefined>;
  updateBulkSidebarPreferences: (
    workspaceSlug: string,
    data: Array<{ key: string; is_pinned: boolean; sort_order: number }>
  ) => Promise<void>;
  getNavigationPreferences: (workspaceSlug: string) => IWorkspaceSidebarNavigation | undefined;
  getProjectNavigationPreferences: (workspaceSlug: string) => IWorkspaceUserPropertiesResponse | undefined;
  fetchProjectNavigationPreferences: (workspaceSlug: string) => Promise<void>;
  updateProjectNavigationPreferences: (
    workspaceSlug: string,
    data: Partial<IWorkspaceUserPropertiesResponse>
  ) => Promise<void>;
  mutateWorkspaceMembersActivity: (workspaceSlug: string) => Promise<void>;
  // sub-stores
  webhook: IWebhookStore;
  apiToken: IApiTokenStore;
  home: IHomeStore;
}

export abstract class BaseWorkspaceRootStore implements IWorkspaceRootStore {
  loader: boolean = false;
  // observables
  workspaces: Record<string, IWorkspace> = {};
  navigationPreferencesMap: Record<string, IWorkspaceSidebarNavigation> = {};
  projectNavigationPreferencesMap: Record<string, IWorkspaceUserPropertiesResponse> = {};
  // services
  workspaceService;
  // root store
  router;
  user;
  home;
  // sub-stores
  webhook: IWebhookStore;
  apiToken: IApiTokenStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      // observables
      workspaces: observable,
      navigationPreferencesMap: observable,
      projectNavigationPreferencesMap: observable,
      // computed
      currentWorkspace: computed,
      workspacesCreatedByCurrentUser: computed,
      // computed actions
      getWorkspaceBySlug: action,
      getWorkspaceById: action,
      // actions
      fetchWorkspaces: action,
      createWorkspace: action,
      updateWorkspace: action,
      updateWorkspaceLogo: action,
      deleteWorkspace: action,
      fetchSidebarNavigationPreferences: action,
      updateSidebarPreference: action,
      updateBulkSidebarPreferences: action,
      fetchProjectNavigationPreferences: action,
      updateProjectNavigationPreferences: action,
    });

    // services
    this.workspaceService = new WorkspaceService();
    // root store
    this.router = _rootStore.router;
    this.user = _rootStore.user;
    this.home = new HomeStore();
    // sub-stores
    this.webhook = new WebhookStore(_rootStore);
    this.apiToken = new ApiTokenStore(_rootStore);
  }

  /**
   * get the workspace redirection url based on the last and fallback workspace_slug
   */
  getWorkspaceRedirectionUrl = () => {
    let redirectionRoute = "/create-workspace";
    // validate the last and fallback workspace_slug
    const currentWorkspaceSlug =
      this.user.userSettings?.data?.workspace?.last_workspace_slug ||
      this.user.userSettings?.data?.workspace?.fallback_workspace_slug;

    // validate the current workspace_slug is available in the user's workspace list
    const isCurrentWorkspaceValid = Object.values(this.workspaces || {}).findIndex(
      (workspace) => workspace.slug === currentWorkspaceSlug
    );

    if (isCurrentWorkspaceValid >= 0) redirectionRoute = `/${currentWorkspaceSlug}`;
    return redirectionRoute;
  };

  /**
   * computed value of current workspace based on workspace slug saved in the query store
   */
  get currentWorkspace() {
    const workspaceSlug = this.router.workspaceSlug;
    if (!workspaceSlug) return null;
    const workspaceDetails = Object.values(this.workspaces ?? {})?.find((w) => w.slug === workspaceSlug);
    return workspaceDetails || null;
  }

  /**
   * computed value of all the workspaces created by the current logged in user
   */
  get workspacesCreatedByCurrentUser() {
    if (!this.workspaces) return null;
    const user = this.user.data;
    if (!user) return null;
    const userWorkspaces = Object.values(this.workspaces ?? {})?.filter((w) => w.created_by === user?.id);
    return userWorkspaces || null;
  }

  /**
   * get workspace info from the array of workspaces in the store using workspace slug
   * @param workspaceSlug
   */
  getWorkspaceBySlug = (workspaceSlug: string) =>
    Object.values(this.workspaces ?? {})?.find((w) => w.slug == workspaceSlug) || null;

  /**
   * get workspace info from the array of workspaces in the store using workspace id
   * @param workspaceId
   */
  getWorkspaceById = (workspaceId: string) => this.workspaces?.[workspaceId] || null; // TODO: use undefined instead of null

  /**
   * fetch user workspaces from API
   */
  fetchWorkspaces = async () => {
    this.loader = true;
    try {
      const workspaceResponse = await this.workspaceService.userWorkspaces();
      runInAction(() => {
        workspaceResponse.forEach((workspace) => {
          set(this.workspaces, [workspace.id], workspace);
        });
      });
      return workspaceResponse;
    } finally {
      this.loader = false;
    }
  };

  /**
   * create workspace using the workspace data
   * @param data
   */
  createWorkspace = async (data: Partial<IWorkspace>) =>
    await this.workspaceService.createWorkspace(data).then((response) => {
      runInAction(() => {
        this.workspaces = set(this.workspaces, response.id, response);
      });
      return response;
    });

  /**
   * update workspace using the workspace slug and new workspace data
   * @param workspaceSlug
   * @param data
   */
  updateWorkspace = async (workspaceSlug: string, data: Partial<IWorkspace>) =>
    await this.workspaceService.updateWorkspace(workspaceSlug, data).then((res) => {
      if (res && res.id) {
        runInAction(() => {
          Object.keys(data).forEach((key) => {
            set(this.workspaces, [res.id, key], data[key as keyof IWorkspace]);
          });
        });
      }
      return res;
    });

  /**
   * update workspace using the workspace slug and new workspace data
   * @param {string} workspaceSlug
   * @param {string} logoURL
   */
  updateWorkspaceLogo = (workspaceSlug: string, logoURL: string) => {
    const workspaceId = this.getWorkspaceBySlug(workspaceSlug)?.id;
    if (!workspaceId) {
      throw new Error("Workspace not found");
    }
    runInAction(() => {
      set(this.workspaces[workspaceId], ["logo_url"], logoURL);
    });
  };

  /**
   * delete workspace using the workspace slug
   * @param workspaceSlug
   */
  deleteWorkspace = async (workspaceSlug: string) => {
    try {
      await this.workspaceService.deleteWorkspace(workspaceSlug);
      const updatedWorkspacesList = this.workspaces;
      const workspaceId = this.getWorkspaceBySlug(workspaceSlug)?.id;
      delete updatedWorkspacesList[`${workspaceId}`];
      runInAction(() => {
        this.workspaces = updatedWorkspacesList;
      });
    } catch (error) {
      console.error("Failed to delete workspace:", error);
    }
  };

  fetchSidebarNavigationPreferences = async (workspaceSlug: string) => {
    try {
      const response = await this.workspaceService.fetchSidebarNavigationPreferences(workspaceSlug);

      runInAction(() => {
        this.navigationPreferencesMap[workspaceSlug] = response;
      });
    } catch (error) {
      console.error("Failed to fetch sidebar preferences:", error);
    }
  };

  updateSidebarPreference = async (
    workspaceSlug: string,
    key: string,
    data: Partial<IWorkspaceSidebarNavigationItem>
  ) => {
    // Store the data before update to use for reverting if needed
    const beforeUpdateData = clone(this.navigationPreferencesMap[workspaceSlug]?.[key]);

    try {
      runInAction(() => {
        this.navigationPreferencesMap[workspaceSlug] = {
          ...this.navigationPreferencesMap[workspaceSlug],
          [key]: {
            ...beforeUpdateData,
            ...data,
          },
        };
      });

      const response = await this.workspaceService.updateSidebarPreference(workspaceSlug, key, data);
      return response;
    } catch (error) {
      // Revert to original data if API call fails
      runInAction(() => {
        this.navigationPreferencesMap[workspaceSlug] = {
          ...this.navigationPreferencesMap[workspaceSlug],
          [key]: beforeUpdateData,
        };
      });
      console.error("Failed to update sidebar preference:", error);
    }
  };

  getNavigationPreferences = computedFn(
    (workspaceSlug: string): IWorkspaceSidebarNavigation | undefined => this.navigationPreferencesMap[workspaceSlug]
  );

  updateBulkSidebarPreferences = async (
    workspaceSlug: string,
    data: Array<{ key: string; is_pinned: boolean; sort_order: number }>
  ) => {
    const beforeUpdateData = clone(this.navigationPreferencesMap[workspaceSlug]);

    try {
      // Optimistically update store
      const updatedPreferences: IWorkspaceSidebarNavigation = {};
      data.forEach((item) => {
        updatedPreferences[item.key] = item;
      });

      runInAction(() => {
        this.navigationPreferencesMap[workspaceSlug] = {
          ...this.navigationPreferencesMap[workspaceSlug],
          ...updatedPreferences,
        };
      });

      // Call API to persist changes
      await this.workspaceService.updateBulkSidebarPreferences(workspaceSlug, data);
    } catch (error) {
      // Rollback on failure
      runInAction(() => {
        this.navigationPreferencesMap[workspaceSlug] = beforeUpdateData;
      });
      console.error("Failed to update bulk sidebar preferences:", error);
      throw error;
    }
  };

  getProjectNavigationPreferences = computedFn(
    (workspaceSlug: string): IWorkspaceUserPropertiesResponse | undefined =>
      this.projectNavigationPreferencesMap[workspaceSlug]
  );

  fetchProjectNavigationPreferences = async (workspaceSlug: string) => {
    try {
      const response = await this.workspaceService.fetchWorkspaceFilters(workspaceSlug);

      runInAction(() => {
        this.projectNavigationPreferencesMap[workspaceSlug] = response;
      });
    } catch (error) {
      console.error("Failed to fetch project navigation preferences:", error);
      throw error;
    }
  };

  updateProjectNavigationPreferences = async (
    workspaceSlug: string,
    data: Partial<IWorkspaceUserPropertiesResponse>
  ) => {
    const beforeUpdateData = clone(this.projectNavigationPreferencesMap[workspaceSlug]);

    try {
      // Optimistically update store
      runInAction(() => {
        this.projectNavigationPreferencesMap[workspaceSlug] = {
          ...this.projectNavigationPreferencesMap[workspaceSlug],
          ...data,
        };
      });

      // Call API to persist changes
      await this.workspaceService.patchWorkspaceFilters(workspaceSlug, data);
    } catch (error) {
      // Rollback on failure
      runInAction(() => {
        this.projectNavigationPreferencesMap[workspaceSlug] = beforeUpdateData;
      });
      console.error("Failed to update project navigation preferences:", error);
      throw error;
    }
  };

  /**
   * Mutate workspace members activity
   * @param workspaceSlug
   */
  abstract mutateWorkspaceMembersActivity(workspaceSlug: string): Promise<void>;
}
