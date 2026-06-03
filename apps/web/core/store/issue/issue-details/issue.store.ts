/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-detail `IssueStore` — fetch-by-id / fetch-by-identifier and detail-level mutations. The store does
 * not own the issue cache itself (which lives in `rootIssueStore.issues`); it orchestrates a single
 * detail-page load and then hydrates all sibling stores (reactions, attachments, links, subscription,
 * activity, comments, sub-issues, relations) so the issue-detail page is fully populated in one round-trip
 * surface.
 *
 * State slice:
 * - fetchingIssueDetails: id of the issue currently being fetched (or undefined when idle) — used by
 *   `getIsFetchingIssueDetails` to drive per-issue loading spinners.
 *
 * Actions:
 * - fetchIssue(workspaceSlug, projectId, issueId): GET via IssueService.retrieve with
 *   `expand=issue_reactions,issue_attachments,issue_link,parent`. Writes a pruned `issuePayload` (whitelisted
 *   fields only — see `addIssueToStore`) into the shared issue cache so unrelated keys cannot leak into the
 *   normalized cache, then hydrates the sibling reaction/link/attachment stores from the embedded payload,
 *   triggers subscription bootstrap, kicks off activity/comments/sub-issues/relations fetches, and warms
 *   project states. The parent issue is also fetched if `issue.parent` is present and refreshes the
 *   shared cache.
 * - fetchIssueWithIdentifier(workspaceSlug, projectIdentifier, sequenceId): GET via
 *   IssueService.retrieveWithIdentifier (resolves `${projectIdentifier}-${sequenceId}` to an issue uuid),
 *   registers the identifier→id mapping in the shared cache, and otherwise behaves like fetchIssue. If
 *   `issue.is_epic` is true the hydration is routed through `rootIssueStore.epicDetail` instead of
 *   `issueDetail` so the right detail composition is populated.
 * - addIssueToStore(issue): whitelists the fields the issue-detail page cares about and writes the pruned
 *   payload into the shared issue cache. Clearing `fetchingIssueDetails` here marks the load complete.
 * - updateIssue(workspaceSlug, projectId, issueId, data): delegates to
 *   `rootIssueStore.projectIssues.updateIssue` (or `projectEpics.updateIssue` when `serviceType === EPICS`)
 *   AND refreshes the activity feed in parallel so the audit trail stays current.
 * - removeIssue / archiveIssue: delegate to the appropriate project store (issues vs. epics) based on
 *   serviceType.
 * - addCycleToIssue / addIssueToCycle / removeIssueFromCycle: delegate to `rootIssueStore.cycleIssues` and
 *   refresh activity.
 * - changeModulesInIssue / removeIssueFromModule: delegate to `rootIssueStore.moduleIssues` and refresh activity.
 *
 * Computed helpers (computedFn):
 * - getIsFetchingIssueDetails(issueId): true iff `fetchingIssueDetails === issueId`.
 * - getIssueById(issueId): proxies to `rootIssueStore.issues.getIssueById`.
 * - getIssueIdByIdentifier(issueIdentifier): proxies to `rootIssueStore.issues.getIssueIdByIdentifier`.
 *
 * Services:
 * - issueService: IssueService(serviceType) — primary detail fetcher; works for both issues and epics.
 * - epicService: IssueService(EIssueServiceType.EPICS) — explicitly constructed for cross-cutting epic flows.
 * - issueArchiveService: IssueArchiveService(serviceType) — archive endpoints.
 * - draftWorkItemService: WorkspaceDraftService — draft work-item endpoints.
 *
 * Consumers: this is the orchestration entry point for every issue-detail load — used by
 * apps/web/core/hooks/store/use-issue-detail.ts, every component under
 * apps/web/core/components/issues/issue-detail/**, apps/web/core/components/issues/issue-detail-widgets/**,
 * and apps/web/core/components/issues/peek-overview/**.
 */

import { makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { IssueArchiveService, WorkspaceDraftService, IssueService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export interface IIssueStoreActions {
  // actions
  fetchIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  removeIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addCycleToIssue: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  addIssueToCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => Promise<void>;
  removeIssueFromCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  changeModulesInIssue: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => Promise<void>;
  removeIssueFromModule: (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => Promise<void>;
  fetchIssueWithIdentifier: (workspaceSlug: string, project_identifier: string, sequence_id: string) => Promise<TIssue>;
}

export interface IIssueStore extends IIssueStoreActions {
  getIsFetchingIssueDetails: (issueId: string | undefined) => boolean;
  // helper methods
  getIssueById: (issueId: string) => TIssue | undefined;
  getIssueIdByIdentifier: (issueIdentifier: string) => string | undefined;
}

export class IssueStore implements IIssueStore {
  fetchingIssueDetails: string | undefined = undefined;
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  serviceType;
  issueService;
  epicService;
  issueArchiveService;
  draftWorkItemService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      fetchingIssueDetails: observable.ref,
    });
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.serviceType = serviceType;
    this.issueService = new IssueService(serviceType);
    this.epicService = new IssueService(EIssueServiceType.EPICS);
    this.issueArchiveService = new IssueArchiveService(serviceType);
    this.draftWorkItemService = new WorkspaceDraftService();
  }

  getIsFetchingIssueDetails = computedFn((issueId: string | undefined) => {
    if (!issueId) return false;

    return this.fetchingIssueDetails === issueId;
  });

  // helper methods
  getIssueById = computedFn((issueId: string) => {
    if (!issueId) return undefined;
    return this.rootIssueDetailStore.rootIssueStore.issues.getIssueById(issueId) ?? undefined;
  });

  getIssueIdByIdentifier = computedFn((issueIdentifier: string) => {
    if (!issueIdentifier) return undefined;
    return this.rootIssueDetailStore.rootIssueStore.issues.getIssueIdByIdentifier(issueIdentifier) ?? undefined;
  });

  // actions
  fetchIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const query = {
      expand: "issue_reactions,issue_attachments,issue_link,parent",
    };

    this.fetchingIssueDetails = issueId;
    const issue = await this.issueService.retrieve(workspaceSlug, projectId, issueId, query);

    if (!issue) throw new Error("Work item not found");

    const issuePayload = this.addIssueToStore(issue);

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue([issuePayload]);

    // store handlers from issue detail
    // parent
    if (issue && issue?.parent && issue?.parent?.id && issue?.parent?.project_id) {
      this.issueService.retrieve(workspaceSlug, issue.parent.project_id, issue?.parent?.id).then((res) => {
        this.rootIssueDetailStore.rootIssueStore.issues.addIssue([res]);
      });
    }
    // assignees
    // labels
    // state

    // issue reactions
    if (issue.issue_reactions) this.rootIssueDetailStore.addReactions(issueId, issue.issue_reactions);

    // fetch issue links
    if (issue.issue_link) this.rootIssueDetailStore.addLinks(issueId, issue.issue_link);

    // fetch issue attachments
    if (issue.issue_attachments) this.rootIssueDetailStore.addAttachments(issueId, issue.issue_attachments);

    this.rootIssueDetailStore.addSubscription(issueId, issue.is_subscribed);

    // fetch issue activity
    this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);

    // fetch issue comments
    this.rootIssueDetailStore.comment.fetchComments(workspaceSlug, projectId, issueId);

    // fetch sub issues
    this.rootIssueDetailStore.subIssues.fetchSubIssues(workspaceSlug, projectId, issueId);

    // fetch issue relations
    this.rootIssueDetailStore.relation.fetchRelations(workspaceSlug, projectId, issueId);

    // fetching states
    // TODO: check if this function is required
    this.rootIssueDetailStore.rootIssueStore.rootStore.state.fetchProjectStates(workspaceSlug, projectId);

    return issue;
  };

  addIssueToStore = (issue: TIssue) => {
    const issuePayload: TIssue = {
      id: issue?.id,
      sequence_id: issue?.sequence_id,
      name: issue?.name,
      description_html: issue?.description_html,
      sort_order: issue?.sort_order,
      state_id: issue?.state_id,
      priority: issue?.priority,
      label_ids: issue?.label_ids,
      assignee_ids: issue?.assignee_ids,
      estimate_point: issue?.estimate_point,
      sub_issues_count: issue?.sub_issues_count,
      attachment_count: issue?.attachment_count,
      link_count: issue?.link_count,
      project_id: issue?.project_id,
      parent_id: issue?.parent_id,
      cycle_id: issue?.cycle_id,
      module_ids: issue?.module_ids,
      type_id: issue?.type_id,
      created_at: issue?.created_at,
      updated_at: issue?.updated_at,
      start_date: issue?.start_date,
      target_date: issue?.target_date,
      completed_at: issue?.completed_at,
      archived_at: issue?.archived_at,
      created_by: issue?.created_by,
      updated_by: issue?.updated_by,
      is_draft: issue?.is_draft,
      is_subscribed: issue?.is_subscribed,
      is_epic: issue?.is_epic,
    };

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue([issuePayload]);
    this.fetchingIssueDetails = undefined;

    return issuePayload;
  };

  updateIssue = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;

    await Promise.all([
      currentStore.updateIssue(workspaceSlug, projectId, issueId, data),
      this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId),
    ]);
  };

  removeIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;
    currentStore.removeIssue(workspaceSlug, projectId, issueId);
  };

  archiveIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;
    currentStore.archiveIssue(workspaceSlug, projectId, issueId);
  };

  addCycleToIssue = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.cycleIssues.addCycleToIssue(
      workspaceSlug,
      projectId,
      cycleId,
      issueId
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };

  addIssueToCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => {
    await this.rootIssueDetailStore.rootIssueStore.cycleIssues.addIssueToCycle(
      workspaceSlug,
      projectId,
      cycleId,
      issueIds,
      false
    );
    if (issueIds && issueIds.length > 0)
      await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueIds[0]);
  };

  removeIssueFromCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
    const cycle = await this.rootIssueDetailStore.rootIssueStore.cycleIssues.removeIssueFromCycle(
      workspaceSlug,
      projectId,
      cycleId,
      issueId
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return cycle;
  };

  changeModulesInIssue = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => {
    await this.rootIssueDetailStore.rootIssueStore.moduleIssues.changeModulesInIssue(
      workspaceSlug,
      projectId,
      issueId,
      addModuleIds,
      removeModuleIds
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };

  removeIssueFromModule = async (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => {
    const currentModule = await this.rootIssueDetailStore.rootIssueStore.moduleIssues.removeIssuesFromModule(
      workspaceSlug,
      projectId,
      moduleId,
      [issueId]
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return currentModule;
  };

  fetchIssueWithIdentifier = async (workspaceSlug: string, project_identifier: string, sequence_id: string) => {
    const query = {
      expand: "issue_reactions,issue_attachments,issue_link,parent",
    };
    const issue = await this.issueService.retrieveWithIdentifier(workspaceSlug, project_identifier, sequence_id, query);
    const issueIdentifier = `${project_identifier}-${sequence_id}`;
    const issueId = issue?.id;
    const projectId = issue?.project_id;
    const rootWorkItemDetailStore = issue?.is_epic
      ? this.rootIssueDetailStore.rootIssueStore.epicDetail
      : this.rootIssueDetailStore.rootIssueStore.issueDetail;

    if (!issue || !projectId || !issueId) throw new Error("Issue not found");

    const issuePayload = this.addIssueToStore(issue);
    this.rootIssueDetailStore.rootIssueStore.issues.addIssue([issuePayload]);

    // handle parent issue if exists
    if (issue?.parent && issue?.parent?.id && issue?.parent?.project_id) {
      this.issueService.retrieve(workspaceSlug, issue.parent.project_id, issue.parent.id).then((res) => {
        this.rootIssueDetailStore.rootIssueStore.issues.addIssue([res]);
      });
    }

    // add identifiers to map
    rootWorkItemDetailStore.rootIssueStore.issues.addIssueIdentifier(issueIdentifier, issueId);

    // add related data
    if (issue.issue_reactions) rootWorkItemDetailStore.addReactions(issue.id, issue.issue_reactions);
    if (issue.issue_link) rootWorkItemDetailStore.addLinks(issue.id, issue.issue_link);
    if (issue.issue_attachments) rootWorkItemDetailStore.addAttachments(issue.id, issue.issue_attachments);
    rootWorkItemDetailStore.addSubscription(issue.id, issue.is_subscribed);

    // fetch related data
    // issue reactions
    if (issue.issue_reactions) rootWorkItemDetailStore.addReactions(issueId, issue.issue_reactions);

    // fetch issue links
    if (issue.issue_link) rootWorkItemDetailStore.addLinks(issueId, issue.issue_link);

    // fetch issue attachments
    if (issue.issue_attachments) rootWorkItemDetailStore.addAttachments(issueId, issue.issue_attachments);

    rootWorkItemDetailStore.addSubscription(issueId, issue.is_subscribed);

    // fetch issue activity
    rootWorkItemDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);

    // fetch issue comments
    rootWorkItemDetailStore.comment.fetchComments(workspaceSlug, projectId, issueId);

    // fetch sub issues
    rootWorkItemDetailStore.subIssues.fetchSubIssues(workspaceSlug, projectId, issueId);

    // fetch issue relations
    rootWorkItemDetailStore.relation.fetchRelations(workspaceSlug, projectId, issueId);

    // fetching states
    // TODO: check if this function is required
    rootWorkItemDetailStore.rootIssueStore.rootStore.state.fetchProjectStates(workspaceSlug, projectId);

    return issue;
  };
}
