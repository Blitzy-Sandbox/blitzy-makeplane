/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace API token CRUD operations.
 *
 * State slice:
 *   - apiTokens: Record<string, IApiToken> | null — id-keyed cache of API tokens for the
 *       current user/workspace; null until the first fetch resolves, then a populated map.
 *
 * Actions:
 *   - fetchApiTokens(): Promise<IApiToken[]> — GET via APITokenService.list(); reduces the
 *       response array into an id-keyed object and replaces this.apiTokens inside runInAction.
 *   - fetchApiTokenDetails(tokenId): Promise<IApiToken> — GET via APITokenService.retrieve();
 *       merges the response into this.apiTokens (entry for response.id added or overwritten).
 *   - createApiToken(data): Promise<IApiToken> — POST via APITokenService.create(); merges the
 *       newly created entry into this.apiTokens AS-IS (no scrubbing).
 *       SECURITY (must be read together with the cache-retention note below):
 *         The raw `token` value is included in the POST /api/.../api-tokens/ response ONCE and
 *         is the only opportunity the consumer has to capture it; subsequent list/retrieve
 *         responses never re-expose it. `IApiToken.token` is therefore an optional field that
 *         is populated only on the create response.
 *       SECURITY — observable cache retention:
 *         Because the implementation does `this.apiTokens[response.id] = response` without
 *         deleting `response.token` first, the raw token CAN remain in the observable cache
 *         for the lifetime of the store instance (i.e. until `resetOnSignOut` rebuilds the
 *         workspace root store). Any component that re-reads `this.apiTokens[id]` after
 *         creation — including via `getApiTokenById` — observes the raw token. A subsequent
 *         `fetchApiTokens()` overwrites the cached entry with a server response that omits
 *         `token`, which is the practical mitigation today.
 *         // INTENT UNCLEAR: the sibling `webhook.store.ts` deletes `secret_key` from the
 *         //                 create/regenerate response before merging it into the cache,
 *         //                 while this store keeps the raw `token` in the cache. Whether
 *         //                 that asymmetry is intentional (UX may rely on re-reading the
 *         //                 token from the cache between creation and the user copying
 *         //                 it) or an oversight is not documented in the codebase. The
 *         //                 safer pattern — mirroring webhook.store.ts — would be to
 *         //                 `delete response.token` before the spread and return the raw
 *         //                 value only via the resolved Promise.
 *   - deleteApiToken(tokenId): Promise<void> — DELETE via APITokenService.destroy(); removes the
 *       tokenId entry from this.apiTokens.
 *
 * Computed:
 *   - getApiTokenById(apiTokenId) — computedFn-memoized selector keyed by apiTokenId (mobx-utils);
 *       recomputes when the apiTokens map changes; returns null when the map is null or the id
 *       is absent.
 *
 * Consumers:
 *   - apps/web/core/components/api-token/** (delete-token-modal, token-list-item, empty-state,
 *       modal/form, modal/create-token-modal, modal/generated-token-details)
 *   - apps/web/core/components/settings/profile/content/pages/api-tokens.tsx
 *   - apps/web/app/routes/redirects/core/api-tokens.tsx
 *
 * Composition:
 *   - Instantiated by `BaseWorkspaceRootStore` (`apps/web/core/store/workspace/index.ts`)
 *       and assigned as the `apiToken` field on the workspace root; reached from the
 *       React context root via `rootStore.workspaceRoot.apiToken`.
 */

import { action, observable, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import { APITokenService } from "@plane/services";
import type { IApiToken } from "@plane/types";
// services
// store
import type { CoreRootStore } from "../root.store";

export interface IApiTokenStore {
  // observables
  apiTokens: Record<string, IApiToken> | null;
  // computed actions
  getApiTokenById: (apiTokenId: string) => IApiToken | null;
  // fetch actions
  fetchApiTokens: () => Promise<IApiToken[]>;
  fetchApiTokenDetails: (tokenId: string) => Promise<IApiToken>;
  // crud actions
  createApiToken: (data: Partial<IApiToken>) => Promise<IApiToken>;
  deleteApiToken: (tokenId: string) => Promise<void>;
}

export class ApiTokenStore implements IApiTokenStore {
  // observables
  apiTokens: Record<string, IApiToken> | null = null;
  // services
  apiTokenService;
  // root store
  rootStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      apiTokens: observable,
      // fetch actions
      fetchApiTokens: action,
      fetchApiTokenDetails: action,
      // CRUD actions
      createApiToken: action,
      deleteApiToken: action,
    });
    // root store
    this.rootStore = _rootStore;
    // services
    this.apiTokenService = new APITokenService();
  }

  /**
   * get API token by id
   * @param apiTokenId
   */
  getApiTokenById = computedFn((apiTokenId: string) => {
    if (!this.apiTokens) return null;
    return this.apiTokens[apiTokenId] || null;
  });

  /**
   * fetch all the API tokens
   */
  fetchApiTokens = async () =>
    await this.apiTokenService.list().then((response) => {
      const apiTokensObject: { [apiTokenId: string]: IApiToken } = response.reduce((accumulator, currentWebhook) => {
        if (currentWebhook && currentWebhook.id) {
          return { ...accumulator, [currentWebhook.id]: currentWebhook };
        }
        return accumulator;
      }, {});
      runInAction(() => {
        this.apiTokens = apiTokensObject;
      });
      return response;
    });

  /**
   * fetch API token details using token id
   * @param tokenId
   */
  fetchApiTokenDetails = async (tokenId: string) =>
    await this.apiTokenService.retrieve(tokenId).then((response) => {
      runInAction(() => {
        this.apiTokens = { ...this.apiTokens, [response.id]: response };
      });
      return response;
    });

  /**
   * create API token using data
   * @param data
   */
  createApiToken = async (data: Partial<IApiToken>) =>
    await this.apiTokenService.create(data).then((response) => {
      runInAction(() => {
        this.apiTokens = { ...this.apiTokens, [response.id]: response };
      });
      return response;
    });

  /**
   * delete API token using token id
   * @param tokenId
   */
  deleteApiToken = async (tokenId: string) =>
    await this.apiTokenService.destroy(tokenId).then(() => {
      const updatedApiTokens = { ...this.apiTokens };
      delete updatedApiTokens[tokenId];
      runInAction(() => {
        this.apiTokens = updatedApiTokens;
      });
    });
}
