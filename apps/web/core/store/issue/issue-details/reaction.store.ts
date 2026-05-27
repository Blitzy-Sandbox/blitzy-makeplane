/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for emoji reactions on issues — grouped reaction cache (issueId → reactionKey → reactionId[])
 * paired with a flat reaction lookup map keyed by reaction id. Every mutation refreshes the activity feed
 * because reactions appear in the work item's audit timeline.
 *
 * State slice:
 * - reactions: TIssueReactionIdMap — grouped index of reaction ids organized as
 *   { [issueId]: { [reactionKey]: reactionId[] } }
 * - reactionMap: TIssueReactionMap — flat normalized lookup of reaction entities by reaction id
 *
 * Actions:
 * - addReactions(issueId, reactions): synchronous in-memory hydration used by `issue.store.ts.fetchIssue` to
 *   seed reactions embedded in the issue payload — avoids a second round-trip.
 * - fetchReactions(workspaceSlug, projectId, issueId): GET via IssueReactionService.listIssueReactions and
 *   delegates to `addReactions` for normalization.
 * - createReaction(workspaceSlug, projectId, issueId, reaction): POST via the service; appends to the
 *   (issueId, reactionKey) bucket, inserts the entity into the flat map, and refreshes the activity feed
 *   so the new reaction appears in the work item timeline.
 * - removeReaction(workspaceSlug, projectId, issueId, reaction, userId): finds the current user's reaction
 *   under that key, optimistically removes it from both maps, then DELETE via the service. The activity
 *   feed is refreshed regardless of success.
 *
 * Helper queries: getReactionsByIssueId, getReactionById, reactionsByUser (filters the grouped bucket by
 * `actor === userId` so the UI can answer "does this user have an X reaction here?").
 *
 * Service: backed by IssueReactionService constructed with the parent IssueDetail's `serviceType` so the
 * same implementation serves both issues and epics.
 *
 * Consumers: reaction strip widgets under apps/web/core/components/issues/issue-detail/**,
 * apps/web/core/components/issues/issue-detail-widgets/** and apps/web/core/components/issues/peek-overview/**,
 * accessed via apps/web/core/hooks/store/use-issue-detail.ts.
 */

import { pull, find, concat, set, update } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// Plane Imports
import type { TIssueReaction, TIssueReactionMap, TIssueReactionIdMap, TIssueServiceType } from "@plane/types";
import { groupReactions } from "@plane/utils";
// services
import { IssueReactionService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export interface IIssueReactionStoreActions {
  // actions
  addReactions: (issueId: string, reactions: TIssueReaction[]) => void;
  fetchReactions: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssueReaction[]>;
  createReaction: (workspaceSlug: string, projectId: string, issueId: string, reaction: string) => Promise<any>;
  removeReaction: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    reaction: string,
    userId: string
  ) => Promise<any>;
}

export interface IIssueReactionStore extends IIssueReactionStoreActions {
  // observables
  reactions: TIssueReactionIdMap;
  reactionMap: TIssueReactionMap;
  // helper methods
  getReactionsByIssueId: (issueId: string) => { [reaction_id: string]: string[] } | undefined;
  getReactionById: (reactionId: string) => TIssueReaction | undefined;
  reactionsByUser: (issueId: string, userId: string) => TIssueReaction[];
}

export class IssueReactionStore implements IIssueReactionStore {
  // observables
  reactions: TIssueReactionIdMap = {};
  reactionMap: TIssueReactionMap = {};
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  issueReactionService;
  serviceType;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      reactions: observable,
      reactionMap: observable,
      // actions
      addReactions: action.bound,
      fetchReactions: action,
      createReaction: action,
      removeReaction: action,
    });
    this.serviceType = serviceType;
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.issueReactionService = new IssueReactionService(serviceType);
  }

  // helper methods
  getReactionsByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.reactions[issueId] ?? undefined;
  };

  getReactionById = (reactionId: string) => {
    if (!reactionId) return undefined;
    return this.reactionMap[reactionId] ?? undefined;
  };

  reactionsByUser = (issueId: string, userId: string) => {
    if (!issueId || !userId) return [];

    const reactions = this.getReactionsByIssueId(issueId);
    if (!reactions) return [];

    const _userReactions: TIssueReaction[] = [];
    Object.keys(reactions).forEach((reaction) => {
      if (reactions?.[reaction])
        reactions?.[reaction].map((reactionId) => {
          const currentReaction = this.getReactionById(reactionId);
          if (currentReaction && currentReaction.actor === userId) _userReactions.push(currentReaction);
        });
    });

    return _userReactions;
  };

  addReactions = (issueId: string, reactions: TIssueReaction[]) => {
    const groupedReactions = groupReactions(reactions || [], "reaction");

    const issueReactionIdsMap: { [reaction: string]: string[] } = {};

    Object.keys(groupedReactions).map((reactionId) => {
      const reactionIds = (groupedReactions[reactionId] || []).map((reaction) => reaction.id);
      issueReactionIdsMap[reactionId] = reactionIds;
    });

    runInAction(() => {
      set(this.reactions, issueId, issueReactionIdsMap);
      reactions.forEach((reaction) => set(this.reactionMap, reaction.id, reaction));
    });
  };

  // actions
  fetchReactions = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const response = await this.issueReactionService.listIssueReactions(workspaceSlug, projectId, issueId);
    this.addReactions(issueId, response);
    return response;
  };

  createReaction = async (workspaceSlug: string, projectId: string, issueId: string, reaction: string) => {
    const response = await this.issueReactionService.createIssueReaction(workspaceSlug, projectId, issueId, {
      reaction,
    });

    runInAction(() => {
      update(this.reactions, [issueId, reaction], (reactionId) => {
        if (!reactionId) return [response.id];
        return concat(reactionId, response.id);
      });
      set(this.reactionMap, response.id, response);
    });

    // fetching activity
    this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return response;
  };

  removeReaction = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    reaction: string,
    userId: string
  ) => {
    const userReactions = this.reactionsByUser(issueId, userId);
    const currentReaction = find(userReactions, { actor: userId, reaction: reaction });

    if (currentReaction && currentReaction.id) {
      runInAction(() => {
        pull(this.reactions[issueId][reaction], currentReaction.id);
        delete this.reactionMap[reaction];
      });
    }

    const response = await this.issueReactionService.deleteIssueReaction(workspaceSlug, projectId, issueId, reaction);

    // fetching activity
    this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return response;
  };
}
