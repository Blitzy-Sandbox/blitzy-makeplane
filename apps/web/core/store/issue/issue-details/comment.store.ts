/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for issue comments — normalized per-issue comment-id lists plus a comment-by-id cache used by
 * the issue-detail comment panel. Hydrates the sibling comment-reaction store from comment payloads to avoid
 * a second round-trip when comments load.
 *
 * State slice:
 * - loader: TCommentLoader — current loader state ("fetch" | "create" | "update" | "delete" | "mutate" | undefined)
 * - comments: TIssueCommentIdMap — per-issue ordered lists of comment ids
 * - commentMap: TIssueCommentMap — normalized cache of comment entities keyed by comment id
 *
 * Actions:
 * - fetchComments(workspaceSlug, projectId, issueId, loaderType?): incremental fetch — when the per-issue list
 *   already has entries, only comments with `created_at > latestCachedComment.created_at` are requested. After
 *   the response, `commentReaction.applyCommentReactions` is invoked for each comment so reactions hydrate
 *   without a separate fetch.
 * - createComment(workspaceSlug, projectId, issueId, data): POST via IssueCommentService.createIssueComment;
 *   appends the new id to the per-issue list and inserts the new comment into the map.
 * - updateComment(workspaceSlug, projectId, issueId, commentId, data): OPTIMISTIC — the local commentMap is
 *   mutated first, then PATCH via IssueCommentService.patchIssueComment; the `updated_at` and `edited_at`
 *   fields from the response are reconciled back into the cache. On failure, the activity feed is refreshed
 *   so the user sees the canonical server state (no rollback is attempted because the previous values were
 *   not snapshotted).
 * - removeComment(workspaceSlug, projectId, issueId, commentId): DELETE via the service; pulls the id from
 *   the per-issue list and deletes the entry from commentMap.
 *
 * Helper queries: getCommentsByIssueId, getCommentById.
 *
 * Service: backed by IssueCommentService which is constructed with the parent IssueDetail's `serviceType`
 * (EIssueServiceType.ISSUES | EPICS), so the same store powers both work items and epics.
 *
 * Consumers: comment widgets under apps/web/core/components/issues/issue-detail/**,
 * apps/web/core/components/issues/issue-detail-widgets/** and apps/web/core/components/issues/peek-overview/**,
 * accessed via apps/web/core/hooks/store/use-issue-detail.ts. The sibling `commentReaction` store is also a
 * consumer in that it is hydrated by this store on every fetchComments call.
 */

import { pull, concat, update, uniq, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// Plane Imports
import type { TIssueComment, TIssueCommentMap, TIssueCommentIdMap, TIssueServiceType } from "@plane/types";
// services
import { IssueCommentService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export type TCommentLoader = "fetch" | "create" | "update" | "delete" | "mutate" | undefined;

export interface IIssueCommentStoreActions {
  fetchComments: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType?: TCommentLoader
  ) => Promise<TIssueComment[]>;
  createComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  updateComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  removeComment: (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => Promise<any>;
}

export interface IIssueCommentStore extends IIssueCommentStoreActions {
  // observables
  loader: TCommentLoader;
  comments: TIssueCommentIdMap;
  commentMap: TIssueCommentMap;
  // helper methods
  getCommentsByIssueId: (issueId: string) => string[] | undefined;
  getCommentById: (activityId: string) => TIssueComment | undefined;
}

export class IssueCommentStore implements IIssueCommentStore {
  // observables
  loader: TCommentLoader = "fetch";
  comments: TIssueCommentIdMap = {};
  commentMap: TIssueCommentMap = {};
  serviceType;
  // root store
  rootIssueDetail: IIssueDetail;
  // services
  issueCommentService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      comments: observable,
      commentMap: observable,
      // actions
      fetchComments: action,
      createComment: action,
      updateComment: action,
      removeComment: action,
    });
    // root store
    this.serviceType = serviceType;
    this.rootIssueDetail = rootStore;
    // services
    this.issueCommentService = new IssueCommentService(serviceType);
  }

  // helper methods
  getCommentsByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.comments[issueId] ?? undefined;
  };

  getCommentById = (commentId: string) => {
    if (!commentId) return undefined;
    return this.commentMap[commentId] ?? undefined;
  };

  fetchComments = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType: TCommentLoader = "fetch"
  ) => {
    this.loader = loaderType;

    let props = {};
    const _commentIds = this.getCommentsByIssueId(issueId);
    if (_commentIds && _commentIds.length > 0) {
      const _comment = this.getCommentById(_commentIds[_commentIds.length - 1]);
      if (_comment) props = { created_at__gt: _comment.created_at };
    }

    const comments = await this.issueCommentService.getIssueComments(workspaceSlug, projectId, issueId, props);

    const commentIds = comments.map((comment) => comment.id);
    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return commentIds;
        return uniq(concat(_commentIds, commentIds));
      });
      comments.forEach((comment) => {
        this.rootIssueDetail.commentReaction.applyCommentReactions(comment.id, comment?.comment_reactions || []);
        set(this.commentMap, comment.id, comment);
      });
      this.loader = undefined;
    });

    return comments;
  };

  createComment = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueComment>) => {
    const response = await this.issueCommentService.createIssueComment(workspaceSlug, projectId, issueId, data);

    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return [response.id];
        return uniq(concat(_commentIds, [response.id]));
      });
      set(this.commentMap, response.id, response);
    });

    return response;
  };

  updateComment = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => {
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          set(this.commentMap, [commentId, key], data[key as keyof TIssueComment]);
        });
      });

      const response = await this.issueCommentService.patchIssueComment(
        workspaceSlug,
        projectId,
        issueId,
        commentId,
        data
      );

      runInAction(() => {
        set(this.commentMap, [commentId, "updated_at"], response.updated_at);
        set(this.commentMap, [commentId, "edited_at"], response.edited_at);
      });

      return response;
    } catch (error) {
      this.rootIssueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
      throw error;
    }
  };

  removeComment = async (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => {
    const response = await this.issueCommentService.deleteIssueComment(workspaceSlug, projectId, issueId, commentId);

    runInAction(() => {
      pull(this.comments[issueId], commentId);
      delete this.commentMap[commentId];
    });

    return response;
  };
}
