/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Profile-scoped MobX issue list store that backs the `/profile/[userId]` views;
 * extends `BaseIssuesStore` (`../helpers/base-issues.store`) and specializes
 * issue fetching for the active profile-view discriminant
 * (`"assigned"` | `"created"` | `"subscribed"`). Inherits generic list
 * management — pagination state, abort controller, normalization hooks
 * (`onfetchIssues`, `onfetchNexIssues`), and bulk operations
 * (`bulkArchiveIssues`, `issueUpdate`, `issueArchive`) — and routes its
 * server reads through `UserService.getUserProfileIssues`.
 *
 * State slice:
 *   - currentView (observable.ref): TProfileViews — defaults to "assigned";
 *       acts as the discriminant for which profile list (assigned / created /
 *       subscribed) is hydrated.
 *   - issueFilterStore: IProfileIssuesFilter — paired filter store from
 *       `./filter.store`, used to derive query params via `getFilterParams`.
 *   - userService: UserService — issues the workspace-scoped profile-issues
 *       HTTP call (`getUserProfileIssues`).
 *   - inherited from BaseIssuesStore: pagination data, controller abort
 *       signal, loader flags, grouped/sub-grouped issue maps (not enumerated).
 *
 * Computed:
 *   - viewFlags (computed): derives `{ enableQuickAdd, enableIssueCreation,
 *       enableInlineEditing }` from `currentView`. Subscribed views disable
 *       issue creation (`enableIssueCreation: false`); assigned and created
 *       views enable it. Quick add is universally disabled across all profile
 *       views (`enableQuickAdd: false`); inline editing is universally enabled
 *       (`enableInlineEditing: true`). Recomputes when `currentView` changes.
 *
 * Actions:
 *   - setViewId(viewId) (action.bound): assigns `currentView`; no async or
 *       external side effects.
 *   - fetchIssues(workspaceSlug, userId, loadType, options, view,
 *       isExistingPaginationOptions?) (action): first-page fetch. Sets the
 *       loader, clears state (clear-on-fresh-load), calls `setViewId(view)`,
 *       derives params via `issueFilterStore.getFilterParams`, narrows by view
 *       (`assignees`/`created_by`/`subscriber` = `userId`), and calls
 *       `userService.getUserProfileIssues` with the abort signal. Delegates
 *       response normalization to inherited `onfetchIssues`.
 *   - fetchNextIssues(workspaceSlug, userId, groupId?, subGroupId?) (action):
 *       cursor-based subsequent-page fetch using stored `paginationOptions`
 *       and `getPaginationData(groupId, subGroupId)`; applies the same view
 *       narrowing rules; delegates to inherited `onfetchNexIssues`. Early
 *       returns when no `paginationOptions` exist or the next page is
 *       exhausted.
 *   - fetchIssuesWithExistingPagination(workspaceSlug, userId, loadType)
 *       (action): refetches page 1 with stored `paginationOptions` and the
 *       current `currentView`; called by the paired filter store after filter
 *       mutations to refresh results without changing the view discriminant.
 *
 * Aliased / disabled members:
 *   - archiveBulkIssues = bulkArchiveIssues; updateIssue = issueUpdate;
 *     archiveIssue = issueArchive — aliases over inherited mutations; bulk
 *     archive, inline update, and archive are allowed on profile views.
 *   - quickAddIssue = undefined — quick add is explicitly unsupported on
 *     profile views (matches `viewFlags.enableQuickAdd: false`).
 *   - fetchParentStats / updateParentStats — no-ops; profile lists have no
 *     parent-entity stat aggregation (no parent cycle/module/project to roll
 *     up into).
 *
 * Side effects:
 *   - Network: GET via `userService.getUserProfileIssues` (workspace-scoped
 *     profile-issues endpoint).
 *   - Observable mutations on `currentView` plus all inherited pagination /
 *     loader / grouped-issue mutations from `BaseIssuesStore`.
 *   - No direct local-storage writes (those live in the paired filter store).
 *   - No navigation triggers.
 *
 * Consumers (read via `useIssues(EIssuesStoreType.PROFILE)`):
 *   - apps/web/core/components/profile/profile-issues.tsx — renders the
 *       profile issue list/kanban.
 *   - apps/web/core/components/profile/profile-issues-filter.tsx — reads
 *       view flags + currentView for the filter UI.
 *   - apps/web/core/hooks/use-issues-actions.tsx — issue action dispatch
 *       for profile views (PROFILE discriminant).
 *   - apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/mobile-header.tsx
 *       — mobile filter/header.
 *   - apps/web/core/components/issues/issue-layouts/{list, kanban,
 *       empty-states} — consume via the `EIssuesStoreType.PROFILE`
 *       discriminant.
 *   - Composed in apps/web/core/store/issue/root.store.ts as
 *     `rootIssueStore.profileIssues`.
 */

import { action, observable, makeObservable, computed, runInAction } from "mobx";
// base class
import type {
  TIssue,
  TLoader,
  IssuePaginationOptions,
  TIssuesResponse,
  ViewFlags,
  TBulkOperationsPayload,
  TProfileViews,
} from "@plane/types";
import { UserService } from "@/services/user.service";

// services
// types
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IProfileIssuesFilter } from "./filter.store";

export interface IProfileIssues extends IBaseIssuesStore {
  // observable
  currentView: TProfileViews;
  viewFlags: ViewFlags;
  // actions
  setViewId: (viewId: TProfileViews) => void;
  // action
  fetchIssues: (
    workspaceSlug: string,
    userId: string,
    loadType: TLoader,
    option: IssuePaginationOptions,
    view: TProfileViews,
    isExistingPaginationOptions?: boolean
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    userId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    userId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;

  quickAddIssue: undefined;
}

export class ProfileIssues extends BaseIssuesStore implements IProfileIssues {
  currentView: TProfileViews = "assigned";
  // filter store
  issueFilterStore: IProfileIssuesFilter;
  // services
  userService;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IProfileIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      // observable
      currentView: observable.ref,
      // computed
      viewFlags: computed,
      // action
      setViewId: action.bound,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
    // services
    this.userService = new UserService();
  }

  get viewFlags() {
    if (this.currentView === "subscribed")
      return {
        enableQuickAdd: false,
        enableIssueCreation: false,
        enableInlineEditing: true,
      };
    return {
      enableQuickAdd: false,
      enableIssueCreation: true,
      enableInlineEditing: true,
    };
  }

  setViewId(viewId: TProfileViews) {
    this.currentView = viewId;
  }

  fetchParentStats = () => {};

  /** */
  updateParentStats = () => {};

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param userId
   * @param loadType
   * @param options
   * @param view
   * @returns
   */
  fetchIssues: IProfileIssues["fetchIssues"] = async (
    workspaceSlug: string,
    userId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    view: TProfileViews,
    isExistingPaginationOptions: boolean = false
  ) => {
    try {
      // set loader and clear store
      runInAction(() => {
        this.setLoader(loadType);
      });
      this.clear(!isExistingPaginationOptions);

      // set ViewId
      this.setViewId(view);

      // get params from pagination options
      let params = this.issueFilterStore?.getFilterParams(options, userId, undefined, undefined, undefined);
      params = {
        ...params,
        assignees: undefined,
        created_by: undefined,
        subscriber: undefined,
      };
      // modify params based on view
      if (this.currentView === "assigned") params = { ...params, assignees: userId };
      else if (this.currentView === "created") params = { ...params, created_by: userId };
      else if (this.currentView === "subscribed") params = { ...params, subscriber: userId };

      // call the fetch issues API with the params
      const response = await this.userService.getUserProfileIssues(workspaceSlug, userId, params, {
        signal: this.controller.signal,
      });

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, undefined, undefined, !isExistingPaginationOptions);
      return response;
    } catch (error) {
      // set loader to undefined if errored out
      this.setLoader(undefined);
      throw error;
    }
  };

  /**
   * This method is called subsequent pages of pagination
   * if groupId/subgroupId is provided, only that specific group's next page is fetched
   * else all the groups' next page is fetched
   * @param workspaceSlug
   * @param userId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (workspaceSlug: string, userId: string, groupId?: string, subGroupId?: string) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    // if there are no pagination options and the next page results do not exist the return
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;
    try {
      // set Loader
      this.setLoader("pagination", groupId, subGroupId);

      // get params from stored pagination options
      let params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        userId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      params = {
        ...params,
        assignees: undefined,
        created_by: undefined,
        subscriber: undefined,
      };
      if (this.currentView === "assigned") params = { ...params, assignees: userId };
      else if (this.currentView === "created") params = { ...params, created_by: userId };
      else if (this.currentView === "subscribed") params = { ...params, subscriber: userId };

      // call the fetch issues API with the params for next page in issues
      const response = await this.userService.getUserProfileIssues(workspaceSlug, userId, params);

      // after the next page of issues are fetched, call the base method to process the response
      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      // set Loader as undefined if errored out
      this.setLoader(undefined, groupId, subGroupId);
      throw error;
    }
  };

  /**
   * This Method exists to fetch the first page of the issues with the existing stored pagination
   * This is useful for refetching when filters, groupBy, orderBy etc changes
   * @param workspaceSlug
   * @param userId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (workspaceSlug: string, userId: string, loadType: TLoader) => {
    if (!this.paginationOptions || !this.currentView) return;
    return await this.fetchIssues(workspaceSlug, userId, loadType, this.paginationOptions, this.currentView, true);
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;

  // Setting them as undefined as they can not performed on profile issues
  quickAddIssue = undefined;
}
