/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: AccountStore — client-side mirror of a third-party OAuth provider
 * linkage attached to the current user (one instance per linked provider).
 *
 * `AccountStore` is a thin reactive wrapper around a single `IUserAccount`
 * payload, surfacing OAuth provider linkage metadata (`provider_account_id`,
 * `provider`) to the UI in a MobX-observable container. Each linked
 * third-party provider (Google, GitHub, etc.) is represented by one
 * `AccountStore` instance keyed by `provider_account_id` on the parent
 * `UserStore`.
 *
 * Per the repository architectural context, this store is the client-side
 * mirror of session/account state managed server-side by
 * `apps/api/plane/authentication/` (Django OAuth/session adapters). Session
 * and cookie handling live in `apps/api/plane/authentication/` and
 * `@/services/auth.service` — this store is a read-only mirror of provider
 * linkage metadata.
 *
 * State slice (observables):
 *   - isLoading: boolean — async-operation indicator (declared `observable.ref`).
 *   - error: any | undefined — last error payload from a failed operation
 *     (declared `observable`).
 *   - provider_account_id: string | undefined — opaque provider-assigned
 *     account ID (e.g. Google's `sub` claim) (declared `observable.ref`).
 *   - provider: string | undefined — provider identifier (e.g. `"google"`,
 *     `"github"`) (declared `observable.ref`).
 *
 * Actions:
 *   - None. No `@action` methods are registered in `makeObservable`; the
 *     store is intentionally read-only at the model level. State is
 *     hydrated once at construction time via `lodash-es#set` over
 *     `Object.entries(_account)` — fields outside the four declared
 *     observables are tolerated but only those four are reactive.
 *
 * Constructor contract:
 *   - Accepts `store: CoreRootStore` (held as a private reference for
 *     cross-store access via `this.store`) and `_account: IUserAccount`
 *     (the seed payload).
 *   - Iterates the seed and writes each entry via
 *     `set(this, [key], value ?? undefined)`, populating
 *     `provider_account_id`, `provider`, and any additional keys (the
 *     additional keys are NOT reactive).
 *   - Instantiates a local `UserService` instance for any future
 *     account-scoped API calls (none are currently wired through this
 *     store).
 *
 * Consumers:
 *   - `UserStore` (`./index.ts:68`) exposes `accounts: Record<string,
 *     IAccountStore>` keyed by `provider_account_id`.
 *   - Account-management UI under `apps/web/core/components/account/**`
 *     (sign-in providers list, connected-accounts settings page) reads
 *     from `store.user.accounts`.
 *   - `UserService` (imported at `./index.ts:18`) is the primary write
 *     path for account/session mutations; this store is the read mirror.
 *
 * Cross-references:
 *   - Server side: `apps/api/plane/authentication/` houses the OAuth
 *     provider adapters (AAP Directive 1).
 *   - Composition root: `./index.ts:32-41` — the `IUserStore` interface
 *     includes `accounts: Record<string, IAccountStore>`.
 *   - Type definition: `IUserAccount` from `@plane/types`.
 *
 * Note: The store binds to `CoreRootStore` (not `RootStore`) — narrower
 * than the user/permission stores. It therefore cannot reach into
 * `plane-web/` Enterprise Edition store extensions and sees only
 * Community Edition stores.
 */

import { set } from "lodash-es";
import { makeObservable, observable } from "mobx";
// types
import type { IUserAccount } from "@plane/types";
// services
import { UserService } from "@/services/user.service";
// store
import type { CoreRootStore } from "../root.store";

export interface IAccountStore {
  // observables
  isLoading: boolean;
  error: any | undefined;
  // model observables
  provider_account_id: string | undefined;
  provider: string | undefined;
}

export class AccountStore implements IAccountStore {
  isLoading: boolean = false;
  error: any | undefined = undefined;
  // model observables
  provider_account_id: string | undefined = undefined;
  provider: string | undefined = undefined;
  // service
  userService: UserService;
  constructor(
    private store: CoreRootStore,
    private _account: IUserAccount
  ) {
    makeObservable(this, {
      // observables
      isLoading: observable.ref,
      error: observable,
      // model observables
      provider_account_id: observable.ref,
      provider: observable.ref,
    });
    // service
    this.userService = new UserService();
    // set account data
    Object.entries(this._account).forEach(([key, value]) => {
      set(this, [key], value ?? undefined);
    });
  }
}
