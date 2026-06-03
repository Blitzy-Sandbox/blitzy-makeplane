/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for issue external links — per-issue link-id lists plus a normalized link-by-id cache used by
 * the link widget on the issue-detail page.
 *
 * State slice:
 * - links: TIssueLinkIdMap — per-issue ordered lists of link ids
 * - linkMap: TIssueLinkMap — normalized cache of link entities keyed by link id
 *
 * Actions:
 * - addLinks(issueId, links): replaces the per-issue id list and merges entities into linkMap.
 * - fetchLinks(workspaceSlug, projectId, issueId): GET via IssueService.fetchIssueLinks and hydrates the cache.
 * - createLink(workspaceSlug, projectId, issueId, data): POST via IssueService.createIssueLink; appends the
 *   new id, inserts the entity, increments the parent issue's `link_count` in `rootIssueStore.issues`, and
 *   triggers an activity refresh.
 * - updateLink(workspaceSlug, projectId, issueId, linkId, data): OPTIMISTIC — snapshots the current entity,
 *   mutates the local linkMap immediately, then PATCH via IssueService.updateIssueLink. On failure the
 *   snapshotted fields are restored and the error is rethrown.
 * - removeLink(workspaceSlug, projectId, issueId, linkId): DELETE via IssueService.deleteIssueLink; removes
 *   the id from the per-issue list, deletes the linkMap entry, decrements the parent issue's `link_count` in
 *   `rootIssueStore.issues`, and refreshes the activity feed.
 *
 * Computed:
 * - issueLinks: link ids for the currently-peeked issue, recomputes when `peekIssue.issueId` or the per-issue
 *   list changes.
 *
 * Helper queries: getLinksByIssueId, getLinkById.
 *
 * Service: backed by IssueService constructed with the parent IssueDetail's `serviceType` so the same
 * implementation serves both issues and epics.
 *
 * Consumers: link widgets under apps/web/core/components/issues/issue-detail/**,
 * apps/web/core/components/issues/issue-detail-widgets/** and apps/web/core/components/issues/peek-overview/**,
 * accessed via apps/web/core/hooks/store/use-issue-detail.ts.
 *
 * Note on dual storage: the link count is denormalized onto the parent issue's `link_count` in
 * `rootIssueStore.issues` so list/board layouts do not need to read this detail store on every render.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// services
import type { TIssueLink, TIssueLinkMap, TIssueLinkIdMap, TIssueServiceType } from "@plane/types";
import { IssueService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export interface IIssueLinkStoreActions {
  addLinks: (issueId: string, links: TIssueLink[]) => void;
  fetchLinks: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssueLink[]>;
  createLink: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueLink>
  ) => Promise<TIssueLink>;
  updateLink: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    linkId: string,
    data: Partial<TIssueLink>
  ) => Promise<TIssueLink>;
  removeLink: (workspaceSlug: string, projectId: string, issueId: string, linkId: string) => Promise<void>;
}

export interface IIssueLinkStore extends IIssueLinkStoreActions {
  // observables
  links: TIssueLinkIdMap;
  linkMap: TIssueLinkMap;
  // computed
  issueLinks: string[] | undefined;
  // helper methods
  getLinksByIssueId: (issueId: string) => string[] | undefined;
  getLinkById: (linkId: string) => TIssueLink | undefined;
}

export class IssueLinkStore implements IIssueLinkStore {
  // observables
  links: TIssueLinkIdMap = {};
  linkMap: TIssueLinkMap = {};
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  issueService;
  serviceType;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      links: observable,
      linkMap: observable,
      // computed
      issueLinks: computed,
      // actions
      addLinks: action.bound,
      fetchLinks: action,
      createLink: action,
      updateLink: action,
      removeLink: action,
    });
    this.serviceType = serviceType;
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.issueService = new IssueService(serviceType);
  }

  // computed
  get issueLinks() {
    const issueId = this.rootIssueDetailStore.peekIssue?.issueId;
    if (!issueId) return undefined;
    return this.links[issueId] ?? undefined;
  }

  // helper methods
  getLinksByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.links[issueId] ?? undefined;
  };

  getLinkById = (linkId: string) => {
    if (!linkId) return undefined;
    return this.linkMap[linkId] ?? undefined;
  };

  // actions
  addLinks = (issueId: string, links: TIssueLink[]) => {
    runInAction(() => {
      this.links[issueId] = links.map((link) => link.id);
      links.forEach((link) => set(this.linkMap, link.id, link));
    });
  };

  fetchLinks = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const response = await this.issueService.fetchIssueLinks(workspaceSlug, projectId, issueId);
    this.addLinks(issueId, response);
    return response;
  };

  createLink = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueLink>) => {
    const response = await this.issueService.createIssueLink(workspaceSlug, projectId, issueId, data);
    const issueLinkCount = this.getLinksByIssueId(issueId)?.length ?? 0;
    runInAction(() => {
      this.links[issueId].push(response.id);
      set(this.linkMap, response.id, response);
      this.rootIssueDetailStore.rootIssueStore.issues.updateIssue(issueId, {
        link_count: issueLinkCount + 1, // increment link count
      });
    });
    // fetching activity
    this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return response;
  };

  updateLink = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    linkId: string,
    data: Partial<TIssueLink>
  ) => {
    const initialData = { ...this.linkMap[linkId] };
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          set(this.linkMap, [linkId, key], data[key as keyof TIssueLink]);
        });
      });

      const response = await this.issueService.updateIssueLink(workspaceSlug, projectId, issueId, linkId, data);

      // fetching activity
      this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
      return response;
    } catch (error) {
      console.error("error", error);
      runInAction(() => {
        Object.keys(initialData).forEach((key) => {
          set(this.linkMap, [linkId, key], initialData[key as keyof TIssueLink]);
        });
      });
      throw error;
    }
  };

  removeLink = async (workspaceSlug: string, projectId: string, issueId: string, linkId: string) => {
    const issueLinkCount = this.getLinksByIssueId(issueId)?.length ?? 0;
    await this.issueService.deleteIssueLink(workspaceSlug, projectId, issueId, linkId);

    const linkIndex = this.links[issueId].findIndex((_comment) => _comment === linkId);
    if (linkIndex >= 0)
      runInAction(() => {
        this.links[issueId].splice(linkIndex, 1);
        delete this.linkMap[linkId];
        this.rootIssueDetailStore.rootIssueStore.issues.updateIssue(issueId, {
          link_count: issueLinkCount - 1, // decrement link count
        });
      });

    // fetching activity
    this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };
}
