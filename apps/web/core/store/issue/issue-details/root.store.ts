/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition root for the issue-detail MobX subsystem — defines the `IIssueDetail` contract, the modal/peek
 * UI state observables, and the abstract `IssueDetail` class that wires together every nested store
 * (`issue`, `reaction`, `attachment`, `activity`, `comment`, `commentReaction`, `subIssues`, `link`,
 * `subscription`, `relation`). Every detail-level operation routes through this facade so the
 * issue-detail UI can treat the entire subsystem as one cohesive API.
 *
 * Service-type indirection (critical):
 * The constructor takes the parent `IIssueRootStore` and a `TIssueServiceType` (EIssueServiceType.ISSUES
 * | EPICS) so the same composition powers BOTH the issue-detail surface and the epic-detail surface.
 * The concrete subclasses are instantiated in `apps/web/core/store/issue/root.store.ts` as
 * `issueDetail = new IssueDetail(rootStore, EIssueServiceType.ISSUES)` and
 * `epicDetail = new IssueDetail(rootStore, EIssueServiceType.EPICS)`. Every nested store receives the
 * same `serviceType` so DRF endpoint routing (issues vs. epics) is consistent across the whole subsystem.
 *
 * Module-level type aliases:
 * - TPeekIssue: { workspaceSlug, projectId, issueId, nestingLevel?, isArchived? } — describes the issue
 *   currently shown in the peek overlay.
 * - TIssueRelationModal: { issueId | null, relationType | null } — drives the add-relation modal.
 * - TIssueCrudState: { toggle, parentIssueId?, issue? } — generic create/existing-issue modal state.
 * - TIssueCrudOperationState: { create: TIssueCrudState, existing: TIssueCrudState } — two-bucket
 *   create-vs-link-existing modal state for the sub-issue / parent-issue flows.
 *
 * State slice (UI observables on `IssueDetail`):
 * - peekIssue: TPeekIssue | undefined — the issue currently mounted in the peek overlay.
 * - relationKey: TIssueRelationTypes | null — the relation flavor currently being added.
 * - issueLinkData: TIssueLink | null — the link entity being edited (modal target).
 * - issueCrudOperationState: TIssueCrudOperationState — paired create/existing modal state.
 * - openWidgets: TWorkItemWidgets[] — which detail widgets (sub-work-items, links, attachments, …) are
 *   expanded; initialized to ["sub-work-items", "links", "attachments"].
 * - lastWidgetAction: TWorkItemWidgets | null — last widget the user interacted with (used by focus management).
 * - isCreateIssueModalOpen: boolean — generic create-issue modal toggle.
 * - isIssueLinkModalOpen: boolean — add-link modal toggle.
 * - isParentIssueModalOpen / isDeleteIssueModalOpen / isArchiveIssueModalOpen / isSubIssuesModalOpen /
 *   attachmentDeleteModalId: string | null — each holds the issue id (or attachment id) that the
 *   corresponding modal is operating on; `null` means closed.
 * - isRelationModalOpen: TIssueRelationModal | null — open + relation type tuple.
 *
 * Computed:
 * - isAnyModalOpen: true iff any modal observable is currently set; used to suppress global keyboard
 *   shortcuts when a detail modal is open.
 * - isPeekOpen: true iff peekIssue is set.
 *
 * Helper actions:
 * - getIsIssuePeeked(issueId): true iff `peekIssue.issueId === issueId`.
 *
 * Actions (setters / toggles):
 * setRelationKey, setIssueCrudOperationState, setPeekIssue, toggleCreateIssueModal, toggleIssueLinkModal,
 * toggleParentIssueModal, toggleDeleteIssueModal, toggleArchiveIssueModal, toggleRelationModal,
 * toggleSubIssuesModal, toggleDeleteAttachmentModal, setOpenWidgets, setLastWidgetAction, toggleOpenWidget,
 * setIssueLinkData.
 *
 * Delegated operation actions:
 * Every operation defined in one of the nested store interfaces is re-exported on the root and forwards to
 * the corresponding nested store: issue.* (fetchIssue, fetchIssueWithIdentifier, updateIssue, removeIssue,
 * archiveIssue, addCycleToIssue, addIssueToCycle, removeIssueFromCycle, changeModulesInIssue,
 * removeIssueFromModule), reaction.* (addReactions, fetchReactions, createReaction, removeReaction),
 * attachment.* (addAttachments, fetchAttachments, createAttachment, removeAttachment),
 * link.* (addLinks, fetchLinks, createLink, updateLink, removeLink),
 * subIssues.* (fetchSubIssues, createSubIssues, updateSubIssue, removeSubIssue, deleteSubIssue),
 * subscription.* (addSubscription, fetchSubscriptions, createSubscription, removeSubscription),
 * relation.* (fetchRelations, createRelation, removeRelation), activity.fetchActivities,
 * comment.* (fetchComments, createComment, updateComment, removeComment),
 * commentReaction.* (fetchCommentReactions, applyCommentReactions, createCommentReaction,
 * removeCommentReaction). This delegation pattern is why the UI never imports the nested stores directly —
 * everything routes through one facade.
 *
 * Nested stores constructed in the constructor (in this exact order):
 * - issue: IssueStore(this, serviceType)
 * - reaction: IssueReactionStore(this, serviceType)
 * - attachment: IssueAttachmentStore(rootStore, serviceType)  // receives the OUTER root, not `this`
 * - activity: IssueActivityStore(rootStore.rootStore, serviceType)  // receives the application-wide root
 * - comment: IssueCommentStore(this, serviceType)
 * - commentReaction: IssueCommentReactionStore(this)
 * - subIssues: IssueSubIssuesStore(this, serviceType)
 * - link: IssueLinkStore(this, serviceType)
 * - subscription: IssueSubscriptionStore(this, serviceType)
 * - relation: IssueRelationStore(this)
 *
 * Consumers: every component under apps/web/core/components/issues/issue-detail/**,
 * apps/web/core/components/issues/issue-detail-widgets/**, apps/web/core/components/issues/peek-overview/**,
 * apps/web/core/components/issues/relations/**, and apps/web/core/components/issues/attachment/**,
 * accessed via the `apps/web/core/hooks/store/use-issue-detail.ts` hook.
 */

import { action, computed, makeObservable, observable } from "mobx";
// types
import type {
  TIssue,
  TIssueAttachment,
  TIssueComment,
  TIssueCommentReaction,
  TIssueLink,
  TIssueReaction,
  TIssueServiceType,
  TWorkItemWidgets,
} from "@plane/types";
// plane web store
import { IssueActivityStore } from "@/plane-web/store/issue/issue-details/activity.store";
import type {
  IIssueActivityStore,
  IIssueActivityStoreActions,
  TActivityLoader,
} from "@/plane-web/store/issue/issue-details/activity.store";
import type { TIssueRelationTypes } from "@/plane-web/types";
import type { IIssueRootStore } from "../root.store";
import { IssueAttachmentStore } from "./attachment.store";
import type { IIssueAttachmentStore, IIssueAttachmentStoreActions } from "./attachment.store";
import { IssueCommentStore } from "./comment.store";
import type { IIssueCommentStore, IIssueCommentStoreActions, TCommentLoader } from "./comment.store";
import { IssueCommentReactionStore } from "./comment_reaction.store";
import type { IIssueCommentReactionStore, IIssueCommentReactionStoreActions } from "./comment_reaction.store";
import { IssueStore } from "./issue.store";
import type { IIssueStore, IIssueStoreActions } from "./issue.store";
import { IssueLinkStore } from "./link.store";
import type { IIssueLinkStore, IIssueLinkStoreActions } from "./link.store";
import { IssueReactionStore } from "./reaction.store";
import type { IIssueReactionStore, IIssueReactionStoreActions } from "./reaction.store";
import { IssueRelationStore } from "./relation.store";
import type { IIssueRelationStore, IIssueRelationStoreActions } from "./relation.store";
import { IssueSubIssuesStore } from "./sub_issues.store";
import type { IIssueSubIssuesStore, IIssueSubIssuesStoreActions } from "./sub_issues.store";
import { IssueSubscriptionStore } from "./subscription.store";
import type { IIssueSubscriptionStore, IIssueSubscriptionStoreActions } from "./subscription.store";

export type TPeekIssue = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  nestingLevel?: number;
  isArchived?: boolean;
};

export type TIssueRelationModal = {
  issueId: string | null;
  relationType: TIssueRelationTypes | null;
};

export type TIssueCrudState = { toggle: boolean; parentIssueId: string | undefined; issue: TIssue | undefined };

export type TIssueCrudOperationState = {
  create: TIssueCrudState;
  existing: TIssueCrudState;
};

export interface IIssueDetail
  extends
    IIssueStoreActions,
    IIssueReactionStoreActions,
    IIssueLinkStoreActions,
    IIssueSubIssuesStoreActions,
    IIssueSubscriptionStoreActions,
    IIssueAttachmentStoreActions,
    IIssueRelationStoreActions,
    IIssueActivityStoreActions,
    IIssueCommentStoreActions,
    IIssueCommentReactionStoreActions {
  // observables
  peekIssue: TPeekIssue | undefined;
  relationKey: TIssueRelationTypes | null;
  issueLinkData: TIssueLink | null;
  issueCrudOperationState: TIssueCrudOperationState;
  openWidgets: TWorkItemWidgets[];
  lastWidgetAction: TWorkItemWidgets | null;
  isCreateIssueModalOpen: boolean;
  isIssueLinkModalOpen: boolean;
  isParentIssueModalOpen: string | null;
  isDeleteIssueModalOpen: string | null;
  isArchiveIssueModalOpen: string | null;
  isRelationModalOpen: TIssueRelationModal | null;
  isSubIssuesModalOpen: string | null;
  attachmentDeleteModalId: string | null;
  // computed
  isAnyModalOpen: boolean;
  isPeekOpen: boolean;
  // helper actions
  getIsIssuePeeked: (issueId: string) => boolean;
  // actions
  setPeekIssue: (peekIssue: TPeekIssue | undefined) => void;
  setIssueLinkData: (issueLinkData: TIssueLink | null) => void;
  toggleCreateIssueModal: (value: boolean) => void;
  toggleIssueLinkModal: (value: boolean) => void;
  toggleParentIssueModal: (issueId: string | null) => void;
  toggleDeleteIssueModal: (issueId: string | null) => void;
  toggleArchiveIssueModal: (value: string | null) => void;
  toggleRelationModal: (issueId: string | null, relationType: TIssueRelationTypes | null) => void;
  toggleSubIssuesModal: (value: string | null) => void;
  toggleDeleteAttachmentModal: (attachmentId: string | null) => void;
  setOpenWidgets: (state: TWorkItemWidgets[]) => void;
  setLastWidgetAction: (action: TWorkItemWidgets) => void;
  toggleOpenWidget: (state: TWorkItemWidgets) => void;
  setRelationKey: (relationKey: TIssueRelationTypes | null) => void;
  setIssueCrudOperationState: (state: TIssueCrudOperationState) => void;
  // store
  rootIssueStore: IIssueRootStore;
  issue: IIssueStore;
  reaction: IIssueReactionStore;
  attachment: IIssueAttachmentStore;
  activity: IIssueActivityStore;
  comment: IIssueCommentStore;
  commentReaction: IIssueCommentReactionStore;
  subIssues: IIssueSubIssuesStore;
  link: IIssueLinkStore;
  subscription: IIssueSubscriptionStore;
  relation: IIssueRelationStore;
}

export abstract class IssueDetail implements IIssueDetail {
  // observables
  peekIssue: TPeekIssue | undefined = undefined;
  relationKey: TIssueRelationTypes | null = null;
  issueLinkData: TIssueLink | null = null;
  issueCrudOperationState: TIssueCrudOperationState = {
    create: {
      toggle: false,
      parentIssueId: undefined,
      issue: undefined,
    },
    existing: {
      toggle: false,
      parentIssueId: undefined,
      issue: undefined,
    },
  };
  openWidgets: TWorkItemWidgets[] = ["sub-work-items", "links", "attachments"];
  lastWidgetAction: TWorkItemWidgets | null = null;
  isCreateIssueModalOpen: boolean = false;
  isIssueLinkModalOpen: boolean = false;
  isParentIssueModalOpen: string | null = null;
  isDeleteIssueModalOpen: string | null = null;
  isArchiveIssueModalOpen: string | null = null;
  isRelationModalOpen: TIssueRelationModal | null = null;
  isSubIssuesModalOpen: string | null = null;
  attachmentDeleteModalId: string | null = null;
  // service type
  serviceType: TIssueServiceType;
  // store
  rootIssueStore: IIssueRootStore;
  issue: IIssueStore;
  reaction: IIssueReactionStore;
  attachment: IIssueAttachmentStore;
  subIssues: IIssueSubIssuesStore;
  link: IIssueLinkStore;
  subscription: IIssueSubscriptionStore;
  relation: IIssueRelationStore;
  activity: IIssueActivityStore;
  comment: IIssueCommentStore;
  commentReaction: IIssueCommentReactionStore;

  constructor(rootStore: IIssueRootStore, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      peekIssue: observable,
      relationKey: observable,
      issueLinkData: observable,
      issueCrudOperationState: observable,
      isCreateIssueModalOpen: observable,
      isIssueLinkModalOpen: observable.ref,
      isParentIssueModalOpen: observable.ref,
      isDeleteIssueModalOpen: observable.ref,
      isArchiveIssueModalOpen: observable.ref,
      isRelationModalOpen: observable.ref,
      isSubIssuesModalOpen: observable.ref,
      attachmentDeleteModalId: observable.ref,
      openWidgets: observable.ref,
      lastWidgetAction: observable.ref,
      // computed
      isAnyModalOpen: computed,
      isPeekOpen: computed,
      // action
      setPeekIssue: action,
      setIssueLinkData: action,
      toggleCreateIssueModal: action,
      toggleIssueLinkModal: action,
      toggleParentIssueModal: action,
      toggleDeleteIssueModal: action,
      toggleArchiveIssueModal: action,
      toggleRelationModal: action,
      toggleSubIssuesModal: action,
      toggleDeleteAttachmentModal: action,
      setOpenWidgets: action,
      setLastWidgetAction: action,
      toggleOpenWidget: action,
      setRelationKey: action,
      setIssueCrudOperationState: action,
    });

    // store
    this.serviceType = serviceType;
    this.rootIssueStore = rootStore;
    this.issue = new IssueStore(this, serviceType);
    this.reaction = new IssueReactionStore(this, serviceType);
    this.attachment = new IssueAttachmentStore(rootStore, serviceType);
    this.activity = new IssueActivityStore(rootStore.rootStore, serviceType);
    this.comment = new IssueCommentStore(this, serviceType);
    this.commentReaction = new IssueCommentReactionStore(this);
    this.subIssues = new IssueSubIssuesStore(this, serviceType);
    this.link = new IssueLinkStore(this, serviceType);
    this.subscription = new IssueSubscriptionStore(this, serviceType);
    this.relation = new IssueRelationStore(this);
  }

  // computed
  get isAnyModalOpen() {
    return (
      this.isCreateIssueModalOpen ||
      this.isIssueLinkModalOpen ||
      !!this.isParentIssueModalOpen ||
      !!this.isDeleteIssueModalOpen ||
      !!this.isArchiveIssueModalOpen ||
      !!this.isRelationModalOpen?.issueId ||
      !!this.isSubIssuesModalOpen ||
      !!this.attachmentDeleteModalId
    );
  }

  get isPeekOpen() {
    return !!this.peekIssue;
  }

  // helper actions
  getIsIssuePeeked = (issueId: string) => this.peekIssue?.issueId === issueId;

  // actions
  setRelationKey = (relationKey: TIssueRelationTypes | null) => (this.relationKey = relationKey);
  setIssueCrudOperationState = (state: TIssueCrudOperationState) => (this.issueCrudOperationState = state);
  setPeekIssue = (peekIssue: TPeekIssue | undefined) => (this.peekIssue = peekIssue);
  toggleCreateIssueModal = (value: boolean) => (this.isCreateIssueModalOpen = value);
  toggleIssueLinkModal = (value: boolean) => (this.isIssueLinkModalOpen = value);
  toggleParentIssueModal = (issueId: string | null) => (this.isParentIssueModalOpen = issueId);
  toggleDeleteIssueModal = (issueId: string | null) => (this.isDeleteIssueModalOpen = issueId);
  toggleArchiveIssueModal = (issueId: string | null) => (this.isArchiveIssueModalOpen = issueId);
  toggleRelationModal = (issueId: string | null, relationType: TIssueRelationTypes | null) =>
    (this.isRelationModalOpen = { issueId, relationType });
  toggleSubIssuesModal = (issueId: string | null) => (this.isSubIssuesModalOpen = issueId);
  toggleDeleteAttachmentModal = (attachmentId: string | null) => (this.attachmentDeleteModalId = attachmentId);
  setOpenWidgets = (state: TWorkItemWidgets[]) => {
    this.openWidgets = state;
    if (this.lastWidgetAction) this.lastWidgetAction = null;
  };
  setLastWidgetAction = (action: TWorkItemWidgets) => {
    this.openWidgets = [action];
  };
  toggleOpenWidget = (state: TWorkItemWidgets) => {
    if (this.openWidgets && this.openWidgets.includes(state))
      this.openWidgets = this.openWidgets.filter((s) => s !== state);
    else this.openWidgets = [state, ...this.openWidgets];
  };
  setIssueLinkData = (issueLinkData: TIssueLink | null) => (this.issueLinkData = issueLinkData);

  // issue
  fetchIssue = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.issue.fetchIssue(workspaceSlug, projectId, issueId);
  fetchIssueWithIdentifier = async (workspaceSlug: string, projectIdentifier: string, sequenceId: string) =>
    this.issue.fetchIssueWithIdentifier(workspaceSlug, projectIdentifier, sequenceId);
  updateIssue = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) =>
    this.issue.updateIssue(workspaceSlug, projectId, issueId, data);
  removeIssue = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.issue.removeIssue(workspaceSlug, projectId, issueId);
  archiveIssue = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.issue.archiveIssue(workspaceSlug, projectId, issueId);
  addCycleToIssue = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) =>
    this.issue.addCycleToIssue(workspaceSlug, projectId, cycleId, issueId);
  addIssueToCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) =>
    this.issue.addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds);
  removeIssueFromCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) =>
    this.issue.removeIssueFromCycle(workspaceSlug, projectId, cycleId, issueId);
  changeModulesInIssue = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => this.issue.changeModulesInIssue(workspaceSlug, projectId, issueId, addModuleIds, removeModuleIds);
  removeIssueFromModule = async (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) =>
    this.issue.removeIssueFromModule(workspaceSlug, projectId, moduleId, issueId);

  // reactions
  addReactions = (issueId: string, reactions: TIssueReaction[]) => this.reaction.addReactions(issueId, reactions);
  fetchReactions = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.reaction.fetchReactions(workspaceSlug, projectId, issueId);
  createReaction = async (workspaceSlug: string, projectId: string, issueId: string, reaction: string) =>
    this.reaction.createReaction(workspaceSlug, projectId, issueId, reaction);
  removeReaction = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    reaction: string,
    userId: string
  ) => this.reaction.removeReaction(workspaceSlug, projectId, issueId, reaction, userId);

  // attachments
  addAttachments = (issueId: string, attachments: TIssueAttachment[]) =>
    this.attachment.addAttachments(issueId, attachments);
  fetchAttachments = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.attachment.fetchAttachments(workspaceSlug, projectId, issueId);
  createAttachment = async (workspaceSlug: string, projectId: string, issueId: string, file: File) =>
    this.attachment.createAttachment(workspaceSlug, projectId, issueId, file);
  removeAttachment = async (workspaceSlug: string, projectId: string, issueId: string, attachmentId: string) =>
    this.attachment.removeAttachment(workspaceSlug, projectId, issueId, attachmentId);

  // link
  addLinks = (issueId: string, links: TIssueLink[]) => this.link.addLinks(issueId, links);
  fetchLinks = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.link.fetchLinks(workspaceSlug, projectId, issueId);
  createLink = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueLink>) =>
    this.link.createLink(workspaceSlug, projectId, issueId, data);
  updateLink = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    linkId: string,
    data: Partial<TIssueLink>
  ) => this.link.updateLink(workspaceSlug, projectId, issueId, linkId, data);
  removeLink = async (workspaceSlug: string, projectId: string, issueId: string, linkId: string) =>
    this.link.removeLink(workspaceSlug, projectId, issueId, linkId);

  // sub issues
  fetchSubIssues = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.subIssues.fetchSubIssues(workspaceSlug, projectId, issueId);
  createSubIssues = async (workspaceSlug: string, projectId: string, parentIssueId: string, data: string[]) =>
    this.subIssues.createSubIssues(workspaceSlug, projectId, parentIssueId, data);
  updateSubIssue = async (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue?: Partial<TIssue>,
    fromModal?: boolean
  ) => this.subIssues.updateSubIssue(workspaceSlug, projectId, parentIssueId, issueId, issueData, oldIssue, fromModal);
  removeSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) =>
    this.subIssues.removeSubIssue(workspaceSlug, projectId, parentIssueId, issueId);
  deleteSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) =>
    this.subIssues.deleteSubIssue(workspaceSlug, projectId, parentIssueId, issueId);

  // subscription
  addSubscription = (issueId: string, isSubscribed: boolean | undefined | null) =>
    this.subscription.addSubscription(issueId, isSubscribed);
  fetchSubscriptions = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.subscription.fetchSubscriptions(workspaceSlug, projectId, issueId);
  createSubscription = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.subscription.createSubscription(workspaceSlug, projectId, issueId);
  removeSubscription = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.subscription.removeSubscription(workspaceSlug, projectId, issueId);

  // relations
  fetchRelations = async (workspaceSlug: string, projectId: string, issueId: string) =>
    this.relation.fetchRelations(workspaceSlug, projectId, issueId);
  createRelation = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    relationType: TIssueRelationTypes,
    issues: string[]
  ) => this.relation.createRelation(workspaceSlug, projectId, issueId, relationType, issues);
  removeRelation = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    relationType: TIssueRelationTypes,
    relatedIssue: string,
    updateLocally?: boolean
  ) => this.relation.removeRelation(workspaceSlug, projectId, issueId, relationType, relatedIssue, updateLocally);

  // activity
  fetchActivities = async (workspaceSlug: string, projectId: string, issueId: string, loaderType?: TActivityLoader) =>
    this.activity.fetchActivities(workspaceSlug, projectId, issueId, loaderType);

  // comment
  fetchComments = async (workspaceSlug: string, projectId: string, issueId: string, loaderType?: TCommentLoader) =>
    this.comment.fetchComments(workspaceSlug, projectId, issueId, loaderType);
  createComment = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueComment>) =>
    this.comment.createComment(workspaceSlug, projectId, issueId, data);
  updateComment = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => this.comment.updateComment(workspaceSlug, projectId, issueId, commentId, data);
  removeComment = async (workspaceSlug: string, projectId: string, issueId: string, commentId: string) =>
    this.comment.removeComment(workspaceSlug, projectId, issueId, commentId);

  // comment reaction
  fetchCommentReactions = async (workspaceSlug: string, projectId: string, commentId: string) =>
    this.commentReaction.fetchCommentReactions(workspaceSlug, projectId, commentId);
  applyCommentReactions = async (commentId: string, commentReactions: TIssueCommentReaction[]) =>
    this.commentReaction.applyCommentReactions(commentId, commentReactions);
  createCommentReaction = async (workspaceSlug: string, projectId: string, commentId: string, reaction: string) =>
    this.commentReaction.createCommentReaction(workspaceSlug, projectId, commentId, reaction);
  removeCommentReaction = async (
    workspaceSlug: string,
    projectId: string,
    commentId: string,
    reaction: string,
    userId: string
  ) => this.commentReaction.removeCommentReaction(workspaceSlug, projectId, commentId, reaction, userId);
}
