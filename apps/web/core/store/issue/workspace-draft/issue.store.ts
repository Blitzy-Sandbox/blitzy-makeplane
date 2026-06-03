/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace-level draft issues — a workspace-scoped scratch pad of unfinished
 * issues that lives OUTSIDE the regular project issue lifecycle until promoted to a real
 * `TIssue` via `moveIssue`. Drafts have a simplified mutation surface (no grouped views, no
 * archive, no cycle/module membership, no bulk operations); the unsupported surface is
 * satisfied by deliberate no-op methods so this store still implements the broader
 * issue-store interface used by polymorphic consumers.
 *
 * Local constants:
 *   - paginatedCount = 50 — fixed page size; sole source of truth for the cursor stride
 *       used by `generateNotificationQueryParams`.
 *
 * State slice (registered on `makeObservable`):
 *   - loader: TWorkspaceDraftIssueLoader (observable.ref) — async/mutation indicator
 *       (`init-loader` | `mutation` | `pagination` | `loaded` | `create` | `update` |
 *       `delete` | `move` | `empty-state` | undefined).
 *   - paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results">
 *       | undefined (observable) — cursor + counts snapshot from the most recent server
 *       response; drives the workspace drafts count chip in the header.
 *   - issuesMap: Record<string, TWorkspaceDraftIssue> (observable) — issue id -> draft
 *       issue cache; primary store for fetched drafts.
 *   - issueMapIds: Record<string, string[]> (observable) — workspaceSlug -> ordered list
 *       of draft issue ids in this workspace; new ids are prepended on create/fetch.
 *
 * Non-observable references:
 *   - issueStore: IIssueRootStore — back-reference held on `this`; supplies the reactive
 *       `issueStore.workspaceSlug` route read and the cross-store mutation target on
 *       `rootStore.user.permission.workspaceUserInfo`.
 *
 * Computed:
 *   - issueIds — sorted view of `issueMapIds[workspaceSlug]` ordered by
 *       `issuesMap[id].created_at` DESC (via `convertToISODateString`); recomputes when
 *       `issueMapIds`, `issuesMap`, or `issueStore.workspaceSlug` change.
 *   - getIssueById(issueId) — `computedFn` memoized lookup returning the cached
 *       `TWorkspaceDraftIssue` or `undefined`; recomputes per id when `issuesMap` changes.
 *
 * Helper actions (cache-only, NO backend call):
 *   - addIssue(issues) — upserts each draft into `issuesMap` via `lodash.set` on miss and
 *       `lodash.update` (shallow-merge) on hit.
 *   - mutateIssue(issueId, partial) — patches an existing entry and stamps `updated_at`
 *       with `getCurrentDateTimeInISO()`; no-op if the id is not cached.
 *   - removeIssue(issueId) — `unset` from `issuesMap`; no-op if absent.
 *     * INTENT UNCLEAR: removeIssue only evicts from the local cache; backend deletion is
 *       handled by `deleteIssue`, so callers must NOT use `removeIssue` as a standalone
 *       delete path.
 *   - generateNotificationQueryParams(paramType, filterParams) — builds the `per_page` +
 *       `cursor` payload for INIT / CURRENT / NEXT / default modes against the current
 *       `paginationInfo.next_cursor`.
 *
 * Async actions (registered on `makeObservable` as `action`; the MobX-aware mutation site
 * is the `runInAction` embedded inside each body):
 *   - fetchIssues(workspaceSlug, loadType, paginationType = INIT) → workspaceDraftService.getIssues.
 *       Side effects: writes `results` into `issuesMap`, prepends NEW ids to
 *       `issueMapIds[workspaceSlug]` (existing ids preserved), snapshots `paginationInfo`;
 *       sets loader to `undefined` on success or `"empty-state"` when no results; on error
 *       resets loader and re-throws.
 *   - createIssue(workspaceSlug, payload) → workspaceDraftService.createIssue.
 *       Side effects: caches the new draft, prepends its id, increments
 *       `paginationInfo.total_count`, and increments
 *       `workspaceUserInfo[workspaceSlug].draft_issue_count` via the private
 *       `updateWorkspaceUserDraftIssueCount(+1)` helper (cross-store mutation on the user
 *       permission store).
 *   - updateIssue(workspaceSlug, issueId, payload) → workspaceDraftService.updateIssue.
 *       Optimistically merges payload + stamps `updated_at`; on error reverts the cache to
 *       the pre-update snapshot and re-throws.
 *   - deleteIssue(workspaceSlug, issueId) → workspaceDraftService.deleteIssue.
 *       Side effects: removes id from `issueMapIds[workspaceSlug]` and `issuesMap`,
 *       decrements `paginationInfo.total_count`, and decrements `draft_issue_count` via
 *       `updateWorkspaceUserDraftIssueCount(-1)`.
 *   - moveIssue(workspaceSlug, issueId, payload) → workspaceDraftService.moveIssue.
 *       Promote-to-issue lifecycle: the server converts the draft into a regular project
 *       `TIssue` and returns it. Local side effects mirror `deleteIssue` (drop the draft,
 *       decrement `total_count`, decrement `draft_issue_count`). The newly created regular
 *       issue is NOT inserted into THIS store — promotion hands ownership over to the
 *       regular project/cycle/module issue stores. Returns the resulting `TIssue` so
 *       callers can route the user to the promoted issue.
 *   - addCycleToIssue(workspaceSlug, issueId, cycleId) — thin wrapper over
 *       `updateIssue(..., { cycle_id })`.
 *   - addModulesToIssue(workspaceSlug, issueId, moduleIds) — thin wrapper over
 *       `updateIssue(..., { module_ids })`.
 *
 * Compatibility no-ops (deliberate empty implementations that satisfy the wider issue-store
 * interface used by polymorphic consumers — drafts do not support these features here):
 *   - viewFlags = { enableQuickAdd: false, enableIssueCreation: false, enableInlineEditing: false }
 *       — drafts intentionally do NOT expose inline editing or quick-add via this store;
 *       UI consumers drive creation through their own modal-based flows.
 *   - groupedIssueIds = undefined — drafts are never grouped.
 *   - getIssueIds, getPaginationData, getGroupIssueCount — return `undefined`.
 *   - getIssueLoader — returns the constant `"loaded"` as a `TLoader`.
 *   - removeCycleFromIssue, addIssueToCycle, removeIssueFromCycle, removeIssuesFromModule,
 *       changeModulesInIssue, archiveIssue, archiveBulkIssues, removeBulkIssues,
 *       bulkUpdateProperties — async no-ops returning `void` without side effects.
 *
 * Cross-store dependencies:
 *   - Reads `issueStore.workspaceSlug` in the `issueIds` computed getter.
 *   - Mutates `issueStore.rootStore.user.permission.workspaceUserInfo[workspaceSlug]
 *       .draft_issue_count` on every successful create/delete/move so the workspace
 *       drafts badge stays consistent without a refetch.
 *
 * Consumers:
 *   - apps/web/core/hooks/store/workspace-draft/use-workspace-draft-issue.ts — typed hook
 *       returning `context.issue.workspaceDraftIssues` from `StoreContext`.
 *   - apps/web/core/components/issues/workspace-draft/** — `root.tsx` orchestrates loading
 *       and pagination via `fetchIssues`; `draft-issue-block.tsx` reads via `getIssueById`;
 *       `draft-issue-properties.tsx` calls `updateIssue` / `addCycleToIssue` /
 *       `addModulesToIssue`; `delete-modal.tsx` calls `deleteIssue`; the create flow calls
 *       `createIssue`; the move-to-project workflow calls `moveIssue` for promotion.
 *   - apps/web/app/(all)/[workspaceSlug]/(projects)/drafts/header.tsx — reads
 *       `paginationInfo.total_count` for the workspace drafts count chip.
 *   - Composed by apps/web/core/store/issue/root.store.ts as `workspaceDraftIssues` and
 *       exposed through the MobX root store provided via React context.
 */

import { clone, update, unset, orderBy, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { EDraftIssuePaginationType } from "@plane/constants";
import type {
  TWorkspaceDraftIssue,
  TWorkspaceDraftPaginationInfo,
  TWorkspaceDraftIssueLoader,
  TWorkspaceDraftQueryParams,
  TPaginationData,
  TLoader,
  TGroupedIssues,
  TSubGroupedIssues,
  ViewFlags,
  TIssue,
  TBulkOperationsPayload,
} from "@plane/types";
import { getCurrentDateTimeInISO, convertToISODateString } from "@plane/utils";
// services
import workspaceDraftService from "@/services/issue/workspace_draft.service";
// types
import type { IIssueRootStore } from "../root.store";

export type TDraftIssuePaginationType = EDraftIssuePaginationType;

export interface IWorkspaceDraftIssues {
  // observables
  loader: TWorkspaceDraftIssueLoader;
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined;
  issuesMap: Record<string, TWorkspaceDraftIssue>; // issue_id -> issue;
  issueMapIds: Record<string, string[]>; // workspace_id -> issue_ids;
  // computed
  issueIds: string[];
  // computed functions
  getIssueById: (issueId: string) => TWorkspaceDraftIssue | undefined;
  // helper actions
  addIssue: (issues: TWorkspaceDraftIssue[]) => void;
  mutateIssue: (issueId: string, data: Partial<TWorkspaceDraftIssue>) => void;
  removeIssue: (issueId: string) => Promise<void>;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType?: TDraftIssuePaginationType
  ) => Promise<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue> | undefined>;
  createIssue: (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  updateIssue: (
    workspaceSlug: string,
    issueId: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  deleteIssue: (workspaceSlug: string, issueId: string) => Promise<void>;
  moveIssue: (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => Promise<TIssue>;
  addCycleToIssue: (
    workspaceSlug: string,
    issueId: string,
    cycleId: string
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  addModulesToIssue: (
    workspaceSlug: string,
    issueId: string,
    moduleIds: string[]
  ) => Promise<TWorkspaceDraftIssue | undefined>;

  // dummies
  viewFlags: ViewFlags;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined;
  getIssueIds: (groupId?: string, subGroupId?: string) => string[] | undefined;
  getPaginationData(groupId: string | undefined, subGroupId: string | undefined): TPaginationData | undefined;
  getIssueLoader(groupId?: string, subGroupId?: string): TLoader;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  removeCycleFromIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addIssueToCycle: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    issueIds: string[],
    fetchAddedIssues?: boolean
  ) => Promise<void>;
  removeIssueFromCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;

  removeIssuesFromModule: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    issueIds: string[]
  ) => Promise<void>;
  changeModulesInIssue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ): Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
}

export class WorkspaceDraftIssues implements IWorkspaceDraftIssues {
  // local constants
  paginatedCount = 50;
  // observables
  loader: TWorkspaceDraftIssueLoader = undefined;
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined = undefined;
  issuesMap: Record<string, TWorkspaceDraftIssue> = {};
  issueMapIds: Record<string, string[]> = {};

  constructor(public issueStore: IIssueRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      paginationInfo: observable,
      issuesMap: observable,
      issueMapIds: observable,
      // computed
      issueIds: computed,
      // action
      fetchIssues: action,
      createIssue: action,
      updateIssue: action,
      deleteIssue: action,
      moveIssue: action,
      addCycleToIssue: action,
      addModulesToIssue: action,
    });
  }

  private updateWorkspaceUserDraftIssueCount(workspaceSlug: string, increment: number) {
    const workspaceUserInfo = this.issueStore.rootStore.user.permission.workspaceUserInfo;
    const currentCount = workspaceUserInfo[workspaceSlug]?.draft_issue_count ?? 0;

    set(workspaceUserInfo, [workspaceSlug, "draft_issue_count"], currentCount + increment);
  }

  // computed
  get issueIds() {
    const workspaceSlug = this.issueStore.workspaceSlug;
    if (!workspaceSlug) return [];
    if (!this.issueMapIds[workspaceSlug]) return [];
    const issueIds = this.issueMapIds[workspaceSlug];
    return orderBy(issueIds, (issueId) => convertToISODateString(this.issuesMap[issueId]?.created_at), ["desc"]);
  }

  // computed functions
  getIssueById = computedFn((issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return undefined;
    return this.issuesMap[issueId];
  });

  // helper actions
  addIssue = (issues: TWorkspaceDraftIssue[]) => {
    if (issues && issues.length <= 0) return;
    runInAction(() => {
      issues.forEach((issue) => {
        if (!this.issuesMap[issue.id]) set(this.issuesMap, issue.id, issue);
        else update(this.issuesMap, issue.id, (prevIssue) => ({ ...prevIssue, ...issue }));
      });
    });
  };

  mutateIssue = (issueId: string, issue: Partial<TWorkspaceDraftIssue>) => {
    if (!issue || !issueId || !this.issuesMap[issueId]) return;
    runInAction(() => {
      set(this.issuesMap, [issueId, "updated_at"], getCurrentDateTimeInISO());
      Object.keys(issue).forEach((key) => {
        set(this.issuesMap, [issueId, key], issue[key as keyof TWorkspaceDraftIssue]);
      });
    });
  };

  removeIssue = async (issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return;
    runInAction(() => unset(this.issuesMap, issueId));
  };

  generateNotificationQueryParams = (
    paramType: TDraftIssuePaginationType,
    filterParams = {}
  ): TWorkspaceDraftQueryParams => {
    const queryCursorNext: string =
      paramType === EDraftIssuePaginationType.INIT
        ? `${this.paginatedCount}:0:0`
        : paramType === EDraftIssuePaginationType.CURRENT
          ? `${this.paginatedCount}:${0}:0`
          : paramType === EDraftIssuePaginationType.NEXT && this.paginationInfo
            ? (this.paginationInfo?.next_cursor ?? `${this.paginatedCount}:${0}:0`)
            : `${this.paginatedCount}:${0}:0`;

    const queryParams: TWorkspaceDraftQueryParams = {
      per_page: this.paginatedCount,
      cursor: queryCursorNext,
      ...filterParams,
    };

    return queryParams;
  };

  // actions
  fetchIssues = async (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType: TDraftIssuePaginationType = EDraftIssuePaginationType.INIT
  ) => {
    try {
      this.loader = loadType;

      // filter params and pagination params
      const filterParams = {};
      const params = this.generateNotificationQueryParams(paginationType, filterParams);

      // fetching the paginated workspace draft issues
      const draftIssuesResponse = await workspaceDraftService.getIssues(workspaceSlug, { ...params });
      if (!draftIssuesResponse) return undefined;

      const { results, ...paginationInfo } = draftIssuesResponse;
      runInAction(() => {
        if (results && results.length > 0) {
          // adding issueIds
          const issueIds = results.map((issue) => issue.id);
          const existingIssueIds = this.issueMapIds[workspaceSlug] ?? [];
          // new issueIds
          const newIssueIds = issueIds.filter((issueId) => !existingIssueIds.includes(issueId));
          this.addIssue(results);
          // issue map update
          update(this.issueMapIds, [workspaceSlug], (existingIssueIds = []) => [...newIssueIds, ...existingIssueIds]);
          this.loader = undefined;
        } else {
          this.loader = "empty-state";
        }
        set(this, "paginationInfo", paginationInfo);
      });
      return draftIssuesResponse;
    } catch (error) {
      // set loader to undefined if errored out
      this.loader = undefined;
      throw error;
    }
  };

  createIssue = async (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ): Promise<TWorkspaceDraftIssue | undefined> => {
    try {
      this.loader = "create";

      const response = await workspaceDraftService.createIssue(workspaceSlug, payload);
      if (response) {
        runInAction(() => {
          this.addIssue([response]);
          update(this.issueMapIds, [workspaceSlug], (existingIssueIds = []) => [response.id, ...existingIssueIds]);
          // increase the count of issues in the pagination info
          if (this.paginationInfo?.total_count) {
            set(this, "paginationInfo", {
              ...this.paginationInfo,
              total_count: this.paginationInfo.total_count + 1,
            });
          }
          // Update draft issue count in workspaceUserInfo
          this.updateWorkspaceUserDraftIssueCount(workspaceSlug, 1);
        });
      }

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  updateIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue | TIssue>) => {
    const issueBeforeUpdate = clone(this.getIssueById(issueId));
    try {
      this.loader = "update";
      runInAction(() => {
        set(this.issuesMap, [issueId], {
          ...issueBeforeUpdate,
          ...payload,
          ...{ updated_at: getCurrentDateTimeInISO() },
        });
      });
      const response = await workspaceDraftService.updateIssue(workspaceSlug, issueId, payload);
      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      runInAction(() => {
        set(this.issuesMap, [issueId], issueBeforeUpdate);
      });
      throw error;
    }
  };

  deleteIssue = async (workspaceSlug: string, issueId: string) => {
    try {
      this.loader = "delete";

      const response = await workspaceDraftService.deleteIssue(workspaceSlug, issueId);
      runInAction(() => {
        // Remove the issue from the issueMapIds
        this.issueMapIds[workspaceSlug] = (this.issueMapIds[workspaceSlug] || []).filter((id) => id !== issueId);
        // Remove the issue from the issuesMap
        delete this.issuesMap[issueId];
        // reduce the count of issues in the pagination info
        if (this.paginationInfo?.total_count) {
          set(this, "paginationInfo", {
            ...this.paginationInfo,
            total_count: this.paginationInfo.total_count - 1,
          });
        }
        // Update draft issue count in workspaceUserInfo
        this.updateWorkspaceUserDraftIssueCount(workspaceSlug, -1);
      });

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  moveIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => {
    try {
      this.loader = "move";

      const response = await workspaceDraftService.moveIssue(workspaceSlug, issueId, payload);
      runInAction(() => {
        // Remove the issue from the issueMapIds
        this.issueMapIds[workspaceSlug] = (this.issueMapIds[workspaceSlug] || []).filter((id) => id !== issueId);
        // Remove the issue from the issuesMap
        delete this.issuesMap[issueId];
        // reduce the count of issues in the pagination info
        if (this.paginationInfo?.total_count) {
          set(this, "paginationInfo", {
            ...this.paginationInfo,
            total_count: this.paginationInfo.total_count - 1,
          });
        }

        // Update draft issue count in workspaceUserInfo
        this.updateWorkspaceUserDraftIssueCount(workspaceSlug, -1);
      });

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addCycleToIssue = async (workspaceSlug: string, issueId: string, cycleId: string) => {
    try {
      this.loader = "update";
      const response = await this.updateIssue(workspaceSlug, issueId, { cycle_id: cycleId });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addModulesToIssue = async (workspaceSlug: string, issueId: string, moduleIds: string[]) => {
    try {
      this.loader = "update";
      const response = this.updateIssue(workspaceSlug, issueId, { module_ids: moduleIds });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  // dummies
  viewFlags: ViewFlags = { enableQuickAdd: false, enableIssueCreation: false, enableInlineEditing: false };
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined = undefined;
  getIssueIds = (_groupId?: string, _subGroupId?: string) => undefined;
  getPaginationData = (_groupId: string | undefined, _subGroupId: string | undefined) => undefined;
  getIssueLoader = (_groupId?: string, _subGroupId?: string) => "loaded" as TLoader;
  getGroupIssueCount = (
    _groupId: string | undefined,
    _subGroupId: string | undefined,
    _isSubGroupCumulative: boolean
  ) => undefined;
  removeCycleFromIssue = async (_workspaceSlug: string, _projectId: string, _issueId: string) => {};
  addIssueToCycle = async (
    _workspaceSlug: string,
    _projectId: string,
    _cycleId: string,
    _issueIds: string[],
    _fetchAddedIssues?: boolean
  ) => {};
  removeIssueFromCycle = async (_workspaceSlug: string, _projectId: string, _cycleId: string, _issueId: string) => {};

  removeIssuesFromModule = async (
    _workspaceSlug: string,
    _projectId: string,
    _moduleId: string,
    _issueIds: string[]
  ) => {};
  changeModulesInIssue = async (
    _workspaceSlug: string,
    _projectId: string,
    _issueId: string,
    _addModuleIds: string[],
    _removeModuleIds: string[]
  ) => {};
  archiveIssue = async (_workspaceSlug: string, _projectId: string, _issueId: string) => {};
  archiveBulkIssues = async (_workspaceSlug: string, _projectId: string, _issueIds: string[]) => {};
  removeBulkIssues = async (_workspaceSlug: string, _projectId: string, _issueIds: string[]) => {};
  bulkUpdateProperties = async (_workspaceSlug: string, _projectId: string, _data: TBulkOperationsPayload) => {};
}
