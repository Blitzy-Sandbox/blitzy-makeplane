/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for per-work-item sub-issue display configuration — owns the filters, display filters,
 * display properties, grouping and ordering for each parent work item's sub-issue widget. Composed
 * into the paired `IssueSubIssuesStore` and never instantiated independently.
 *
 * State slice:
 * - subIssueFilters: Record<workItemId, Partial<ISubWorkItemFilters>> — per-work-item subscription of
 *   { displayProperties, filters, displayFilters } that drives the sub-issue list rendering. New entries
 *   are lazily initialized via `initializeFilters` using DEFAULT_DISPLAY_PROPERTIES.
 *
 * Module-level constants:
 * - DEFAULT_DISPLAY_PROPERTIES: keys/issue_type/assignee/start_date/due_date/labels/priority/state are all
 *   on by default; consumed by `initializeFilters` whenever a work item is first looked up.
 *
 * Actions:
 * - updateSubWorkItemFilters(filterType, filters, workItemId): delegates to the shared
 *   `getFilteredWorkItems` / `updateSubWorkItemFilters` helpers in `../helpers/base-issues-utils` so the
 *   filter mutation logic stays aligned with the main issue list filters.
 * - getSubIssueFilters(workItemId): lazy-init accessor — guarantees the work-item key exists in
 *   subIssueFilters before returning it.
 * - resetFilters(workItemId): re-initializes the work item's bucket to defaults.
 * - initializeFilters(workItemId): seeds the work item entry with DEFAULT_DISPLAY_PROPERTIES and empty
 *   filters/displayFilters.
 *
 * Computed helpers (computedFn):
 * - getFilteredSubWorkItems(workItemId, filters): resolves the sub-issue ids from the paired
 *   `IssueSubIssuesStore`, hydrates them from `rootIssueStore.issues.getIssuesByIds(..., "un-archived")`,
 *   and runs them through the shared `getFilteredWorkItems` helper. Recomputes when sub-issue ids,
 *   the shared issue cache, or `filters` change.
 * - getGroupedSubWorkItems(parentWorkItemId): runs `getFilteredSubWorkItems` and then groups the result
 *   via the shared `getGroupedWorkItemIds` helper using the work item's `group_by` and `order_by`.
 *
 * Composition: instantiated as `filters` inside `IssueSubIssuesStore`; this is the only construction site.
 *
 * Consumers: sub-issue widgets under apps/web/core/components/issues/issue-detail/** and
 * apps/web/core/components/issues/issue-detail-widgets/sub-work-items/** which read filters and grouped
 * lists via `rootIssueDetail.subIssues.filters`.
 */

import { set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { EIssueFilterType } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IIssueFilterOptions,
  ISubWorkItemFilters,
  TGroupedIssues,
  TIssue,
} from "@plane/types";
import { getFilteredWorkItems, getGroupedWorkItemIds, updateSubWorkItemFilters } from "../helpers/base-issues-utils";
import type { IssueSubIssuesStore } from "./sub_issues.store";

export const DEFAULT_DISPLAY_PROPERTIES = {
  key: true,
  issue_type: true,
  assignee: true,
  start_date: true,
  due_date: true,
  labels: true,
  priority: true,
  state: true,
};
export interface IWorkItemSubIssueFiltersStore {
  subIssueFilters: Record<string, Partial<ISubWorkItemFilters>>;
  // helpers methods
  updateSubWorkItemFilters: (
    filterType: EIssueFilterType,
    filters: IIssueDisplayFilterOptions | IIssueDisplayProperties | IIssueFilterOptions,
    workItemId: string
  ) => void;
  getGroupedSubWorkItems: (workItemId: string) => TGroupedIssues;
  getFilteredSubWorkItems: (workItemId: string, filters: IIssueFilterOptions) => TIssue[];
  getSubIssueFilters: (workItemId: string) => Partial<ISubWorkItemFilters>;
  resetFilters: (workItemId: string) => void;
}

export class WorkItemSubIssueFiltersStore implements IWorkItemSubIssueFiltersStore {
  // observables
  subIssueFilters: Record<string, Partial<ISubWorkItemFilters>> = {};

  // root store
  subIssueStore: IssueSubIssuesStore;

  constructor(subIssueStore: IssueSubIssuesStore) {
    makeObservable(this, {
      subIssueFilters: observable,
      updateSubWorkItemFilters: action,
      getSubIssueFilters: action,
    });

    // root store
    this.subIssueStore = subIssueStore;
  }

  /**
   * @description This method is used to get the sub issue filters
   * @param workItemId
   * @returns
   */
  getSubIssueFilters = (workItemId: string) => {
    if (!this.subIssueFilters[workItemId]) {
      this.initializeFilters(workItemId);
    }
    return this.subIssueFilters[workItemId];
  };

  /**
   * @description This method is used to initialize the sub issue filters
   * @param workItemId
   */
  initializeFilters = (workItemId: string) => {
    set(this.subIssueFilters, [workItemId, "displayProperties"], DEFAULT_DISPLAY_PROPERTIES);
    set(this.subIssueFilters, [workItemId, "filters"], {});
    set(this.subIssueFilters, [workItemId, "displayFilters"], {});
  };

  /**
   * @description This method updates filters for sub issues.
   * @param filterType
   * @param filters
   */
  updateSubWorkItemFilters = (
    filterType: EIssueFilterType,
    filters: IIssueDisplayFilterOptions | IIssueDisplayProperties | IIssueFilterOptions,
    workItemId: string
  ) => {
    runInAction(() => {
      updateSubWorkItemFilters(this.subIssueFilters, filterType, filters, workItemId);
    });
  };

  /**
   * @description This method is used to get the grouped sub work items
   * @param parentWorkItemId
   * @returns
   */
  getGroupedSubWorkItems = computedFn((parentWorkItemId: string) => {
    const subIssueFilters = this.getSubIssueFilters(parentWorkItemId);

    const filteredWorkItems = this.getFilteredSubWorkItems(parentWorkItemId, subIssueFilters.filters ?? {});

    // get group by and order by
    const groupByKey = subIssueFilters.displayFilters?.group_by;
    const orderByKey = subIssueFilters.displayFilters?.order_by;

    const groupedWorkItemIds = getGroupedWorkItemIds(filteredWorkItems, groupByKey, orderByKey);

    return groupedWorkItemIds;
  });

  /**
   * @description This method is used to get the filtered sub work items
   * @param workItemId
   * @returns
   */
  getFilteredSubWorkItems = computedFn((workItemId: string, filters: IIssueFilterOptions) => {
    const subIssueIds = this.subIssueStore.subIssuesByIssueId(workItemId);
    const workItems = this.subIssueStore.rootIssueDetailStore.rootIssueStore.issues.getIssuesByIds(
      subIssueIds,
      "un-archived"
    );

    const filteredWorkItems = getFilteredWorkItems(workItems, filters);

    return filteredWorkItems;
  });

  /**
   * @description This method is used to reset the filters
   * @param workItemId
   */
  resetFilters = (workItemId: string) => {
    this.initializeFilters(workItemId);
  };
}
