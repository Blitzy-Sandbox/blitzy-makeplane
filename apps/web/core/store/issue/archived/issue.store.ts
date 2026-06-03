/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
/**
 * MobX store that owns the archived-issue list slice (`EIssuesStoreType.ARCHIVED`) for a project.
 * Extends `BaseIssuesStore` (from `../helpers/base-issues.store`) to inherit pagination, grouping,
 * sorting, optimistic mutation, and shared issue-cache integration, and specializes it for
 * archived-only reads plus the restore-from-archive lifecycle action.
 *
 * State slice (class-level observables):
 * - `issueFilterStore: IArchivedIssuesFilter` — injected filter-store companion (instantiated by
 *   `IssueRootStore`) used to derive filter + pagination request params for archived fetches.
 * - `viewFlags: ViewFlags = { enableQuickAdd: false, enableIssueCreation: false, enableInlineEditing: true }`
 *   — fixed UI capability flags: quick-add and issue creation are disabled (archived lists are
 *   read-only entry points), while inline editing remains enabled.
 *
 * Actions (registered via `makeObservable` as `action`):
 * - `fetchIssues(workspaceSlug, projectId, loadType = "init-loader", options, isExistingPaginationOptions?)`
 *   — sets the loader, clears the store (preserving stored pagination options when
 *   `isExistingPaginationOptions` is true), derives request params via
 *   `issueFilterStore.getFilterParams`, calls `issueArchiveService.getArchivedIssues` (inherited
 *   from `BaseIssuesStore`) with the abort-controller signal, and forwards the response to
 *   `onfetchIssues` for normalization and insertion into `rootIssueStore.issues.issuesMap`. The
 *   `isExistingPaginationOptions` parameter is not on the `IArchivedIssues` interface — it is the
 *   internal preservation switch used by `fetchIssuesWithExistingPagination`.
 * - `fetchNextIssues(workspaceSlug, projectId, groupId?, subGroupId?)` — paginated continuation;
 *   resolves the next cursor for the `(groupId, subGroupId)` bucket via `getNextCursor`, calls
 *   `issueArchiveService.getArchivedIssues` again, and forwards the result to `onfetchNexIssues`.
 *   No-ops when `paginationOptions` is undefined or when `nextPageResults` is false for the bucket.
 * - `fetchIssuesWithExistingPagination(workspaceSlug, projectId, loadType = "mutation")` — refetch
 *   entrypoint that re-runs `fetchIssues` with the stored `paginationOptions` and
 *   `isExistingPaginationOptions = true`; used by `filter.store.ts` after filter / display-filter
 *   mutations so the archived list reflects the new query.
 * - `restoreIssue(workspaceSlug, projectId, issueId)` — the archived-store-specific lifecycle
 *   action; calls `issueArchiveService.restoreIssue`, then atomically (a) patches the shared
 *   issue cache via `rootIssueStore.issues.updateIssue(issueId, { archived_at: null })` so
 *   non-archived views see the un-archived issue immediately and (b) removes the issue id from
 *   this store's archived list via the inherited `removeIssueFromList(issueId)`.
 *
 * Disabled mutations (explicit `= undefined` overrides):
 * - `updateIssue`, `archiveIssue`, `archiveBulkIssues`, `quickAddIssue` are set to `undefined` on
 *   the class (and re-declared as `undefined` on `IArchivedIssues`) to disable those mutations
 *   at the type level — UI quick-action menus rely on this contract to gate unsupported actions
 *   on archived issues.
 *
 * Inherited / overridden behavior:
 * - `fetchParentStats(workspaceSlug, projectId?)` — overrides the parent-stat refresh hook from
 *   `BaseIssuesStore` to refresh project details via
 *   `rootIssueStore.rootStore.projectRoot.project.fetchProjectDetails`.
 * - `updateParentStats()` — explicit no-op; restoring an issue from archive does not update any
 *   aggregate parent-entity counts (cycle/module).
 * - The constructor passes `true` as the third positional argument to
 *   `super(_rootStore, issueFilterStore, true)` — the `BaseIssuesStore` "is archived" wiring
 *   flag that routes inherited fetches through the archived endpoint surface.
 *
 * Cross-store dependencies:
 * - Reads/writes the shared issue cache at `apps/web/core/store/issue/issue.store.ts` via
 *   `rootIssueStore.issues.updateIssue` so a restored issue is reflected in every sibling view
 *   the moment restore completes.
 *
 * Consumers:
 * - `apps/web/core/components/issues/peek-overview/root.tsx` and `header.tsx` — read via
 *   `useIssues(EIssuesStoreType.ARCHIVED)` for the archived-issue peek surface.
 * - `apps/web/core/components/issues/issue-detail/root.tsx` — reads via
 *   `useIssues(EIssuesStoreType.ARCHIVED)` when an archived issue is being displayed.
 * - `apps/web/core/components/issues/issue-detail/issue-detail-quick-actions.tsx` — invokes
 *   `restoreIssue` from the quick-actions menu.
 * - `apps/web/core/components/issues/issue-layouts/roots/archived-issue-layout-root.tsx` — mounts
 *   `IssuesStoreContext.Provider value={EIssuesStoreType.ARCHIVED}` and binds this store to the
 *   archived layout root.
 * - `apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/archived-issue.tsx` —
 *   per-row archived-issue quick actions (including `restoreIssue`).
 * - `apps/web/core/components/issues/issue-layouts/empty-states/archived-issues.tsx` —
 *   empty-state rendering for the archived list.
 * - Composed into `apps/web/core/store/issue/root.store.ts` as `archivedIssues: IArchivedIssues`,
 *   wired alongside the `archivedIssuesFilter` companion (`ArchivedIssuesFilter` from
 *   `./filter.store`).
 */

import { action, makeObservable, runInAction } from "mobx";
// base class
import type { TLoader, IssuePaginationOptions, TIssuesResponse, ViewFlags, TBulkOperationsPayload } from "@plane/types";
// services
// types
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IArchivedIssuesFilter } from "./filter.store";

export interface IArchivedIssues extends IBaseIssuesStore {
  // observable
  viewFlags: ViewFlags;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    option: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    projectId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  restoreIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;

  updateIssue: undefined;
  archiveIssue: undefined;
  archiveBulkIssues: undefined;
  quickAddIssue: undefined;
}

export class ArchivedIssues extends BaseIssuesStore implements IArchivedIssues {
  // filter store
  issueFilterStore: IArchivedIssuesFilter;

  //viewData
  viewFlags = {
    enableQuickAdd: false,
    enableIssueCreation: false,
    enableInlineEditing: true,
  };

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IArchivedIssuesFilter) {
    super(_rootStore, issueFilterStore, true);
    makeObservable(this, {
      // action
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,

      restoreIssue: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
  }

  /**
   * Fetches the project details
   * @param workspaceSlug
   * @param projectId
   */
  fetchParentStats = async (workspaceSlug: string, projectId?: string) => {
    projectId && this.rootIssueStore.rootStore.projectRoot.project.fetchProjectDetails(workspaceSlug, projectId);
  };

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
    loadType: TLoader = "init-loader",
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    try {
      // set loader and clear store
      runInAction(() => {
        this.setLoader(loadType);
      });
      this.clear(!isExistingPaginationOptions);

      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueArchiveService.getArchivedIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
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
  fetchNextIssues = async (workspaceSlug: string, projectId: string, groupId?: string, subGroupId?: string) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    // if there are no pagination options and the next page results do not exist the return
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;
    try {
      // set Loader
      this.setLoader("pagination", groupId, subGroupId);

      // get params from stored pagination options
      const params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        projectId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      // call the fetch issues API with the params for next page in issues
      const response = await this.issueArchiveService.getArchivedIssues(workspaceSlug, projectId, params);

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
    loadType: TLoader = "mutation"
  ) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
  };

  /**
   * Restored the current issue from the archived issue
   * @param workspaceSlug
   * @param projectId
   * @param issueId
   * @returns
   */
  restoreIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    // call API to restore the issue
    const response = await this.issueArchiveService.restoreIssue(workspaceSlug, projectId, issueId);

    // update the store and remove from the archived issues list once restored
    runInAction(() => {
      this.rootIssueStore.issues.updateIssue(issueId, {
        archived_at: null,
      });
      this.removeIssueFromList(issueId);
    });

    return response;
  };

  // Setting them as undefined as they can not performed on Archived issues
  updateIssue = undefined;
  archiveIssue = undefined;
  archiveBulkIssues = undefined;
  quickAddIssue = undefined;
}
