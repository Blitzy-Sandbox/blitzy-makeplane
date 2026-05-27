/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for per-user issue notification subscription state — tracks whether the current user has
 * subscribed to notifications for each issue.
 *
 * State slice:
 * - subscriptionMap: Record<issueId, Record<userId, boolean>> — subscription flag scoped by issue id and
 *   user id; only the current user's row is ever read by the UI but the dimension is kept open so future
 *   admin/UX surfaces can list other subscribers without a schema change.
 *
 * Actions:
 * - addSubscription(issueId, isSubscribed): writes the current user's subscription flag for the issue;
 *   defaults to `false` when the input is undefined/null. Throws when no current user id is available.
 * - fetchSubscriptions(workspaceSlug, projectId, issueId): GET via IssueService.getIssueNotificationSubscriptionStatus
 *   and delegates to `addSubscription`.
 * - createSubscription(workspaceSlug, projectId, issueId): OPTIMISTIC subscribe — writes `true` first, then
 *   POST via IssueService.subscribeToIssueNotifications. On failure the canonical state is reconciled by
 *   re-fetching the subscription status.
 * - removeSubscription(workspaceSlug, projectId, issueId): OPTIMISTIC unsubscribe — writes `false` first,
 *   then POST via IssueService.unsubscribeFromIssueNotifications. On failure the canonical state is
 *   reconciled by re-fetching.
 *
 * Helper queries: getSubscriptionByIssueId resolves the current user's row from `rootIssueStore.currentUserId`.
 *
 * Service: backed by IssueService constructed with the parent IssueDetail's `serviceType` so the same
 * implementation serves both issues and epics.
 *
 * Consumers: notification subscribe button on the issue-detail surface
 * (apps/web/core/components/issues/issue-detail/**, peek-overview/**) accessed via
 * apps/web/core/hooks/store/use-issue-detail.ts.
 */

import { set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// services
import type { EIssueServiceType } from "@plane/types";
import { IssueService } from "@/services/issue/issue.service";
// types
import type { IIssueDetail } from "./root.store";
export interface IIssueSubscriptionStoreActions {
  addSubscription: (issueId: string, isSubscribed: boolean | undefined | null) => void;
  fetchSubscriptions: (workspaceSlug: string, projectId: string, issueId: string) => Promise<boolean>;
  createSubscription: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  removeSubscription: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
}

export interface IIssueSubscriptionStore extends IIssueSubscriptionStoreActions {
  // observables
  subscriptionMap: Record<string, Record<string, boolean>>; // Record defines subscriptionId as key and link as value
  // helper methods
  getSubscriptionByIssueId: (issueId: string) => boolean | undefined;
}

export class IssueSubscriptionStore implements IIssueSubscriptionStore {
  // observables
  subscriptionMap: Record<string, Record<string, boolean>> = {};
  // root store
  rootIssueDetail: IIssueDetail;
  // services
  issueService;

  constructor(rootStore: IIssueDetail, serviceType: EIssueServiceType) {
    makeObservable(this, {
      // observables
      subscriptionMap: observable,
      // actions
      addSubscription: action.bound,
      fetchSubscriptions: action,
      createSubscription: action,
      removeSubscription: action,
    });
    // root store
    this.rootIssueDetail = rootStore;
    // services
    this.issueService = new IssueService(serviceType);
  }

  // helper methods
  getSubscriptionByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    const currentUserId = this.rootIssueDetail.rootIssueStore.currentUserId;
    if (!currentUserId) return undefined;
    return this.subscriptionMap[issueId]?.[currentUserId] ?? undefined;
  };

  addSubscription = (issueId: string, isSubscribed: boolean | undefined | null) => {
    const currentUserId = this.rootIssueDetail.rootIssueStore.currentUserId;
    if (!currentUserId) throw new Error("user id not available");

    runInAction(() => {
      set(this.subscriptionMap, [issueId, currentUserId], isSubscribed ?? false);
    });
  };

  fetchSubscriptions = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const subscription = await this.issueService.getIssueNotificationSubscriptionStatus(
      workspaceSlug,
      projectId,
      issueId
    );
    this.addSubscription(issueId, subscription?.subscribed);
    return subscription?.subscribed;
  };

  createSubscription = async (workspaceSlug: string, projectId: string, issueId: string) => {
    try {
      const currentUserId = this.rootIssueDetail.rootIssueStore.currentUserId;
      if (!currentUserId) throw new Error("user id not available");

      runInAction(() => {
        set(this.subscriptionMap, [issueId, currentUserId], true);
      });

      await this.issueService.subscribeToIssueNotifications(workspaceSlug, projectId, issueId);
    } catch (error) {
      this.fetchSubscriptions(workspaceSlug, projectId, issueId);
      throw error;
    }
  };

  removeSubscription = async (workspaceSlug: string, projectId: string, issueId: string) => {
    try {
      const currentUserId = this.rootIssueDetail.rootIssueStore.currentUserId;
      if (!currentUserId) throw new Error("user id not available");

      runInAction(() => {
        set(this.subscriptionMap, [issueId, currentUserId], false);
      });

      await this.issueService.unsubscribeFromIssueNotifications(workspaceSlug, projectId, issueId);
    } catch (error) {
      this.fetchSubscriptions(workspaceSlug, projectId, issueId);
      throw error;
    }
  };
}
