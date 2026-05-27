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
 *       newly created entry into this.apiTokens.
 *       SECURITY: the raw secret token value is returned in the create response ONCE and is the
 *       only opportunity the consumer has to capture it; subsequent list/retrieve responses only
 *       expose metadata (no raw token), so the canonical UX surfaces the token on creation and
 *       never again.
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
 *   - Instantiated as BaseWorkspaceRootStore.apiToken (apps/web/core/store/workspace/index.ts:123)
 *       and reached from the React context root via rootStore.workspaceRoot.apiToken.
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
