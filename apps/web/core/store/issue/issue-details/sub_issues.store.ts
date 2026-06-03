/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for sub-issue trees on the issue-detail page — per-parent sub-issue id lists,
 * state-distribution buckets (used by the progress widget), upload helpers for visibility/loading state,
 * and cross-project property prefetching. Owns the paired `WorkItemSubIssueFiltersStore` via the
 * `filters` field.
 *
 * State slice:
 * - subIssuesStateDistribution: TIssueSubIssuesStateDistributionMap — per-parent state-group buckets
 *   ({ backlog: ids[], unstarted: ids[], started: ids[], completed: ids[], cancelled: ids[] }) — drives
 *   the progress widget on the issue-detail page.
 * - subIssues: TIssueSubIssuesIdMap — per-parent ordered lists of sub-issue ids.
 * - subIssueHelpers: Record<parentIssueId, { issue_visibility, preview_loader, issue_loader }> — UI-state
 *   buckets so each parent can independently toggle preview/visibility/loading per sub-issue id.
 * - loader: TLoader — global loader flag set to "init-loader" during fetchSubIssues and cleared after.
 * - filters: paired IWorkItemSubIssueFiltersStore (constructed inline) that owns the per-work-item
 *   filter/display configuration.
 *
 * Actions:
 * - setSubIssueHelpers(parentIssueId, key, value): toggles a single id in/out of one of the three
 *   helper buckets — used by the UI to track which sub-issues are open/previewing/loading.
 * - fetchSubIssues(workspaceSlug, projectId, parentIssueId): GET via IssueService.subIssues; seeds the
 *   shared issue cache via `rootIssueStore.issues.addIssue`, populates state-distribution buckets, writes
 *   the per-parent id list, denormalizes the new `sub_issues_count` onto the parent issue, and triggers
 *   `fetchOtherProjectProperties` when any sub-issue belongs to a different project.
 * - createSubIssues(workspaceSlug, projectId, parentIssueId, issueIds): POST via IssueService.addSubIssues;
 *   appends ids to the parent's bucket and state-distribution buckets, prefetches other-project
 *   properties when relevant, and updates the denormalized `sub_issues_count` directly on the parent.
 * - updateSubIssue(workspaceSlug, projectId, parentIssueId, issueId, issueData, oldIssue?, fromModal?):
 *   delegates the patch to `rootIssueStore.projectIssues.updateIssue` (unless invoked from a modal that
 *   already saved), then reconciles parent-id changes and state-group transitions in the
 *   state-distribution buckets so the progress widget stays accurate.
 * - removeSubIssue(workspaceSlug, projectId, parentIssueId, issueId): detaches the sub-issue by setting
 *   `parent_id: null` on the underlying issue, pulls it from both the id list and the state-distribution
 *   bucket, and decrements the parent's `sub_issues_count`.
 * - deleteSubIssue(workspaceSlug, projectId, parentIssueId, issueId): hard-deletes the underlying issue
 *   via `rootIssueStore.projectIssues.removeIssue` and applies the same state-distribution cleanup.
 * - fetchOtherProjectProperties(workspaceSlug, projectIds): when sub-issues span multiple projects this
 *   warms states/members/labels/cycles/modules/estimates for each foreign project id so the sub-issue
 *   widget can render those columns without per-row fetches.
 *
 * Computed helpers (computedFn):
 * - subIssuesByIssueId(issueId): recomputes when this parent's sub-issue id list changes.
 *
 * Helper queries: stateDistributionByIssueId, subIssueHelpersByIssueId.
 *
 * Service: backed by IssueService constructed with the parent IssueDetail's `serviceType` so the same
 * implementation serves both issues and epics (epics also use sub-issue trees).
 *
 * Consumers: sub-issue widgets under apps/web/core/components/issues/issue-detail/** and
 * apps/web/core/components/issues/issue-detail-widgets/sub-work-items/**, accessed via
 * apps/web/core/hooks/store/use-issue-detail.ts.
 *
 * Note on dual storage: the sub-issue count is denormalized onto the parent issue's `sub_issues_count` in
 * `rootIssueStore.issues` so list/board widgets can render the count badge without consulting this store.
 */

import { pull, concat, uniq, set, update } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// Plane Imports
import type {
  TIssue,
  TIssueSubIssues,
  TIssueSubIssuesStateDistributionMap,
  TIssueSubIssuesIdMap,
  TSubIssuesStateDistribution,
  TIssueServiceType,
  TLoader,
} from "@plane/types";
// services
import { IssueService } from "@/services/issue";
// store
import type { IIssueDetail } from "./root.store";
import type { IWorkItemSubIssueFiltersStore } from "./sub_issues_filter.store";
import { WorkItemSubIssueFiltersStore } from "./sub_issues_filter.store";

export interface IIssueSubIssuesStoreActions {
  fetchSubIssues: (workspaceSlug: string, projectId: string, parentIssueId: string) => Promise<TIssueSubIssues>;
  createSubIssues: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueIds: string[]
  ) => Promise<void>;
  updateSubIssue: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue?: Partial<TIssue>,
    fromModal?: boolean
  ) => Promise<void>;
  removeSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
  deleteSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
}

type TSubIssueHelpersKeys = "issue_visibility" | "preview_loader" | "issue_loader";
type TSubIssueHelpers = Record<TSubIssueHelpersKeys, string[]>;
export interface IIssueSubIssuesStore extends IIssueSubIssuesStoreActions {
  // observables
  subIssuesStateDistribution: TIssueSubIssuesStateDistributionMap;
  subIssues: TIssueSubIssuesIdMap;
  subIssueHelpers: Record<string, TSubIssueHelpers>; // parent_issue_id -> TSubIssueHelpers
  loader: TLoader;
  filters: IWorkItemSubIssueFiltersStore;
  // helper methods
  stateDistributionByIssueId: (issueId: string) => TSubIssuesStateDistribution | undefined;
  subIssuesByIssueId: (issueId: string) => string[] | undefined;
  subIssueHelpersByIssueId: (issueId: string) => TSubIssueHelpers;
  // actions
  fetchOtherProjectProperties: (workspaceSlug: string, projectIds: string[]) => Promise<void>;
  setSubIssueHelpers: (parentIssueId: string, key: TSubIssueHelpersKeys, value: string) => void;
}

export class IssueSubIssuesStore implements IIssueSubIssuesStore {
  // observables
  subIssuesStateDistribution: TIssueSubIssuesStateDistributionMap = {};
  subIssues: TIssueSubIssuesIdMap = {};
  subIssueHelpers: Record<string, TSubIssueHelpers> = {};
  loader: TLoader = undefined;

  filters: IWorkItemSubIssueFiltersStore;
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  serviceType;
  issueService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      subIssuesStateDistribution: observable,
      subIssues: observable,
      subIssueHelpers: observable,
      loader: observable.ref,
      // actions
      setSubIssueHelpers: action,
      fetchSubIssues: action,
      createSubIssues: action,
      updateSubIssue: action,
      removeSubIssue: action,
      deleteSubIssue: action,
      fetchOtherProjectProperties: action,
    });
    this.filters = new WorkItemSubIssueFiltersStore(this);
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.serviceType = serviceType;
    this.issueService = new IssueService(serviceType);
  }

  // helper methods
  stateDistributionByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.subIssuesStateDistribution[issueId] ?? undefined;
  };

  subIssuesByIssueId = computedFn((issueId: string) => this.subIssues[issueId]);

  subIssueHelpersByIssueId = (issueId: string) => ({
    preview_loader: this.subIssueHelpers?.[issueId]?.preview_loader || [],
    issue_visibility: this.subIssueHelpers?.[issueId]?.issue_visibility || [],
    issue_loader: this.subIssueHelpers?.[issueId]?.issue_loader || [],
  });

  // actions
  setSubIssueHelpers = (parentIssueId: string, key: TSubIssueHelpersKeys, value: string) => {
    if (!parentIssueId || !key || !value) return;

    update(this.subIssueHelpers, [parentIssueId, key], (_subIssueHelpers: string[] = []) => {
      if (_subIssueHelpers.includes(value)) return pull(_subIssueHelpers, value);
      return concat(_subIssueHelpers, value);
    });
  };

  fetchSubIssues = async (workspaceSlug: string, projectId: string, parentIssueId: string) => {
    this.loader = "init-loader";
    const response = await this.issueService.subIssues(workspaceSlug, projectId, parentIssueId);

    const subIssuesStateDistribution = response?.state_distribution ?? {};

    const issueList = (response.sub_issues ?? []) as TIssue[];

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue(issueList);

    // fetch other issues states and members when sub-issues are from different project
    if (issueList && issueList.length > 0) {
      const otherProjectIds = uniq(
        issueList.map((issue) => issue.project_id).filter((id) => !!id && id !== projectId)
      ) as string[];
      this.fetchOtherProjectProperties(workspaceSlug, otherProjectIds);
    }
    if (issueList) {
      this.rootIssueDetailStore.rootIssueStore.issues.updateIssue(parentIssueId, {
        sub_issues_count: issueList.length,
      });
    }

    runInAction(() => {
      set(this.subIssuesStateDistribution, parentIssueId, subIssuesStateDistribution);
      set(
        this.subIssues,
        parentIssueId,
        issueList.map((issue) => issue.id)
      );
    });

    this.loader = undefined;
    return response;
  };

  createSubIssues = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueIds: string[]) => {
    const response = await this.issueService.addSubIssues(workspaceSlug, projectId, parentIssueId, {
      sub_issue_ids: issueIds,
    });

    const subIssuesStateDistribution = response?.state_distribution;
    const subIssues = response.sub_issues as TIssue[];

    // fetch other issues states and members when sub-issues are from different project
    if (subIssues && subIssues.length > 0) {
      const otherProjectIds = uniq(
        subIssues.map((issue) => issue.project_id).filter((id) => !!id && id !== projectId)
      ) as string[];
      this.fetchOtherProjectProperties(workspaceSlug, otherProjectIds);
    }

    runInAction(() => {
      Object.keys(subIssuesStateDistribution).forEach((key) => {
        const stateGroup = key as keyof TSubIssuesStateDistribution;
        update(this.subIssuesStateDistribution, [parentIssueId, stateGroup], (stateDistribution) => {
          if (!stateDistribution) return subIssuesStateDistribution[stateGroup];
          return concat(stateDistribution, subIssuesStateDistribution[stateGroup]);
        });
      });

      const issueIds = subIssues.map((issue) => issue.id);
      update(this.subIssues, [parentIssueId], (issues) => {
        if (!issues) return issueIds;
        return concat(issues, issueIds);
      });
    });

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue(subIssues);

    // update sub-issues_count of the parent issue
    set(
      this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
      [parentIssueId, "sub_issues_count"],
      this.subIssues[parentIssueId].length
    );

    return;
  };

  updateSubIssue = async (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue: Partial<TIssue> = {},
    fromModal: boolean = false
  ) => {
    if (!fromModal)
      await this.rootIssueDetailStore.rootIssueStore.projectIssues.updateIssue(
        workspaceSlug,
        projectId,
        issueId,
        issueData
      );

    // parent update
    if (issueData.hasOwnProperty("parent_id") && issueData.parent_id !== oldIssue.parent_id) {
      runInAction(() => {
        if (oldIssue.parent_id) pull(this.subIssues[oldIssue.parent_id], issueId);
        if (issueData.parent_id)
          set(this.subIssues, [issueData.parent_id], concat(this.subIssues[issueData.parent_id], issueId));
      });
    }

    // state update
    if (issueData.hasOwnProperty("state_id") && issueData.state_id !== oldIssue.state_id) {
      let oldIssueStateGroup: string | undefined = undefined;
      let issueStateGroup: string | undefined = undefined;

      if (oldIssue.state_id) {
        const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(oldIssue.state_id);
        if (state?.group) oldIssueStateGroup = state.group;
      }

      if (issueData.state_id) {
        const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issueData.state_id);
        if (state?.group) issueStateGroup = state.group;
      }

      if (oldIssueStateGroup && issueStateGroup && issueStateGroup !== oldIssueStateGroup) {
        runInAction(() => {
          if (oldIssueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, oldIssueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });

          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return [issueId];
              return concat(stateDistribution, issueId);
            });
        });
      }
    }

    return;
  };

  removeSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.projectIssues.updateIssue(workspaceSlug, projectId, issueId, {
      parent_id: null,
    });

    const issue = this.rootIssueDetailStore.issue.getIssueById(issueId);
    if (issue && issue.state_id) {
      let issueStateGroup: string | undefined = undefined;
      const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issue.state_id);
      if (state?.group) issueStateGroup = state.group;

      if (issueStateGroup) {
        runInAction(() => {
          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });
        });
      }
    }

    runInAction(() => {
      pull(this.subIssues[parentIssueId], issueId);
      // update sub-issues_count of the parent issue
      set(
        this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
        [parentIssueId, "sub_issues_count"],
        this.subIssues[parentIssueId]?.length
      );
    });

    return;
  };

  deleteSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.projectIssues.removeIssue(workspaceSlug, projectId, issueId);

    const issue = this.rootIssueDetailStore.issue.getIssueById(issueId);
    if (issue && issue.state_id) {
      let issueStateGroup: string | undefined = undefined;
      const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issue.state_id);
      if (state?.group) issueStateGroup = state.group;

      if (issueStateGroup) {
        runInAction(() => {
          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });
        });
      }
    }

    runInAction(() => {
      pull(this.subIssues[parentIssueId], issueId);
      // update sub-issues_count of the parent issue
      set(
        this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
        [parentIssueId, "sub_issues_count"],
        this.subIssues[parentIssueId]?.length
      );
    });

    return;
  };

  fetchOtherProjectProperties = async (workspaceSlug: string, projectIds: string[]) => {
    if (projectIds.length > 0) {
      for (const projectId of projectIds) {
        // fetching other project states
        this.rootIssueDetailStore.rootIssueStore.rootStore.state.fetchProjectStates(workspaceSlug, projectId);
        // fetching other project members
        this.rootIssueDetailStore.rootIssueStore.rootStore.memberRoot.project.fetchProjectMembers(
          workspaceSlug,
          projectId
        );
        // fetching other project labels
        this.rootIssueDetailStore.rootIssueStore.rootStore.label.fetchProjectLabels(workspaceSlug, projectId);
        // fetching other project cycles
        this.rootIssueDetailStore.rootIssueStore.rootStore.cycle.fetchAllCycles(workspaceSlug, projectId);
        // fetching other project modules
        this.rootIssueDetailStore.rootIssueStore.rootStore.module.fetchModules(workspaceSlug, projectId);
        // fetching other project estimates
        this.rootIssueDetailStore.rootIssueStore.rootStore.projectEstimate.getProjectEstimates(
          workspaceSlug,
          projectId
        );
      }
    }
  };
}
