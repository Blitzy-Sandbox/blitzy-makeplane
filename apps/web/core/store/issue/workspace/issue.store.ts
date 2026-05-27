/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace-scoped (cross-project) issue lists — the "all issues" /
 * global-view layouts that aggregate issues across every project in a workspace.
 *
 * Inheritance & override seam:
 *   `WorkspaceIssues` extends `BaseIssuesStore` (helpers/base-issues.store), inheriting
 *   pagination cursors, abort-signal wiring (`this.controller.signal`), loader management,
 *   response post-processing (`onfetchIssues`, `onfetchNexIssues`), and shared mutation
 *   helpers (`bulkArchiveIssues`, `issueUpdate`, `issueArchive`). The root store
 *   (`apps/web/core/store/issue/root.store.ts`) imports this class via the plane-web
 *   indirection `@/plane-web/store/issue/workspace/issue.store`, which in the CE tier
 *   (`apps/web/ce/store/issue/workspace/issue.store.ts`) is an `export *` passthrough —
 *   the indirection exists as the enterprise-edition override seam.
 *
 * State slice (this class adds; the base store contributes the rest):
 *   - `viewFlags: ViewFlags` — `enableQuickAdd`, `enableIssueCreation`, `enableInlineEditing`
 *     all `true`; controls which affordances the workspace issue layouts render.
 *   - `workspaceService` (WorkspaceService) and `issueFilterStore` (IWorkspaceIssuesFilter)
 *     — backend client and filter-state collaborator, both wired in the constructor.
 *   Inherited observables (`paginationOptions`, per-group cursors via `getPaginationData`,
 *   `controller`, grouped-issue and pagination maps) are documented on `BaseIssuesStore`;
 *   this store reads them rather than redeclaring.
 *
 * Actions (registered as `action` via `makeObservable`):
 *   - `fetchIssues(workspaceSlug, viewId, loadType, options, isExistingPaginationOptions = false)`
 *       First-page fetch. Sets the loader, clears existing state (unless reusing pagination
 *       context), composes request params via `issueFilterStore.getFilterParams`, and calls
 *       `WorkspaceService.getViewIssues` (the workspace-scoped `/api/workspaces/<slug>/...`
 *       issues endpoint) with `this.controller.signal` for cancellation. The response is
 *       piped through inherited `onfetchIssues` for grouping / mapping.
 *   - `fetchNextIssues(workspaceSlug, viewId, groupId?, subGroupId?)`
 *       Cursor-based subsequent-page fetch. Short-circuits if no `paginationOptions` exist
 *       or the (groupId, subGroupId) bucket reports `nextPageResults === false`; otherwise
 *       sets the `"pagination"` loader for that bucket, calls `WorkspaceService.getViewIssues`,
 *       and routes the response through inherited `onfetchNexIssues`.
 *   - `fetchIssuesWithExistingPagination(workspaceSlug, viewId, loadType)`
 *       Refetches page-1 while preserving the cursor context; used by `WorkspaceIssuesFilter`
 *       when filter / sort / groupBy changes invalidate the current page.
 *   - `fetchParentStats` / `updateParentStats` — intentional no-ops; parent-stat rollups are
 *     not applicable at workspace scope (project / cycle / module stores override these).
 *
 * Aliased mutations (locked to workspace-facing names so further subclasses cannot redefine
 * them via property assignment):
 *   - `archiveBulkIssues` → inherited `bulkArchiveIssues`
 *   - `updateIssue`       → inherited `issueUpdate`
 *   - `archiveIssue`      → inherited `issueArchive`
 *
 * Explicit non-supports:
 *   - `quickAddIssue = undefined` — quick-add requires a project context, which at workspace
 *     layouts is selected per-row rather than implied by the store.
 *
 * Filter-store collaboration:
 *   All request-parameter composition is delegated to `issueFilterStore.getFilterParams`
 *   (`./filter.store.ts`), which produces both filter-derived query params (via
 *   `getAppliedFilters` plus `STATIC_VIEW_TYPES` overrides) and pagination params.
 *
 * Consumers:
 *   - Instantiated in `apps/web/core/store/issue/root.store.ts` alongside `WorkspaceIssuesFilter`.
 *   - Read via `useIssues(EIssuesStoreType.GLOBAL)` by:
 *       - `apps/web/core/components/issues/issue-layouts/roots/all-issue-layout-root.tsx`
 *       - `apps/web/core/components/issues/issue-layouts/spreadsheet/roots/workspace-root.tsx`
 *       - `apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/all-issue.tsx`
 *       - `apps/web/core/components/issues/issue-layouts/empty-states/index.tsx`
 *       - `apps/web/core/components/issues/issue-layouts/utils.tsx`
 *   - Workspace-view modals (`components/workspace/views/{form,modal}.tsx`) and the
 *     workspace export form (`components/exporter/export-form.tsx`).
 */

import { action, makeObservable, runInAction } from "mobx";
// base class
import type {
  IssuePaginationOptions,
  TBulkOperationsPayload,
  TIssue,
  TIssuesResponse,
  TLoader,
  ViewFlags,
} from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";
// types
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IWorkspaceIssuesFilter } from "./filter.store";

export interface IWorkspaceIssues extends IBaseIssuesStore {
  // observable
  viewFlags: ViewFlags;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    viewId: string,
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
  clear(): void;
}

export class WorkspaceIssues extends BaseIssuesStore implements IWorkspaceIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  // service
  workspaceService;
  // filterStore
  issueFilterStore;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IWorkspaceIssuesFilter) {
    super(_rootStore, issueFilterStore);

    makeObservable(this, {
      // action
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
    });
    // services
    this.workspaceService = new WorkspaceService();
    // filter store
    this.issueFilterStore = issueFilterStore;
  }

  fetchParentStats = () => {};

  /** */
  updateParentStats = () => {};

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param viewId
   * @param loadType
   * @param options
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
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
      const params = this.issueFilterStore?.getFilterParams(options, viewId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params, {
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
   * @param viewId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (workspaceSlug: string, viewId: string, groupId?: string, subGroupId?: string) => {
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
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params);

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
   * @param viewId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (workspaceSlug: string, viewId: string, loadType: TLoader) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, viewId, loadType, this.paginationOptions, true);
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;

  // Setting them as undefined as they can not performed on workspace issues
  quickAddIssue = undefined;
}
