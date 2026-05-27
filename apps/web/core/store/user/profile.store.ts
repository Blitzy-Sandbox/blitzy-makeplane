/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProfileStore — MobX domain store owning the current authenticated user's
 * `TUserProfile`, encompassing onboarding state, theme preferences, locale,
 * billing/marketing flags, and tour-completion status. Coordinates optimistic
 * client-side mutations with the `UserService` REST backend.
 *
 * Distinct from `UserSettingsStore`: this store holds preference and onboarding
 * data persisted to the `Profile` Django model, whereas `UserSettingsStore`
 * carries session/workspace routing context plus transient UI flags. Profile
 * mutations flow through `@/services/user.service#UserService` to the Django
 * endpoints in `apps/api/plane/app/views/user/base.py` (see AAP Directive 1
 * for the server contract; serializer at
 * `apps/api/plane/app/serializers/user.py`; model at
 * `apps/api/plane/db/models/user.py#Profile`).
 *
 * State slice (observables registered in `makeObservable`):
 *   - isLoading: boolean (observable.ref, default `false`)
 *       Async fetch indicator toggled by `fetchUserProfile`.
 *   - error: TError | undefined (observable)
 *       `{ status, message }` of the most recent failure. Status strings are
 *       ad-hoc literals (e.g., `"user-profile-fetch-error"`,
 *       `"user-profile-update-error"`), NOT enum constants — consumers must
 *       match the literal values.
 *   - data: TUserProfile (observable)
 *       Rich profile object initialised with sensible defaults so consumers
 *       can render before hydration completes. Fields:
 *         - `id`, `user`, `role`, `last_workspace_id`
 *         - `theme: IUserTheme` — `{ theme, primary, background, darkPalette }`
 *         - `onboarding_step` — `{ workspace_join, profile_complete,
 *             workspace_create, workspace_invite }` boolean checklist driving
 *             the onboarding wizard
 *         - `is_onboarded`, `is_tour_completed`
 *         - `use_case`, `billing_address_country`, `billing_address`,
 *             `has_billing_address`, `has_marketing_email_consent`
 *         - `created_at`, `updated_at` — ISO timestamps
 *         - `language: string` — locale tag that drives `@plane/i18n` via
 *             `setLanguage`
 *         - `start_of_the_week: EStartOfTheWeek` — calendar week-start
 *             preference; defaults to `EStartOfTheWeek.SUNDAY` pre-hydration
 *             so consumers can render without null checks
 *
 * Actions (registered as MobX actions in `makeObservable`):
 *   - fetchUserProfile() => Promise<TUserProfile | undefined>
 *       Calls `userService.getCurrentUserProfile()`; on success replaces
 *       `data` and clears `isLoading`. Side effect: fires
 *       `setLanguage(userProfile.language)` from `@plane/i18n` (fire-and-forget)
 *       when language is present. On failure sets
 *       `error = { status: "user-profile-fetch-error", ... }` and rethrows.
 *   - updateUserProfile(data: Partial<TUserProfile>) =>
 *       Promise<TUserProfile | undefined>
 *       Optimistic local mutation via `mutateUserProfile`, then
 *       `userService.updateCurrentUserProfile(data)`. Side effect: fires
 *       `setLanguage(data.language)` from `@plane/i18n` (fire-and-forget)
 *       before the network call when the language field is being updated.
 *       Rolls back to the pre-mutation snapshot on failure (gated on
 *       `currentUserProfileData` truthiness) and surfaces
 *       `error = { status: "user-profile-update-error", ... }`. Does NOT
 *       rethrow on failure.
 *   - updateTourCompleted() => Promise<TUserProfile | undefined>
 *       Optimistic `is_tour_completed = true`; calls
 *       `userService.updateUserTourCompleted()`. On failure restores the
 *       previous `is_tour_completed` value, sets
 *       `error = { status: "user-profile-tour-complete-error", ... }`, and
 *       rethrows.
 *   - updateUserTheme(data: Partial<IUserTheme>) =>
 *       Promise<TUserProfile | undefined>
 *       Optimistic deep-merge into `data.theme` via `lodash-es#set` over each
 *       key of the incoming `Partial<IUserTheme>`, then
 *       `userService.updateCurrentUserProfile({ theme })`. Rolls back to a
 *       `cloneDeep` snapshot of the previous theme on failure and surfaces
 *       `error = { status: "user-profile-theme-update-error", ... }`.
 *
 * Non-`@action` methods (intentionally NOT in the `makeObservable` action list):
 *   - finishUserOnboarding() => Promise<void>
 *       Async coordinator that picks the first workspace from
 *       `store.workspaceRoot.workspaces` as `last_workspace_id`, calls
 *       `userService.updateCurrentUserProfile` followed by
 *       `userService.updateUserOnBoard`, then in parallel cache-busts both
 *       `fetchUserProfile()` and
 *       `store.user.userSettings.fetchCurrentUserSettings(true)`. Only after
 *       both refreshes resolve does it optimistically set `is_onboarded: true`
 *       — this strict ordering guarantees that subsequent reads observe the
 *       freshly persisted onboarded state.
 *   - mutateUserProfile(data: Partial<TUserProfile>) => void
 *       Helper that writes selectively into `data` only for keys already
 *       present in the existing profile shape (`if (key in this.data)` guard).
 *       Not registered as a MobX action because callers wrap it in their own
 *       `runInAction` / action context.
 *
 * Computed values:
 *   None — no `@computed` getters or `mobx-utils#computedFn` factories are
 *   registered; all reads happen directly off the `data` observable.
 *
 * Consumers:
 *   - Onboarding flow under `apps/web/core/components/onboarding/**` — reads
 *       `data.onboarding_step`, calls `finishUserOnboarding`,
 *       `updateUserProfile`.
 *   - Profile settings under `apps/web/core/components/profile/**` — reads
 *       `data.language`, `data.use_case`, calls `updateUserProfile`.
 *   - Theme switcher and workspace-settings sidebars (e.g.,
 *       `apps/web/core/components/account/**`) — reads `data.theme`, calls
 *       `updateUserTheme`.
 *   - Cross-store: `UserStore.fetchCurrentUser` (`./index.ts`) calls
 *       `this.userProfile.fetchUserProfile()` during the auth bootstrap;
 *       `UserStore.reset` constructs a fresh `ProfileStore` on sign-out.
 *
 * Language change side effect:
 *   `setLanguage` from `@plane/i18n` is invoked at TWO sites — after a
 *   successful fetch and before an optimistic update — as fire-and-forget
 *   (`void setLanguage(...)`). Locale propagation does NOT block UI updates.
 *   The `TLanguage` type narrows the accepted locale tags.
 *
 * Architectural notes:
 *   - Binds to `CoreRootStore` (not the EE `RootStore`) — intentional, since
 *     this store only needs the Community-Edition cross-store surfaces
 *     (`workspaceRoot`, `user.userSettings`).
 *   - All four update actions follow the consistent
 *     optimistic-mutation-with-rollback pattern used across
 *     `apps/web/core/store/` mutation actions.
 */

import { cloneDeep, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// plane imports
import { setLanguage } from "@plane/i18n";
import type { TLanguage } from "@plane/i18n";
// types
import type { IUserTheme, TUserProfile } from "@plane/types";
import { EStartOfTheWeek } from "@plane/types";
// services
import { UserService } from "@/services/user.service";
// store
import type { CoreRootStore } from "../root.store";

type TError = {
  status: string;
  message: string;
};

export interface IUserProfileStore {
  // observables
  isLoading: boolean;
  error: TError | undefined;
  data: TUserProfile;
  // actions
  fetchUserProfile: () => Promise<TUserProfile | undefined>;
  updateUserProfile: (data: Partial<TUserProfile>) => Promise<TUserProfile | undefined>;
  finishUserOnboarding: () => Promise<void>;
  updateTourCompleted: () => Promise<TUserProfile | undefined>;
  updateUserTheme: (data: Partial<IUserTheme>) => Promise<TUserProfile | undefined>;
}

export class ProfileStore implements IUserProfileStore {
  isLoading: boolean = false;
  error: TError | undefined = undefined;
  data: TUserProfile = {
    id: undefined,
    user: undefined,
    role: undefined,
    last_workspace_id: undefined,
    theme: {
      theme: undefined,
      primary: undefined,
      background: undefined,
      darkPalette: false,
    },
    onboarding_step: {
      workspace_join: false,
      profile_complete: false,
      workspace_create: false,
      workspace_invite: false,
    },
    is_onboarded: false,
    is_tour_completed: false,
    use_case: undefined,
    billing_address_country: undefined,
    billing_address: undefined,
    has_billing_address: false,
    has_marketing_email_consent: false,
    created_at: "",
    updated_at: "",
    language: "",
    start_of_the_week: EStartOfTheWeek.SUNDAY,
  };

  // services
  userService: UserService;

  constructor(public store: CoreRootStore) {
    makeObservable(this, {
      // observables
      isLoading: observable.ref,
      error: observable,
      data: observable,
      // actions
      fetchUserProfile: action,
      updateUserProfile: action,
      updateTourCompleted: action,
      updateUserTheme: action,
    });
    // services
    this.userService = new UserService();
  }

  // helper action
  mutateUserProfile = (data: Partial<TUserProfile>) => {
    if (!data) return;
    Object.entries(data).forEach(([key, value]) => {
      if (key in this.data) set(this.data, key, value);
    });
  };

  // actions
  /**
   * @description fetches user profile information
   * @returns {Promise<TUserProfile | undefined>}
   */
  fetchUserProfile = async (): Promise<TUserProfile | undefined> => {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.error = undefined;
      });
      const userProfile = await this.userService.getCurrentUserProfile();
      runInAction(() => {
        this.isLoading = false;
        this.data = userProfile;
      });
      if (userProfile.language) {
        void setLanguage(userProfile.language as TLanguage);
      }
      return userProfile;
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
        this.error = {
          status: "user-profile-fetch-error",
          message: "Failed to fetch user profile",
        };
      });
      throw error;
    }
  };

  /**
   * @description updated the user profile information
   * @param {Partial<TUserProfile>} data
   * @returns {Promise<TUserProfile | undefined>}
   */
  updateUserProfile = async (data: Partial<TUserProfile>): Promise<TUserProfile | undefined> => {
    const currentUserProfileData = this.data;
    try {
      if (currentUserProfileData) {
        this.mutateUserProfile(data);
      }
      if (data.language) {
        void setLanguage(data.language as TLanguage);
      }
      const userProfile = await this.userService.updateCurrentUserProfile(data);
      return userProfile;
    } catch {
      if (currentUserProfileData) {
        this.mutateUserProfile(currentUserProfileData);
      }
      runInAction(() => {
        this.error = {
          status: "user-profile-update-error",
          message: "Failed to update user profile",
        };
      });
    }
  };

  /**
   * @description finishes the user onboarding
   * @returns { void }
   */
  finishUserOnboarding = async (): Promise<void> => {
    try {
      const firstWorkspace = Object.values(this.store.workspaceRoot.workspaces ?? {})?.[0];
      const dataToUpdate: Partial<TUserProfile> = {
        onboarding_step: {
          profile_complete: true,
          workspace_join: true,
          workspace_create: true,
          workspace_invite: true,
        },
        last_workspace_id: firstWorkspace?.id,
      };

      // update user onboarding steps
      await this.userService.updateCurrentUserProfile(dataToUpdate);

      // update user onboarding status
      await this.userService.updateUserOnBoard();

      // Wait for user settings to be refreshed with cache-busting before updating onboarding status
      await Promise.all([
        this.fetchUserProfile(),
        this.store.user.userSettings.fetchCurrentUserSettings(true), // Cache-busting enabled
      ]);

      // Only after settings are refreshed, update the user profile store to mark as onboarded
      runInAction(() => {
        this.mutateUserProfile({ ...dataToUpdate, is_onboarded: true });
      });
    } catch (error) {
      runInAction(() => {
        this.error = {
          status: "user-profile-onboard-finish-error",
          message: "Failed to finish user onboarding",
        };
      });
      throw error;
    }
  };

  /**
   * @description updates the user tour completed status
   * @returns @returns {Promise<TUserProfile | undefined>}
   */
  updateTourCompleted = async () => {
    const isUserProfileTourCompleted = this.data.is_tour_completed || false;
    try {
      this.mutateUserProfile({ is_tour_completed: true });
      const userProfile = await this.userService.updateUserTourCompleted();
      return userProfile;
    } catch (error) {
      runInAction(() => {
        this.mutateUserProfile({ is_tour_completed: isUserProfileTourCompleted });
        this.error = {
          status: "user-profile-tour-complete-error",
          message: "Failed to update user profile is_tour_completed",
        };
      });
      throw error;
    }
  };

  /**
   * @description updates the user theme
   * @returns @returns {Promise<TUserProfile | undefined>}
   */
  updateUserTheme = async (data: Partial<IUserTheme>) => {
    const currentProfileTheme = cloneDeep(this.data.theme);
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          const dataKey = key as keyof IUserTheme;
          if (this.data.theme) set(this.data.theme, dataKey, data[dataKey]);
        });
      });
      const userProfile = await this.userService.updateCurrentUserProfile({
        theme: this.data.theme,
      });
      return userProfile;
    } catch (error) {
      runInAction(() => {
        Object.keys(data).forEach((key: string) => {
          const userKey: keyof IUserTheme = key as keyof IUserTheme;
          if (currentProfileTheme) set(this.data.theme, userKey, currentProfileTheme[userKey]);
        });
        this.error = {
          status: "user-profile-theme-update-error",
          message: "Failed to update user profile theme",
        };
      });
      throw error;
    }
  };
}
