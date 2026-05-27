/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX issue store for Plane's custom Project Views — the `EIssuesStoreType.PROJECT_VIEW`
 * adapter atop the shared `BaseIssuesStore`. Owns view-scoped issue fetching and cursor
 * pagination for the saved-view layout, and re-exposes inherited base mutations under the
 * public method names declared on `IProjectViewIssues`.
 *
 * Inheritance:
 *   - extends `BaseIssuesStore` (../helpers/base-issues.store) — inherits the underlying
 *     issue cache, grouping / sorting / pagination machinery, loader state, abort
 *     `controller`, optimistic mutation helpers, and the `onfetchIssues` /
 *     `onfetchNexIssues` response processors. The constructor calls
 *     `super(_rootStore, issueFilterStore)`.
 *   - implements `IProjectViewIssues extends IBaseIssuesStore`.
 *
 * State slice (own — see `BaseIssuesStore` for inherited observables such as the cached
 * `groupedIssueIds`, `groupedIssueCount`, `paginationOptions`, `controller`, and loader
 * maps):
 *   - viewFlags: ViewFlags
 *       `{ enableQuickAdd: true, enableIssueCreation: true, enableInlineEditing: true }` —
 *       UI capability switches read by the issue-layout components. All three are enabled
 *       for project views (quick-add row, plus-button issue creation, and inline-field
 *       editing are all permitted), which is what distinguishes this store from read-only
 *       contexts such as `archived`.
 *   - issueFilterStore: IProjectViewIssuesFilter
 *       Sibling filter store used to derive backend query parameters from the active
 *       saved-view filter snapshot via `getFilterParams`. Captured in the constructor and
 *       also threaded through `super()` for base-class use.
 *
 * Actions (registered on `makeObservable` as `action`):
 *   - fetchIssues(workspaceSlug, projectId, viewId, loadType, options, isExistingPaginationOptions=false)
 *       Fetches the first page of issues for `viewId`. Sets the loader, clears the local
 *       issue collection unless `isExistingPaginationOptions` is true, derives params via
 *       `issueFilterStore.getFilterParams(options, viewId, undefined, undefined, undefined)`,
 *       calls `issueService.getIssues(workspaceSlug, projectId, params, { signal: this.controller.signal })`,
 *       and forwards the response through the inherited `onfetchIssues` so grouping and
 *       pagination metadata are committed. On error, resets the loader and rethrows.
 *   - fetchNextIssues(workspaceSlug, projectId, viewId, groupId?, subGroupId?)
 *       Advances cursor-based pagination using the stored `paginationOptions`. When
 *       `groupId` / `subGroupId` are supplied, only that group / subgroup's cursor
 *       advances; otherwise all top-level groups advance. Returns early when
 *       `paginationOptions` is unset or the group's cursor reports
 *       `nextPageResults === false`. Forwards the response through `onfetchNexIssues`.
 *   - fetchIssuesWithExistingPagination(workspaceSlug, projectId, viewId, loadType)
 *       Re-runs `fetchIssues` for the first page using the current `paginationOptions` and
 *       `isExistingPaginationOptions=true`. This is the contract that lets the view refresh
 *       on filter / groupBy / orderBy changes without losing pagination context or
 *       flickering during the swap.
 *   - fetchParentStats = async () => {} / updateParentStats = () => {}
 *       No-op overrides of the base contract. Project views have no parent aggregate to
 *       update (unlike cycle or module views which roll up into a parent entity), so the
 *       hooks are satisfied without work.
 *
 * Inherited mutation aliases (per the inline note "Using aliased names as they cannot be
 * overridden in other stores" — these are alias bindings onto the public surface declared
 * by `IProjectViewIssues`, NOT overrides; they do not change behavior):
 *   - archiveBulkIssues = this.bulkArchiveIssues
 *   - quickAddIssue     = this.issueQuickAdd
 *   - updateIssue       = this.issueUpdate
 *   - archiveIssue      = this.issueArchive
 *   `createIssue`, `removeBulkIssues`, and `bulkUpdateProperties` are inherited from
 *   `BaseIssuesStore` directly under their interface names — they are not aliased here
 *   because the interface name already matches the base implementation name.
 *
 * Consumers:
 *   - apps/web/core/store/issue/root.store.ts — composes this store as `projectViewIssues`,
 *     paired with its filter store, alongside the other per-scope issue stores
 *   - apps/web/core/components/issues/issue-layouts/roots/project-view-layout-root.tsx —
 *     primary mounting point; provides `EIssuesStoreType.PROJECT_VIEW` to
 *     `IssuesStoreContext` so the issue-layout subtree resolves this store
 *   - apps/web/core/components/issues/issue-layouts/{kanban,list,calendar,gantt,spreadsheet,roots}/**
 *     when invoked under the project-view context
 *   - apps/web/core/components/issues/issue-layouts/empty-states/project-view.tsx —
 *     empty-state UI gated on this store's load state
 *   - Accessed by all of the above through the `useIssues(EIssuesStoreType.PROJECT_VIEW)`
 *     hook in apps/web/core/hooks/store/use-issues.ts
 */

import { action, makeObservable, runInAction } from "mobx";
// base class
import type {
  TIssue,
  TLoader,
  ViewFlags,
  IssuePaginationOptions,
  TIssuesResponse,
  TBulkOperationsPayload,
} from "@plane/types";
// services
// types
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IProjectViewIssuesFilter } from "./filter.store";

export interface IProjectViewIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  quickAddIssue: (workspaceSlug: string, projectId: string, data: TIssue) => Promise<TIssue | undefined>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
}

export class ProjectViewIssues extends BaseIssuesStore implements IProjectViewIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  //filter store
  issueFilterStore: IProjectViewIssuesFilter;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IProjectViewIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      // action
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
    });
    //filter store
    this.issueFilterStore = issueFilterStore;
  }

  fetchParentStats = async () => {};

  /** */
  updateParentStats = () => {};

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param projectId
   * @param loadType
   * @param options
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    try {
      // set loader and clear store
      runInAction(() => {
        this.setLoader(loadType);
        this.clear(!isExistingPaginationOptions); // clear while fetching from server.
      });

      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, viewId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, projectId, viewId, !isExistingPaginationOptions);
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
   * @param projectId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    groupId?: string,
    subGroupId?: string
  ) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    // if there are no pagination options and the next page results do not exist the return
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;
    try {
      // set Loader
      this.setLoader("pagination", groupId, subGroupId);

      // get params from stored pagination options
      const params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        viewId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      // call the fetch issues API with the params for next page in issues
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params);

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
   * @param projectId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    loadType: TLoader
  ) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, projectId, viewId, loadType, this.paginationOptions, true);
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  quickAddIssue = this.issueQuickAdd;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
