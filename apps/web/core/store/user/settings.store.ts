/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * UserSettingsStore — MobX domain store owning the current user's `IUserSettings`,
 * which combines server-persisted workspace routing context (last/fallback workspace,
 * pending invites) with two transient UI flags (`sidebarCollapsed`, `isScrolled`).
 * Serves as the primary read source for the layout shell's default-workspace routing
 * decision after authentication.
 *
 * Distinct from `ProfileStore`: settings carry workspace routing context plus
 * ephemeral UI state, whereas `ProfileStore` holds user preference and onboarding
 * completion data. Hydration flows from the Django settings endpoint defined in
 * `apps/api/plane/app/views/user/base.py` via `@/services/user.service#UserService.currentUserSettings`.
 *
 * State slice (observables):
 *   - isLoading: boolean (observable.ref, default `false`)
 *       Async fetch indicator toggled by `fetchCurrentUserSettings`.
 *   - error: TError | undefined (observable)
 *       `{ status, message }` of the last failure; cleared at the start of each
 *       fetch and populated when the service call throws.
 *   - data: IUserSettings (observable)
 *       Structured settings payload — `{ id, email, workspace }` where `workspace`
 *       carries `{ last_workspace_id, last_workspace_slug, last_workspace_name,
 *       last_workspace_logo, fallback_workspace_id, fallback_workspace_slug,
 *       invites }`. The workspace context drives the layout shell's "where to route
 *       the user on boot" logic; `invites` lists pending workspace invitations.
 *   - sidebarCollapsed: boolean (observable.ref, default `true`)
 *       Sidebar UI state — NOT persisted to the backend; defaults to collapsed on
 *       every page load.
 *   - isScrolled: boolean (observable.ref, default `false`)
 *       Scroll-position derived flag used to add elevation/shadow to sticky
 *       headers; NOT persisted to the backend.
 *
 * Actions:
 *   - fetchCurrentUserSettings(bustCache?: boolean = false) => Promise<IUserSettings | undefined>
 *       Calls `userService.currentUserSettings(bustCache)` (HTTP GET against the
 *       Django user-settings endpoint). On success, replaces `data` and clears
 *       `isLoading`; on failure, sets `error` to `{ status: "error", message: ... }`
 *       and rethrows. The `bustCache` flag is the mechanism used by onboarding
 *       completion (see `./profile.store.ts:185`) to force a fresh server read
 *       after the onboarded flag is flipped server-side.
 *   - toggleSidebar(collapsed?: boolean) => void
 *       Sets `sidebarCollapsed = collapsed` when the arg is provided; otherwise
 *       toggles the boolean. Purely client-side — no API call. Implemented as an
 *       arrow-function class property so `this` binds naturally without
 *       `action.bound`.
 *   - toggleIsScrolled(isScrolled?: boolean) => void
 *       Same shape as `toggleSidebar` applied to the `isScrolled` observable.
 *       Purely client-side — no API call.
 *
 * Computed values:
 *   None — no `@computed` getters or `computedFn` factories are registered. All
 *   reads happen directly off the `data`, `sidebarCollapsed`, and `isScrolled`
 *   observables.
 *
 * Consumers:
 *   - Layout shell: `apps/web/core/components/workspace/**` — reads
 *     `data.workspace.last_workspace_slug` / `fallback_workspace_slug` to choose
 *     the default workspace on app boot.
 *   - Sidebar components (`WorkspaceSidebar`, `ProjectSidebar`, and similar) —
 *     read `sidebarCollapsed` to drive the responsive collapsed/expanded layout.
 *   - Sticky-header components — read `isScrolled` to apply elevation/shadow.
 *   - Settings page: `apps/web/core/components/account/preferences/**`.
 *   - Cross-store: `UserStore.fetchCurrentUser` (`./index.ts:118-124`) calls
 *     `this.userSettings.fetchCurrentUserSettings()` during the auth bootstrap.
 *   - Cross-store: `ProfileStore.finishUserOnboarding` (`./profile.store.ts:185`)
 *     calls `store.user.userSettings.fetchCurrentUserSettings(true)` with
 *     cache-busting after onboarding completion.
 *   - Cross-store: `UserStore.reset` (`./index.ts:239-249`) constructs a fresh
 *     `UserSettingsStore` on sign-out so user-bound state does not leak across
 *     sessions.
 *
 * Persistence distinction:
 *   - `data` (identity + workspace routing context) is SERVER-PERSISTED — backed
 *     by the Django user-settings endpoint and underlying user/workspace models.
 *   - `sidebarCollapsed` and `isScrolled` are TRANSIENT UI flags — NOT persisted
 *     to the backend and NOT written to localStorage in this file. They reset on
 *     every page reload. If a host application restores sidebar state on reload,
 *     the restoration is performed by an upstream caller invoking `toggleSidebar`;
 *     this file is intentionally agnostic about that mechanism.
 *
 * Defaults and initialization:
 *   All `IUserSettings` fields default to `undefined` so that consumers can render
 *   safely before network hydration completes (a "safe defaults" pattern that
 *   prevents null-pointer dereferences during early renders). The `workspace`
 *   sub-object is materialized as an empty record with `undefined` slots for each
 *   field rather than a single `undefined`, preserving the shape contract. The
 *   constructor takes NO `CoreRootStore` parameter — this store is self-contained
 *   and reachable only via `UserStore.userSettings` (see `./index.ts:77`), because
 *   all mutations are either local (UI flags) or self-contained
 *   (`userService.currentUserSettings`).
 *
 * Cross-references:
 *   - Server side: `apps/api/plane/app/views/user/base.py` (settings endpoint);
 *     `apps/api/plane/db/models/user.py` (data model).
 *   - Composition root: `./index.ts:67` (`userSettings: IUserSettingsStore` on
 *     `IUserStore`); `./index.ts:77` (`new UserSettingsStore()` construction).
 *   - Cache-busting consumer: `./profile.store.ts:185` (after onboarding
 *     finalization).
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// plane imports
import type { IUserSettings } from "@plane/types";
// services
import { UserService } from "@/services/user.service";

type TError = {
  status: string;
  message: string;
};

export interface IUserSettingsStore {
  // observables
  isLoading: boolean;
  error: TError | undefined;
  data: IUserSettings;
  sidebarCollapsed: boolean;
  isScrolled: boolean;
  // actions
  fetchCurrentUserSettings: (bustCache?: boolean) => Promise<IUserSettings | undefined>;
  toggleSidebar: (collapsed?: boolean) => void;
  toggleIsScrolled: (isScrolled?: boolean) => void;
}

export class UserSettingsStore implements IUserSettingsStore {
  // observables
  isLoading: boolean = false;
  sidebarCollapsed: boolean = true;
  error: TError | undefined = undefined;
  isScrolled: boolean = false;
  data: IUserSettings = {
    id: undefined,
    email: undefined,
    workspace: {
      last_workspace_id: undefined,
      last_workspace_slug: undefined,
      last_workspace_name: undefined,
      last_workspace_logo: undefined,
      fallback_workspace_id: undefined,
      fallback_workspace_slug: undefined,
      invites: undefined,
    },
  };
  // services
  userService: UserService;

  constructor() {
    makeObservable(this, {
      // observables
      isLoading: observable.ref,
      error: observable,
      data: observable,
      sidebarCollapsed: observable.ref,
      isScrolled: observable.ref,
      // actions
      fetchCurrentUserSettings: action,
      toggleSidebar: action,
      toggleIsScrolled: action,
    });
    // services
    this.userService = new UserService();
  }

  // actions
  toggleSidebar = (collapsed?: boolean) => {
    this.sidebarCollapsed = collapsed ?? !this.sidebarCollapsed;
  };

  toggleIsScrolled = (isScrolled?: boolean) => {
    this.isScrolled = isScrolled ?? !this.isScrolled;
  };

  // actions
  /**
   * @description fetches user profile information
   * @returns {Promise<IUserSettings | undefined>}
   */
  fetchCurrentUserSettings = async (bustCache: boolean = false) => {
    try {
      runInAction(() => {
        this.isLoading = true;
        this.error = undefined;
      });
      const userSettings = await this.userService.currentUserSettings(bustCache);
      runInAction(() => {
        this.isLoading = false;
        this.data = userSettings;
      });
      return userSettings;
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
        this.error = {
          status: "error",
          message: "Failed to fetch user settings",
        };
      });
      throw error;
    }
  };
}
