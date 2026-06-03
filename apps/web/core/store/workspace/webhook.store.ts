/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace webhook CRUD with one-time HMAC secret reveal.
 *
 * Composed under `BaseWorkspaceRootStore.webhook` in
 * `apps/web/core/store/workspace/index.ts` (instantiated with the
 * `CoreRootStore` so the store can read `rootStore.router.webhookId`).
 *
 * State slice:
 *   - webhooks: Record<string, IWebhook> | null — id-keyed cache of webhook
 *       configuration records for the active workspace; `null` until the
 *       first `fetchWebhooks` resolves.
 *   - webhookSecretKey: string | null — registered with `observable.ref`
 *       (not `observable`) for shallow reactivity on the primitive value;
 *       transiently holds the HMAC secret revealed by `createWebhook` /
 *       `regenerateSecretKey`. Must be cleared via `clearSecretKey()` once
 *       the UI has displayed/copied the value so the reveal does not
 *       persist across renders.
 *
 * Computed:
 *   - currentWebhook — derives the currently-routed webhook from
 *       `rootStore.router.webhookId` and the `webhooks` cache. Recomputes
 *       whenever `router.webhookId` or `webhooks` changes; returns `null`
 *       when no webhook id is in the route or the cache misses the id.
 *
 * Computed actions (computedFn from `mobx-utils` — memoized per-argument
 * for cheap re-renders in lists):
 *   - getWebhookById(webhookId) — O(1) lookup into `webhooks`; returns
 *       `null` when the cache is empty or the id is unknown.
 *
 * Actions (each routes through `WebhookService` from
 * `@/services/webhook.service` and mutates state under `runInAction` for
 * atomic batched updates):
 *   - fetchWebhooks(workspaceSlug) → GET workspace webhooks; reduces the
 *       response array into an id-keyed object and assigns it to
 *       `webhooks`.
 *   - fetchWebhookById(workspaceSlug, webhookId) → GET a single webhook;
 *       merges the response into the `webhooks` map under its id.
 *   - createWebhook(workspaceSlug, data) → POST. SECURITY-CRITICAL one-time
 *       HMAC secret reveal: extracts `secret_key` from the response,
 *       writes it to `webhookSecretKey` (transient observable), then
 *       `delete`s it off the response before merging into the cache so the
 *       cached record never holds the raw secret. The secret is returned
 *       in the resolved promise as the ONLY opportunity for the UI to
 *       capture it — the API does not expose it on subsequent reads, and
 *       the only way to recover access is via `regenerateSecretKey`.
 *   - updateWebhook(workspaceSlug, webhookId, data) → PATCH; merges the
 *       partial `data` payload into the cached entry.
 *   - removeWebhook(workspaceSlug, webhookId) → DELETE; removes the entry
 *       from `webhooks` after the request resolves.
 *   - regenerateSecretKey(workspaceSlug, webhookId) → POST. Same one-time
 *       reveal pattern as `createWebhook` — returns the rotated secret in
 *       the promise, writes it to `webhookSecretKey`, and strips it from
 *       the cached record before the cache is updated.
 *   - clearSecretKey() → sets `webhookSecretKey` to `null`; called by the
 *       UI after the reveal has been displayed/copied so the transient
 *       value does not linger.
 *
 * Consumers:
 *   - apps/web/core/components/web-hooks/** — `webhooks-list.tsx`,
 *       `webhooks-list-item.tsx`, `create-webhook-modal.tsx`,
 *       `delete-webhook-modal.tsx`, `generated-hook-details.tsx`,
 *       `form/form.tsx`, `form/secret-key.tsx` (the secret-reveal surface).
 *   - apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/webhooks/page.tsx
 *       — workspace webhooks list route.
 *   - apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/webhooks/[webhookId]/page.tsx
 *       — webhook detail/edit route.
 *
 * Cross-reference:
 *   - The `secret_key` revealed once through this store is the HMAC key
 *     consumed by `apps/api/plane/bgtasks/webhook_task.py` to sign outbound
 *     event payloads (see tech spec §4.5 WEBHOOK DELIVERY WORKFLOW). The
 *     Celery worker reads the persisted record but never re-exposes the
 *     raw secret, which is why this store treats the reveal as one-time.
 */

// mobx
import { action, observable, makeObservable, computed, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { IWebhook } from "@plane/types";
// services
import { WebhookService } from "@/services/webhook.service";
// store
import type { CoreRootStore } from "../root.store";

export interface IWebhookStore {
  // observables
  webhooks: Record<string, IWebhook> | null;
  webhookSecretKey: string | null;
  // computed
  currentWebhook: IWebhook | null;
  // computed actions
  getWebhookById: (webhookId: string) => IWebhook | null;
  // fetch actions
  fetchWebhooks: (workspaceSlug: string) => Promise<IWebhook[]>;
  fetchWebhookById: (workspaceSlug: string, webhookId: string) => Promise<IWebhook>;
  // crud actions
  createWebhook: (
    workspaceSlug: string,
    data: Partial<IWebhook>
  ) => Promise<{ webHook: IWebhook; secretKey: string | null }>;
  updateWebhook: (workspaceSlug: string, webhookId: string, data: Partial<IWebhook>) => Promise<IWebhook>;
  removeWebhook: (workspaceSlug: string, webhookId: string) => Promise<void>;
  // secret key actions
  regenerateSecretKey: (
    workspaceSlug: string,
    webhookId: string
  ) => Promise<{ webHook: IWebhook; secretKey: string | null }>;
  clearSecretKey: () => void;
}

export class WebhookStore implements IWebhookStore {
  // observables
  webhooks: Record<string, IWebhook> | null = null;
  webhookSecretKey: string | null = null;
  // services
  webhookService;
  // root store
  rootStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observables
      webhooks: observable,
      webhookSecretKey: observable.ref,
      // computed
      currentWebhook: computed,
      // fetch actions
      fetchWebhooks: action,
      fetchWebhookById: action,
      // CRUD actions
      createWebhook: action,
      updateWebhook: action,
      removeWebhook: action,
      // secret key actions
      regenerateSecretKey: action,
      clearSecretKey: action,
    });

    // services
    this.webhookService = new WebhookService();
    // root store
    this.rootStore = _rootStore;
  }

  /**
   * computed value of current webhook based on webhook id saved in the query store
   */
  get currentWebhook() {
    const webhookId = this.rootStore.router.webhookId;
    if (!webhookId) return null;
    const currentWebhook = this.webhooks?.[webhookId] ?? null;
    return currentWebhook;
  }

  /**
   * get webhook info from the object of webhooks in the store using webhook id
   * @param webhookId
   */
  getWebhookById = computedFn((webhookId: string) => this.webhooks?.[webhookId] || null);

  /**
   * fetch all the webhooks for a workspace
   * @param workspaceSlug
   */
  fetchWebhooks = async (workspaceSlug: string) =>
    await this.webhookService.fetchWebhooksList(workspaceSlug).then((response) => {
      const webHookObject: { [webhookId: string]: IWebhook } = response.reduce((accumulator, currentWebhook) => {
        if (currentWebhook && currentWebhook.id) {
          return { ...accumulator, [currentWebhook.id]: currentWebhook };
        }
        return accumulator;
      }, {});
      runInAction(() => {
        this.webhooks = webHookObject;
      });
      return response;
    });

  /**
   * fetch webhook info from API using webhook id
   * @param workspaceSlug
   * @param webhookId
   */
  fetchWebhookById = async (workspaceSlug: string, webhookId: string) =>
    await this.webhookService.fetchWebhookDetails(workspaceSlug, webhookId).then((response) => {
      runInAction(() => {
        this.webhooks = {
          ...this.webhooks,
          [response.id]: response,
        };
      });
      return response;
    });

  /**
   * create a new webhook for a workspace using the data
   * @param workspaceSlug
   * @param data
   */
  createWebhook = async (workspaceSlug: string, data: Partial<IWebhook>) =>
    await this.webhookService.createWebhook(workspaceSlug, data).then((response) => {
      const _secretKey = response?.secret_key ?? null;
      delete response?.secret_key;
      const _webhooks = this.webhooks;
      if (response && response.id && _webhooks) _webhooks[response.id] = response;
      runInAction(() => {
        this.webhookSecretKey = _secretKey || null;
        this.webhooks = _webhooks;
      });
      return { webHook: response, secretKey: _secretKey };
    });

  /**
   * update a webhook using the data
   * @param workspaceSlug
   * @param webhookId
   * @param data
   */
  updateWebhook = async (workspaceSlug: string, webhookId: string, data: Partial<IWebhook>) =>
    await this.webhookService.updateWebhook(workspaceSlug, webhookId, data).then((response) => {
      let _webhooks = this.webhooks;
      if (webhookId && _webhooks && this.webhooks)
        _webhooks = { ..._webhooks, [webhookId]: { ...this.webhooks[webhookId], ...data } };
      runInAction(() => {
        this.webhooks = _webhooks;
      });
      return response;
    });

  /**
   * delete a webhook using webhook id
   * @param workspaceSlug
   * @param webhookId
   */
  removeWebhook = async (workspaceSlug: string, webhookId: string) =>
    await this.webhookService.deleteWebhook(workspaceSlug, webhookId).then(() => {
      const _webhooks = this.webhooks ?? {};
      delete _webhooks[webhookId];
      runInAction(() => {
        this.webhooks = _webhooks;
      });
    });

  /**
   * regenerate secret key for a webhook using webhook id
   * @param workspaceSlug
   * @param webhookId
   */
  regenerateSecretKey = async (workspaceSlug: string, webhookId: string) =>
    await this.webhookService.regenerateSecretKey(workspaceSlug, webhookId).then((response) => {
      const _secretKey = response?.secret_key ?? null;
      delete response?.secret_key;
      const _webhooks = this.webhooks;
      if (_webhooks && response && response.id) {
        _webhooks[response.id] = response;
      }
      runInAction(() => {
        this.webhookSecretKey = _secretKey || null;
        this.webhooks = _webhooks;
      });
      return { webHook: response, secretKey: _secretKey };
    });

  /**
   * clear secret key from the store
   */
  clearSecretKey = () => {
    this.webhookSecretKey = null;
  };
}
