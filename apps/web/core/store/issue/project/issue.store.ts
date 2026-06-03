/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store managing the project issue list — the base project view's source of truth for paginated issue
 * fetching, optimistic mutations, and route-aware list updates. Extends the shared `BaseIssuesStore` engine
 * (from `../helpers/base-issues.store`) with project-specific wiring; implements `IProjectIssues`, which extends
 * `IBaseIssuesStore`. The base class supplies the issue-list engine; this subclass overrides fetching,
 * creation, the parent-stat refresh hook, and the abstract members.
 *
 * View flags (capability gates that distinguish project lists from specialized stores such as archived):
 *   - `enableQuickAdd: true` — project lists allow the inline quick-add row.
 *   - `enableIssueCreation: true` — project lists allow opening the full create-issue modal.
 *   - `enableInlineEditing: true` — project lists allow inline property edits.
 *
 * State slice (only the project-specific additions are called out; observable plumbing comes from the base):
 *   - `viewFlags: ViewFlags` — the boolean trio above; capability gates consumed by layout components.
 *   - `router` — captured from `_rootStore.rootStore.router`; used by `createIssue` to gate list mutations
 *     to only fire when the user is currently viewing this project's route.
 *   - `issueFilterStore: IProjectIssuesFilter` — companion filter store; consulted for `getFilterParams`
 *     when building fetch query strings.
 *   - Inherited from `BaseIssuesStore`: `groupedIssueIds`, `groupedIssueCount`, `issuePaginationData`,
 *     `paginationOptions`, `loader`, the issue-list cache, and the `AbortController` (`this.controller`)
 *     used to cancel in-flight requests on navigation.
 *
 * Actions (registered as `action` in `makeObservable`):
 *   - `fetchIssues(workspaceSlug, projectId, loadType="init-loader", options, isExistingPaginationOptions=false)`
 *     — initial paginated load. Sets the loader, clears the local cache when starting fresh, derives query
 *     params from `issueFilterStore.getFilterParams(...)`, calls `issueService.getIssues` with
 *     `controller.signal` for abort support, and routes the response into the inherited `onfetchIssues` for
 *     grouping/sorting/pagination bookkeeping. Re-throws on error after clearing the loader.
 *   - `fetchNextIssues(workspaceSlug, projectId, groupId?, subGroupId?)` — cursor-based pagination for the
 *     next page. Bails when no `paginationOptions` are stored or when the cursor reports no next page.
 *     Uses `getNextCursor(groupId, subGroupId)` and delegates merging to `onfetchNexIssues`.
 *   - `fetchIssuesWithExistingPagination(workspaceSlug, projectId, loadType="mutation")` — refresh helper
 *     that re-fetches the first page using the currently stored `paginationOptions`, preserving the user's
 *     pagination context. Invoked by `ProjectIssuesFilter` from `updateFilterExpression` / `updateFilters`
 *     when display filters require a server refetch.
 *   - `quickAddIssue` — aliased to the inherited `issueQuickAdd` to satisfy `IProjectIssues`; declared as
 *     `action` so its mutation is observable.
 *
 * Project-specific overrides (not in `makeObservable` but part of the store's contract):
 *   - `fetchParentStats(workspaceSlug, projectId?)` — implements the abstract from `BaseIssuesStore`;
 *     refreshes `projectRoot.project.fetchProjectDetails` so project counters stay in sync after mutations.
 *   - `updateParentStats()` — intentional no-op; project lists have no parent counters beyond
 *     `fetchProjectDetails`, which is invoked from `fetchParentStats`.
 *   - `createIssue(workspaceSlug, projectId, data)` — overrides the base by calling
 *     `super.createIssue(..., "", projectId === this.router.projectId)`. The `shouldUpdateList` flag is
 *     `true` ONLY when the router's active project matches the target, preventing list mutations when the
 *     user creates an issue in a non-current project (e.g., from a cross-project picker).
 *   - Method aliases at the end of the class (`archiveBulkIssues`, `quickAddIssue`, `updateIssue`,
 *     `archiveIssue`) are not new logic — they resurface inherited base methods under the names mandated by
 *     `IProjectIssues` because a TypeScript class cannot satisfy an interface via inherited method names
 *     alone. Do not refactor these out.
 *
 * Async services consumed (inherited from `BaseIssuesStore`): `IssueService` (`getIssues`, `createIssue`,
 * `patchIssue`, `archiveIssue`, `bulkArchiveIssues`, etc.) and `IssueArchiveService` for archive/restore.
 * Network requests use `this.controller.signal` so route changes cancel pending work.
 *
 * Consumers (the most exercised issue store in the codebase):
 *   - Layout root: `apps/web/core/components/issues/issue-layouts/roots/project-layout-root.tsx`.
 *   - Layouts: `issue-layouts/{list,kanban,spreadsheet,calendar,gantt}/**`.
 *   - Empty / quick-add / properties: `issue-layouts/empty-states/project-issues.tsx`,
 *     `issue-layouts/quick-add/**`, `issue-layouts/properties/**`.
 *   - Bulk operations, full create modal, and peek overview:
 *     `issues/bulk-operations/**`, `issues/issue-modal/**`, `issues/peek-overview/**`.
 *   - Cross-store reactive consumer: the companion `ProjectIssuesFilter` (this folder) calls
 *     `this.rootIssueStore.projectIssues.clear(true)` and `fetchIssuesWithExistingPagination(...)` from
 *     inside its `updateFilterExpression` / `updateFilters` actions when display filters require a refetch.
 *   - Composition: instantiated in `apps/web/core/store/issue/root.store.ts` as
 *     `projectIssues = new ProjectIssues(this, this.projectIssuesFilter)`.
 *   - Hook access: components read via `useIssues(EIssuesStoreType.PROJECT)`
 *     (`apps/web/core/hooks/store/use-issues.ts`).
 *
 * Architectural note: this store is the single source of truth for project issue-list behavior; consumer
 * components read state directly via MobX `observer` HOCs and never hold local copies. All mutations flow
 * through the actions above — there is no `setState`-style escape hatch.
 */

import { action, makeObservable, runInAction } from "mobx";
// types
import type {
  TIssue,
  TLoader,
  ViewFlags,
  IssuePaginationOptions,
  TIssuesResponse,
  TBulkOperationsPayload,
} from "@plane/types";
// helpers
// base class
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
// services
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";

export interface IProjectIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  // action
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

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  quickAddIssue: (workspaceSlug: string, projectId: string, data: TIssue) => Promise<TIssue | undefined>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  router;

  // filter store
  issueFilterStore: IProjectIssuesFilter;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IProjectIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,

      quickAddIssue: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
    this.router = _rootStore.rootStore.router;
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
        this.clear(!isExistingPaginationOptions); // clear while fetching from server.
      });

      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
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
    loadType: TLoader = "mutation"
  ) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
  };

  /**
   * Override inherited create issue, to update list only if user is on current project
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns
   */
  override createIssue = async (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => {
    const response = await super.createIssue(workspaceSlug, projectId, data, "", projectId === this.router.projectId);
    return response;
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  quickAddIssue = this.issueQuickAdd;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
