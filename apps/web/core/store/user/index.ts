/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * User-domain composition root for the MobX root store.
 *
 * Owns the authenticated user's session lifecycle, hydrates the auth bootstrap, exposes
 * the cross-store sign-out cascade, and composes the four user sub-stores
 * (`accounts`, `userProfile`, `userSettings`, `permission`) into a single reactive surface
 * that every authenticated component consumes through the MobX root-store context. The
 * composition site is `apps/web/core/store/root.store.ts` (constructor instantiates
 * `user = new UserStore(this as unknown as RootStore)` and `resetOnSignOut()` reinstantiates
 * it as part of the sign-out cascade). Server-side counterparts are
 * `apps/api/plane/app/views/user/base.py` and `apps/api/plane/authentication/`
 * (AAP Directive 1).
 *
 * Composed sub-stores (eagerly constructed in the constructor — no lazy initialization, so
 * each field is always non-null even before `fetchCurrentUser` runs):
 *   - userProfile (IUserProfileStore) — `new ProfileStore(store)`; reconstructed by `reset()`.
 *   - userSettings (IUserSettingsStore) — `new UserSettingsStore()`; reconstructed by `reset()`.
 *   - permission (IUserPermissionStore) — `new UserPermissionStore(store)`; reconstructed
 *       by `reset()`. Concrete class is the EE-aware
 *       `@/plane-web/store/user/permission.store#UserPermissionStore`.
 *   - accounts (Record<string, IAccountStore>) — externally populated map of OAuth provider
 *       linkages keyed by provider id; this store defines no write action for it (callers
 *       — typically a connected-accounts settings page — construct `AccountStore` instances
 *       and assign them).
 *
 * State slice (observables registered in `makeObservable`):
 *   - isAuthenticated (boolean, observable.ref, default `false`) — session liveness flag;
 *       gates router-level access. Mutated by `fetchCurrentUser` and `reset` only.
 *   - isLoading (boolean, observable.ref, default `false`) — bootstrap-in-progress flag.
 *   - error (TUserErrorStatus | undefined, observable) — `{ status, message }` of the last
 *       failure. Status strings are ad-hoc literals (e.g., `"user-fetch-error"`,
 *       `"user-update-error"`), NOT enum constants — consumers must match the literal values.
 *   - data (IUser | undefined, observable) — the canonical current user record. There is NO
 *       separate `currentUser` getter; consumers read `store.user.data` directly. Likewise
 *       `isAuthenticated` is an observable flag, not a computed.
 *   - userProfile, userSettings, accounts, permission — sub-store fields are also observed
 *       so reassignment inside `reset()` notifies dependents.
 *
 * Services (non-observable, instantiated once per `UserStore` lifetime — both hold no
 * per-request state, so single-instance reuse is safe):
 *   - userService (UserService, `@/services/user.service`) — primary REST client for user
 *       CRUD, password change, and account deactivation.
 *   - authService (AuthService, `@/services/auth.service`) — REST client for sign-in,
 *       sign-out, and set-password flows.
 *
 * Actions (registered in `makeObservable`):
 *   - fetchCurrentUser() — bootstrap entry point. Calls `userService.currentUser()`; on
 *       success, fans out to `userProfile.fetchUserProfile()`,
 *       `userSettings.fetchCurrentUserSettings()`, and
 *       `store.workspaceRoot.fetchWorkspaces()` IN PARALLEL via `Promise.all`. Mutates
 *       `data`, `isAuthenticated`, and `isLoading` atomically inside `runInAction`. On
 *       failure sets `isAuthenticated = false` and surfaces
 *       `error = { status: "user-fetch-error", ... }`; failure of any parallel fetch
 *       rejects the whole bootstrap.
 *   - updateCurrentUser(data: Partial<IUser>) — optimistic local mutation via
 *       `lodash-es#set` over each key of `data`; calls `userService.updateUser(data)`;
 *       rolls back to the pre-mutation snapshot on failure and surfaces
 *       `error = { status: "user-update-error", ... }`.
 *   - handleSetPassword(csrfToken, { password }) — one-time set-password flow. Only fires
 *       when the current user has `is_password_autoset === true` (e.g., magic-link signup
 *       leaves the user with an auto-assigned password). Calls `authService.setPassword`;
 *       sets `is_password_autoset = false` on success; rolls back to `true` on failure.
 *   - changePassword(csrfToken, { old_password?, new_password }) — calls
 *       `userService.changePassword`; on success normalizes `is_password_autoset` to
 *       `false`. Does NOT roll back on failure (the only optimistic write happens after
 *       the API resolves), only logs and rethrows.
 *   - deactivateAccount() — calls `userService.deactivateAccount()`; terminates by
 *       triggering the full sign-out cascade via `store.resetOnSignOut()` (NOT the local
 *       `reset()` — note the difference).
 *   - reset() — resets all observable fields to defaults AND reconstructs `userProfile`,
 *       `userSettings`, and `permission` in place. Used as a fine-grained internal sub-step;
 *       does NOT call the root cascade.
 *   - signOut() — calls `authService.signOut(API_BASE_URL)`; terminates by triggering the
 *       full sign-out cascade via `store.resetOnSignOut()`.
 *
 * Sign-out cascade:
 *   Both `signOut()` and `deactivateAccount()` end by calling `this.store.resetOnSignOut()`.
 *   The cascade lives on the root store (`apps/web/core/store/root.store.ts#resetOnSignOut`)
 *   and reconstructs ALL session-scoped sub-stores in the root — INCLUDING
 *   `user = new UserStore(this)` itself. The current `UserStore` instance is therefore
 *   replaced wholesale on sign-out; the local `reset()` exists only for partial resets that
 *   should not drop the rest of the root state. Session cookies are owned by the
 *   `AuthService` HTTP-only cookie contract and by the server-side
 *   `apps/api/plane/authentication/` layer — this module never touches `document.cookie`,
 *   `localStorage`, or `sessionStorage` directly.
 *
 * Helper (non-`@action`) method:
 *   - fetchProjectsWithCreatePermissions() — reads `store.router.workspaceSlug` and
 *       `permission.getProjectRolesByWorkspaceSlug(workspaceSlug)` to build the map of
 *       projects in the current workspace where the user's role is
 *       `>= EUserPermissions.MEMBER`. Returns `{ [projectId]: TUserPermissions } | null`
 *       and powers both computed getters below.
 *
 * Computed values (registered as `computed` in `makeObservable`):
 *   - projectsWithCreatePermissions ({ [projectId]: TUserPermissions } | null) — delegates
 *       to `fetchProjectsWithCreatePermissions()`. Recomputes when
 *       `permission.workspaceProjectsPermissions` or `store.router.workspaceSlug` mutates.
 *   - canPerformAnyCreateAction (boolean) — `true` iff `projectsWithCreatePermissions` has
 *       at least one entry; recomputes alongside it.
 *
 * Constructor contract:
 *   Accepts `store: RootStore` (the EE-aware root, NOT `CoreRootStore`) so it can wire the
 *   `plane-web/`-only `UserPermissionStore`. All three sub-stores and both services are
 *   constructed eagerly; consumers may read `store.user.userProfile`, `store.user.userSettings`,
 *   and `store.user.permission` synchronously without awaiting any fetch.
 *
 * Consumers:
 *   - Auth flow: `apps/web/app/(all)/(authenticated-views)/**` calls
 *     `store.user.fetchCurrentUser()` on mount.
 *   - Account / settings pages: `apps/web/core/components/account/**` read `data` and call
 *     `updateCurrentUser`, `handleSetPassword`, `changePassword`, `deactivateAccount`.
 *   - Permission-gated UI: any component that reads
 *     `store.user.permission.allowPermissions(...)` (see `./base-permissions.store.ts`).
 *   - Quick-create surfaces: command palette and sidebar create buttons read
 *     `canPerformAnyCreateAction` and `projectsWithCreatePermissions`.
 *   - Sign-out controls: top-bar user menu and force-logout flows call `signOut`.
 *   - Root-store cascade: `apps/web/core/store/root.store.ts#resetOnSignOut()`
 *     reconstructs this store on sign-out.
 *
 * Cross-references:
 *   - Sibling sub-stores: `./profile.store.ts`, `./settings.store.ts`, `./account.store.ts`,
 *     `./base-permissions.store.ts` (abstract base of `UserPermissionStore`).
 *   - EE permission concrete class: `@/plane-web/store/user/permission.store#UserPermissionStore`.
 *   - Services: `@/services/user.service#UserService`, `@/services/auth.service#AuthService`.
 *   - Server side: `apps/api/plane/app/views/user/base.py`,
 *     `apps/api/plane/authentication/` (AAP Directive 1).
 */

import { cloneDeep, set } from "lodash-es";
import { action, makeObservable, observable, runInAction, computed } from "mobx";
// plane imports
import { EUserPermissions, API_BASE_URL } from "@plane/constants";
import type { IUser, TUserPermissions } from "@plane/types";
// plane web imports
import type { RootStore } from "@/plane-web/store/root.store";
import type { IUserPermissionStore } from "@/plane-web/store/user/permission.store";
import { UserPermissionStore } from "@/plane-web/store/user/permission.store";
// services
import { AuthService } from "@/services/auth.service";
import { UserService } from "@/services/user.service";
// stores
import type { IAccountStore } from "@/store/user/account.store";
import type { IUserProfileStore } from "@/store/user/profile.store";
import { ProfileStore } from "@/store/user/profile.store";
// local imports
import type { IUserSettingsStore } from "./settings.store";
import { UserSettingsStore } from "./settings.store";

type TUserErrorStatus = {
  status: string;
  message: string;
};

export interface IUserStore {
  // observables
  isAuthenticated: boolean;
  isLoading: boolean;
  error: TUserErrorStatus | undefined;
  data: IUser | undefined;
  // store observables
  userProfile: IUserProfileStore;
  userSettings: IUserSettingsStore;
  accounts: Record<string, IAccountStore>;
  permission: IUserPermissionStore;
  // actions
  fetchCurrentUser: () => Promise<IUser | undefined>;
  updateCurrentUser: (data: Partial<IUser>) => Promise<IUser | undefined>;
  handleSetPassword: (csrfToken: string, data: { password: string }) => Promise<IUser | undefined>;
  deactivateAccount: () => Promise<void>;
  changePassword: (
    csrfToken: string,
    payload: { old_password?: string; new_password: string }
  ) => Promise<IUser | undefined>;
  reset: () => void;
  signOut: () => Promise<void>;
  // computed
  canPerformAnyCreateAction: boolean;
  projectsWithCreatePermissions: { [projectId: string]: number } | null;
}

export class UserStore implements IUserStore {
  // observables
  isAuthenticated: boolean = false;
  isLoading: boolean = false;
  error: TUserErrorStatus | undefined = undefined;
  data: IUser | undefined = undefined;
  // store observables
  userProfile: IUserProfileStore;
  userSettings: IUserSettingsStore;
  accounts: Record<string, IAccountStore> = {};
  permission: IUserPermissionStore;
  // service
  userService: UserService;
  authService: AuthService;

  constructor(private store: RootStore) {
    // stores
    this.userProfile = new ProfileStore(store);
    this.userSettings = new UserSettingsStore();
    this.permission = new UserPermissionStore(store);
    // service
    this.userService = new UserService();
    this.authService = new AuthService();
    // observables
    makeObservable(this, {
      // observables
      isAuthenticated: observable.ref,
      isLoading: observable.ref,
      error: observable,
      // model observables
      data: observable,
      userProfile: observable,
      userSettings: observable,
      accounts: observable,
      permission: observable,
      // actions
      fetchCurrentUser: action,
      updateCurrentUser: action,
      handleSetPassword: action,
      deactivateAccount: action,
      changePassword: action,
      reset: action,
      signOut: action,
      // computed
      canPerformAnyCreateAction: computed,
      projectsWithCreatePermissions: computed,
    });
  }

  /**
   * @description fetches the current user
   * @returns {Promise<IUser>}
   */
  fetchCurrentUser = async (): Promise<IUser> => {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.error = undefined;
      });
      const user = await this.userService.currentUser();
      if (user && user?.id) {
        await Promise.all([
          this.userProfile.fetchUserProfile(),
          this.userSettings.fetchCurrentUserSettings(),
          this.store.workspaceRoot.fetchWorkspaces(),
        ]);
        runInAction(() => {
          this.data = user;
          this.isLoading = false;
          this.isAuthenticated = true;
        });
      } else
        runInAction(() => {
          this.data = user;
          this.isLoading = false;
          this.isAuthenticated = false;
        });
      return user;
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
        this.isAuthenticated = false;
        this.error = {
          status: "user-fetch-error",
          message: "Failed to fetch current user",
        };
      });
      throw error;
    }
  };

  /**
   * @description updates the current user
   * @param data
   * @returns {Promise<IUser>}
   */
  updateCurrentUser = async (data: Partial<IUser>): Promise<IUser> => {
    const currentUserData = this.data;
    try {
      if (currentUserData) {
        Object.keys(data).forEach((key: string) => {
          const userKey: keyof IUser = key as keyof IUser;
          if (this.data) set(this.data, userKey, data[userKey]);
        });
      }
      const user = await this.userService.updateUser(data);
      return user;
    } catch (error) {
      if (currentUserData) {
        Object.keys(currentUserData).forEach((key: string) => {
          const userKey: keyof IUser = key as keyof IUser;
          if (this.data) set(this.data, userKey, currentUserData[userKey]);
        });
      }
      runInAction(() => {
        this.error = {
          status: "user-update-error",
          message: "Failed to update current user",
        };
      });
      throw error;
    }
  };

  /**
   * @description update the user password
   * @param data
   * @returns {Promise<IUser>}
   */
  handleSetPassword = async (csrfToken: string, data: { password: string }): Promise<IUser | undefined> => {
    const currentUserData = cloneDeep(this.data);
    try {
      if (currentUserData && currentUserData.is_password_autoset && this.data) {
        const user = await this.authService.setPassword(csrfToken, { password: data.password });
        set(this.data, ["is_password_autoset"], false);
        return user;
      }
      return undefined;
    } catch (error) {
      if (this.data) set(this.data, ["is_password_autoset"], true);
      runInAction(() => {
        this.error = {
          status: "user-update-error",
          message: "Failed to update current user",
        };
      });
      throw error;
    }
  };

  changePassword = async (
    csrfToken: string,
    payload: {
      old_password?: string;
      new_password: string;
    }
  ): Promise<IUser | undefined> => {
    try {
      const user = await this.userService.changePassword(csrfToken, payload);
      if (this.data) set(this.data, ["is_password_autoset"], false);
      return user;
    } catch (error) {
      console.log(error);
      throw error;
    }
  };

  /**
   * @description deactivates the current user
   * @returns {Promise<void>}
   */
  deactivateAccount = async (): Promise<void> => {
    await this.userService.deactivateAccount();
    this.store.resetOnSignOut();
  };

  /**
   * @description resets the user store
   * @returns {void}
   */
  reset = (): void => {
    runInAction(() => {
      this.isAuthenticated = false;
      this.isLoading = false;
      this.error = undefined;
      this.data = undefined;
      this.userProfile = new ProfileStore(this.store);
      this.userSettings = new UserSettingsStore();
      this.permission = new UserPermissionStore(this.store);
    });
  };

  /**
   * @description signs out the current user
   * @returns {Promise<void>}
   */
  signOut = async (): Promise<void> => {
    await this.authService.signOut(API_BASE_URL);
    this.store.resetOnSignOut();
  };

  // helper actions
  /**
   * @description fetches the projects with write permissions
   * @returns {{[projectId: string]: number} || null}
   */
  fetchProjectsWithCreatePermissions = (): { [key: string]: TUserPermissions } => {
    const { workspaceSlug } = this.store.router;

    const allWorkspaceProjectRoles = this.permission.getProjectRolesByWorkspaceSlug(workspaceSlug || "");

    const userPermissions =
      (allWorkspaceProjectRoles &&
        Object.keys(allWorkspaceProjectRoles)
          .filter((key) => allWorkspaceProjectRoles[key] >= EUserPermissions.MEMBER)
          .reduce(
            (res: { [projectId: string]: number }, key: string) => ((res[key] = allWorkspaceProjectRoles[key]), res),
            {}
          )) ||
      null;

    return userPermissions;
  };

  /**
   * @description returns projects where user has permissions
   * @returns {{[projectId: string]: number} || null}
   */
  get projectsWithCreatePermissions() {
    return this.fetchProjectsWithCreatePermissions();
  }

  /**
   * @description returns true if user has permissions to write in any project
   * @returns {boolean}
   */
  get canPerformAnyCreateAction() {
    const filteredProjects = this.fetchProjectsWithCreatePermissions();
    return filteredProjects ? Object.keys(filteredProjects).length > 0 : false;
  }
}
