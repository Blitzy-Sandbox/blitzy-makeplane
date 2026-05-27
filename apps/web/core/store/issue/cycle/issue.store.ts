/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle-scoped issue collection store. Owns the issue list, pagination,
 * creation, mutation, archive, parent-cycle statistics, the urgent/high
 * priority active-cycle stream, and cycle-membership lifecycle (attach /
 * transfer) for issues displayed in a single cycle's view; keeps cycle
 * membership in sync with the parent cycle via the inherited cycle-issue
 * lifecycle helpers.
 *
 * Extends BaseIssuesStore (`../helpers/base-issues.store`), which already
 * registers MobX observability for `addIssue`, `removeIssueFromList`,
 * `clear`, `setLoader`, `issueUpdate`, `issueArchive`, `removeBulkIssues`,
 * `bulkArchiveIssues`, `bulkUpdateProperties`, `addIssueToCycle`,
 * `removeIssueFromCycle`, `addCycleToIssue`, `removeCycleFromIssue`,
 * `changeModulesInIssue`, and owns the shared `IssueService` /
 * `IssueArchiveService` / `CycleService` instances reused here. Stores
 * are injected via React context (MobX exclusively — not Redux) per
 * AAP §0.2.2.
 *
 * Module exports:
 *   - `ACTIVE_CYCLE_ISSUES` — sentinel string key used by callers that
 *     need to address the active-cycle issue bucket separately from the
 *     cycle's paged issue list (e.g., the active-cycle sidebar widgets).
 *   - `ActiveCycleIssueDetails` — cache shape for a single active cycle:
 *     flat `issueIds`, `issueCount` total, `nextCursor`, `nextPageResults`,
 *     and `perPageCount` for paginated continuation.
 *   - `ICycleIssues` — public contract; consumers should import this type,
 *     not the concrete `CycleIssues` class.
 *
 * State slice (observable):
 *   - activeCycleIds: Record<string, ActiveCycleIssueDetails> — per-cycle
 *     active-cycle pagination caches keyed by `cycleId`; populated by
 *     `fetchActiveCycleIssues` and extended by
 *     `fetchNextActiveCycleIssues`. Distinct from the inherited
 *     `groupedIssueIds` (which holds the cycle's main paged list).
 *   - viewFlags: ViewFlags — fixed `{ enableQuickAdd: true,
 *     enableIssueCreation: true, enableInlineEditing: true }`; gates UI
 *     capabilities on cycle issue screens.
 *   - issueFilterStore: ICycleIssuesFilter — injected companion filter
 *     store used to compose request parameters via `getFilterParams`.
 *   - Inherited from BaseIssuesStore: `issues`, `groupedIssueIds`,
 *     `groupedIssueCount`, `issuePaginationData`, `loader`,
 *     `paginationOptions`, `controller`, plus the issue-detail accessors.
 *     See base class for full slice.
 *
 * Actions (own — registered in `makeObservable` here):
 *   - fetchIssues(workspaceSlug, projectId, loadType, options, cycleId,
 *     isExistingPaginationOptions?): Promise<TIssuesResponse | undefined>
 *       Side effects: sets loader, conditionally clears the local list
 *       (skipped when re-using existing pagination), builds params via
 *       `issueFilterStore.getFilterParams`, calls `issueService.getIssues`
 *       with `controller.signal`, then delegates to inherited
 *       `onfetchIssues` to populate `rootIssueStore.issues` and the
 *       grouped indices.
 *   - fetchNextIssues(workspaceSlug, projectId, cycleId, groupId?,
 *     subGroupId?): Promise<TIssuesResponse | undefined>
 *       Side effects: cursor-based next-page fetch using stored
 *       `paginationOptions` and `getNextCursor(groupId, subGroupId)`;
 *       no-op when `paginationOptions` is unset or the targeted group's
 *       `nextPageResults` is false; delegates to inherited
 *       `onfetchNexIssues`.
 *   - fetchIssuesWithExistingPagination(workspaceSlug, projectId, loadType,
 *     cycleId): Promise<TIssuesResponse | undefined>
 *       Side effects: re-fetches page 1 with the cached
 *       `paginationOptions`; called by `CycleIssuesFilter` after
 *       filter/group/order changes that require a list rebuild.
 *   - fetchActiveCycleIssues(workspaceSlug, projectId, perPageCount,
 *     cycleId): Promise<TIssuesResponse | undefined>
 *       Side effects: clears `activeCycleIds[cycleId]`, then fetches the
 *       urgent/high priority issue list via `cycleService.getCycleIssues`
 *       with hard-coded params `{ priority: "urgent,high",
 *       cursor: "${perPageCount}:0:0", per_page: perPageCount }`; pushes
 *       fetched rows into `rootIssueStore.issues` and stores the flat
 *       `ALL_ISSUES`-bucket ids plus pagination cursors in
 *       `activeCycleIds[cycleId]`. This is the AAP-required
 *       "urgent/high-priority active-cycle stream" specialized lifecycle.
 *   - fetchNextActiveCycleIssues(workspaceSlug, projectId, cycleId):
 *     Promise<TIssuesResponse | undefined>
 *       Side effects: appends the next page of urgent/high active-cycle
 *       issues using the stored `nextCursor`; no-op when the cycle has no
 *       active record or `nextPageResults` is false; merges and
 *       de-duplicates ids via `issuesSortWithOrderBy(uniq(concat(...)),
 *       orderBy)` from the base class.
 *   - quickAddIssue(workspaceSlug, projectId, data, cycleId):
 *     Promise<TIssue | undefined>
 *       Side effects: optimistic — inserts a temp row via inherited
 *       `addIssue`, calls the overridden `createIssue` (which also runs
 *       `addIssueToCycle`), removes the temp row in `runInAction`, then
 *       (if `data.module_ids` is non-empty and not "None") wires the new
 *       issue to its target modules via inherited `changeModulesInIssue`.
 *   - transferIssuesFromCycle(workspaceSlug, projectId, cycleId, payload):
 *     Promise<TIssue>
 *       Side effects: POSTs via `cycleService.transferIssues` to move
 *       open issues from a completed cycle to the cycle named in
 *       `payload.new_cycle_id`; then re-fetches page 1 with the current
 *       `paginationOptions` so the local store reflects the moved-out
 *       state. Consumed by
 *       `apps/web/core/components/cycles/transfer-issues-modal.tsx`.
 *
 * Actions (own — NOT in `makeObservable` here, but declared as class
 * fields / overrides):
 *   - createIssue(workspaceSlug, projectId, data, cycleId): Promise<TIssue>
 *       Overrides `BaseIssuesStore.createIssue`. Side effects: calls
 *       `super.createIssue(..., isAddIssue=false)` then attaches the new
 *       issue to the active cycle via inherited
 *       `addIssueToCycle(workspaceSlug, projectId, cycleId,
 *       [response.id], false)`.
 *   - fetchParentStats(workspaceSlug, projectId?, id?): void
 *       Side effects: refreshes the parent cycle via
 *       `rootIssueStore.rootStore.cycle.fetchCycleDetails`; additionally
 *       (only when the `cycle_sidebar_collapsed` local-storage flag is
 *       explicitly `false` and the cycle has `version === 2`) refreshes
 *       Pro active-cycle progress via
 *       `rootIssueStore.rootStore.cycle.fetchActiveCycleProgressPro`. The
 *       conditional avoids the heavier Pro endpoint when the sidebar is
 *       collapsed or the cycle is a legacy v1 cycle.
 *   - updateParentStats(prevIssueState?, nextIssueState?, id?): void
 *       Side effects: computes distribution deltas via
 *       `getDistributionPathsPostUpdate` (against the state map and the
 *       active project estimate's `estimatePointById`) and pushes them
 *       into `rootIssueStore.rootStore.cycle.updateCycleDistribution`
 *       for optimistic cycle-stat refresh. Wrapped in try/catch with a
 *       `console.warn` fallback — per AAP folder spec: failures must
 *       not block issue updates.
 *   - archiveBulkIssues = this.bulkArchiveIssues — cycle-oriented alias.
 *   - updateIssue = this.issueUpdate — cycle-oriented alias.
 *   - archiveIssue = this.issueArchive — cycle-oriented alias.
 *   - Inherited (NOT redefined here, exposed verbatim via the
 *     `IBaseIssuesStore` contract): `getIssueIds`, `removeBulkIssues`,
 *     `bulkUpdateProperties`, `addIssueToCycle`, `removeIssueFromCycle`,
 *     `addCycleToIssue`, `removeCycleFromIssue`, `addIssuesToModule`,
 *     `removeIssuesFromModule`, `changeModulesInIssue`, `addIssue`,
 *     `removeIssueFromList`, `clear`, `setLoader`.
 *
 * Computed:
 *   - getActiveCycleById(cycleId) — `computedFn` from `mobx-utils` that
 *     returns the cached `ActiveCycleIssueDetails` entry for a given
 *     cycle id; memoized per id and recomputes when
 *     `activeCycleIds[cycleId]` changes. Used by active-cycle widgets
 *     to read the urgent/high stream without re-deriving from
 *     `groupedIssueIds`.
 *   - Derived pagination state (`getPaginationData`, `getNextCursor`,
 *     `getGroupIssueCount`) is owned by `BaseIssuesStore` as
 *     `computedFn`-based helpers; see the base class.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/list/roots/cycle-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/kanban/roots/cycle-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/spreadsheet/roots/cycle-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/calendar/roots/cycle-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/gantt/base-gantt-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/roots/cycle-layout-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/empty-states/cycle.tsx
 *   - apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/cycle-issue.tsx
 *   - apps/web/core/components/issues/issue-modal/base.tsx
 *   - apps/web/core/components/cycles/transfer-issues-modal.tsx
 *     (reads `transferIssuesFromCycle` via
 *     `useIssues(EIssuesStoreType.CYCLE)`)
 *   - apps/web/core/components/cycles/active-cycle/use-cycles-details.ts
 *   - apps/web/core/components/cycles/active-cycle/cycle-stats.tsx
 *     (reads `getActiveCycleById` / `fetchActiveCycleIssues` /
 *     `fetchNextActiveCycleIssues`)
 *   - apps/web/core/components/cycles/analytics-sidebar/issue-progress.tsx
 *   - apps/web/core/hooks/store/use-issues.ts (selects via
 *     `EIssuesStoreType.CYCLE`)
 *   - apps/web/core/hooks/use-issues-actions.tsx
 *   - apps/web/core/store/issue/issue-details/issue.store.ts — cross-store
 *     reader of `rootIssueStore.cycleIssues.addCycleToIssue` /
 *     `removeCycleFromIssue` for issue-detail cycle mutations.
 *   - apps/web/core/store/issue/root.store.ts — singleton wiring under
 *     `cycleIssues` (constructed with `(this, this.cycleIssuesFilter)`).
 */

import { get, set, concat, uniq, update } from "lodash-es";
import { action, observable, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { ALL_ISSUES } from "@plane/constants";
import type {
  TIssue,
  TLoader,
  IssuePaginationOptions,
  TIssuesResponse,
  ViewFlags,
  TBulkOperationsPayload,
} from "@plane/types";
// helpers
import { getDistributionPathsPostUpdate } from "@plane/utils";
//local
import { storage } from "@/lib/local-storage";
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
//
import type { IIssueRootStore } from "../root.store";
import type { ICycleIssuesFilter } from "./filter.store";

export const ACTIVE_CYCLE_ISSUES = "ACTIVE_CYCLE_ISSUES";

export interface ActiveCycleIssueDetails {
  issueIds: string[];
  issueCount: number;
  nextCursor: string;
  nextPageResults: boolean;
  perPageCount: number;
}

export interface ICycleIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  activeCycleIds: Record<string, ActiveCycleIssueDetails>;
  //action helpers
  getActiveCycleById: (cycleId: string) => ActiveCycleIssueDetails | undefined;
  // actions
  getIssueIds: (groupId?: string, subGroupId?: string) => string[] | undefined;
  fetchIssues: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    cycleId: string
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    cycleId: string
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  fetchActiveCycleIssues: (
    workspaceSlug: string,
    projectId: string,
    perPageCount: number,
    cycleId: string
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextActiveCycleIssues: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>, cycleId: string) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  quickAddIssue: (
    workspaceSlug: string,
    projectId: string,
    data: TIssue,
    cycleId: string
  ) => Promise<TIssue | undefined>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;

  transferIssuesFromCycle: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    payload: {
      new_cycle_id: string;
    }
  ) => Promise<TIssue>;
}

export class CycleIssues extends BaseIssuesStore implements ICycleIssues {
  activeCycleIds: Record<string, ActiveCycleIssueDetails> = {};
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  // filter store
  issueFilterStore;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: ICycleIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      // observable
      activeCycleIds: observable,
      // action
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,

      transferIssuesFromCycle: action,
      fetchActiveCycleIssues: action,

      quickAddIssue: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
  }

  getActiveCycleById = computedFn((cycleId: string) => this.activeCycleIds[cycleId]);

  /**
   * Fetches the cycle details
   * @param workspaceSlug
   * @param projectId
   * @param id is the cycle Id
   */
  fetchParentStats = (workspaceSlug: string, projectId?: string, id?: string) => {
    const cycleId = id ?? this.cycleId;

    if (projectId && cycleId) {
      this.rootIssueStore.rootStore.cycle.fetchCycleDetails(workspaceSlug, projectId, cycleId);
    }
    // fetch cycle progress
    const isSidebarCollapsed = storage.get("cycle_sidebar_collapsed");
    if (
      projectId &&
      cycleId &&
      this.rootIssueStore.rootStore.cycle.getCycleById(cycleId)?.version === 2 &&
      isSidebarCollapsed &&
      JSON.parse(isSidebarCollapsed) === false
    ) {
      this.rootIssueStore.rootStore.cycle.fetchActiveCycleProgressPro(workspaceSlug, projectId, cycleId);
    }
  };

  updateParentStats = (prevIssueState?: TIssue, nextIssueState?: TIssue, id?: string) => {
    try {
      const distributionUpdates = getDistributionPathsPostUpdate(
        prevIssueState,
        nextIssueState,
        this.rootIssueStore.rootStore.state.stateMap,
        this.rootIssueStore.rootStore.projectEstimate?.currentActiveEstimate?.estimatePointById
      );

      const cycleId = id ?? this.cycleId;
      if (cycleId) {
        this.rootIssueStore.rootStore.cycle.updateCycleDistribution(distributionUpdates, cycleId);
      }
    } catch (_e) {
      console.warn("could not update cycle statistics");
    }
  };

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param projectId
   * @param loadType
   * @param options
   * @param cycleId
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    cycleId: string,
    isExistingPaginationOptions: boolean = false
  ) => {
    try {
      // set loader and clear store
      runInAction(() => {
        this.setLoader(loadType);
        this.clear(!isExistingPaginationOptions); // clear while fetching from server.
      });

      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, cycleId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, projectId, cycleId, !isExistingPaginationOptions);
      return response;
    } catch (error) {
      // set loader to undefined once errored out
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
   * @param cycleId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
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
        cycleId,
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
   * @param cycleId
   * @returns
   */
  fetchIssuesWithExistingPagination = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    cycleId: string
  ) => {
    if (!this.paginationOptions) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, cycleId, true);
  };

  /**
   * Override inherited create issue, to also add issue to cycle
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @param cycleId
   * @returns
   */
  override createIssue = async (workspaceSlug: string, projectId: string, data: Partial<TIssue>, cycleId: string) => {
    const response = await super.createIssue(workspaceSlug, projectId, data, cycleId, false);
    await this.addIssueToCycle(workspaceSlug, projectId, cycleId, [response.id], false);
    return response;
  };

  /**
   * This method is used to transfer issues from completed cycles to a new cycle
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @param payload contains new cycle Id
   * @returns
   */
  transferIssuesFromCycle = async (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    payload: {
      new_cycle_id: string;
    }
  ) => {
    // call API call to transfer issues
    const response = await this.cycleService.transferIssues(workspaceSlug, projectId, cycleId, payload);
    // call fetch issues
    if (this.paginationOptions) {
      await this.fetchIssues(workspaceSlug, projectId, "mutation", this.paginationOptions, cycleId);
    }

    return response;
  };

  /**
   * This is Pagination for active cycle issues
   * This method is called to fetch the first page of issues pagination
   * @param workspaceSlug
   * @param projectId
   * @param perPageCount
   * @param cycleId
   * @returns
   */
  fetchActiveCycleIssues = async (workspaceSlug: string, projectId: string, perPageCount: number, cycleId: string) => {
    // set loader
    set(this.activeCycleIds, [cycleId], undefined);

    // set params for urgent and high
    const params = { priority: `urgent,high`, cursor: `${perPageCount}:0:0`, per_page: perPageCount };
    // call the fetch issues API
    const response = await this.cycleService.getCycleIssues(workspaceSlug, projectId, cycleId, params);

    // Process issue response
    const { issueList, groupedIssues } = this.processIssueResponse(response);

    // add issues to the main Issue Map
    this.rootIssueStore.issues.addIssue(issueList);
    const activeIssueIds = groupedIssues[ALL_ISSUES] as string[];

    // store the processed data in the current store
    set(this.activeCycleIds, [cycleId], {
      issueIds: activeIssueIds,
      issueCount: response.total_count,
      nextCursor: response.next_cursor,
      nextPageResults: response.next_page_results,
      perPageCount: perPageCount,
    });

    return response;
  };

  /**
   * This is Pagination for active cycle issues
   * This method is called subsequent pages of pagination
   * @param workspaceSlug
   * @param projectId
   * @param cycleId
   * @returns
   */
  fetchNextActiveCycleIssues = async (workspaceSlug: string, projectId: string, cycleId: string) => {
    //get the previous pagination data for the cycle id
    const activeCycle = get(this.activeCycleIds, [cycleId]);

    // if there is no active cycle and the next pages does not exist return
    if (!activeCycle || !activeCycle.nextPageResults) return;

    // create params
    const params = { priority: `urgent,high`, cursor: activeCycle.nextCursor, per_page: activeCycle.perPageCount };
    // fetch API response
    const response = await this.cycleService.getCycleIssues(workspaceSlug, projectId, cycleId, params);

    // Process the response
    const { issueList, groupedIssues } = this.processIssueResponse(response);

    // add issues to main issue Map
    this.rootIssueStore.issues.addIssue(issueList);

    const activeIssueIds = groupedIssues[ALL_ISSUES] as string[];

    // store the processed data for subsequent pages
    set(this.activeCycleIds, [cycleId, "issueCount"], response.total_count);
    set(this.activeCycleIds, [cycleId, "nextCursor"], response.next_cursor);
    set(this.activeCycleIds, [cycleId, "nextPageResults"], response.next_page_results);
    set(this.activeCycleIds, [cycleId, "issueCount"], response.total_count);
    update(this.activeCycleIds, [cycleId, "issueIds"], (issueIds: string[] = []) =>
      this.issuesSortWithOrderBy(uniq(concat(issueIds, activeIssueIds)), this.orderBy)
    );

    return response;
  };

  /**
   * This Method overrides the base quickAdd issue
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @param cycleId
   * @returns
   */
  quickAddIssue = async (workspaceSlug: string, projectId: string, data: TIssue, cycleId: string) => {
    // add temporary issue to store list
    this.addIssue(data);

    // call overridden create issue
    const response = await this.createIssue(workspaceSlug, projectId, data, cycleId);

    // remove temp Issue from store list
    runInAction(() => {
      this.removeIssueFromList(data.id);
      this.rootIssueStore.issues.removeIssue(data.id);
    });

    const currentModuleIds =
      data.module_ids && data.module_ids.length > 0 ? data.module_ids.filter((moduleId) => moduleId != "None") : [];

    if (currentModuleIds.length > 0) {
      await this.changeModulesInIssue(workspaceSlug, projectId, response.id, currentModuleIds, []);
    }

    return response;
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
