/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Modal orchestrator for the issue-detail widgets feature. Owns the conditional
 * render decisions and lifecycle handlers for the link-create/update modal, the
 * sub-issue create modal, the existing-sub-issue picker, and the relation
 * existing-issue picker. Mutations are delegated to helper hooks; this component
 * only coordinates open/close state and post-action store cleanup.
 *
 * Rendered purpose:
 *   Mount the modal layer above the issue-detail widget strip and surface the
 *   correct modal based on MobX widget state (link / sub-issue / relation) +
 *   the `hideWidgets` allow-list. Renders nothing visible when no modal is open.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `isIssueLinkModalOpen` — boolean controlling the link create/update modal.
 *   - `toggleIssueLinkModal`, `setIssueLinkData` — link modal close + data reset.
 *   - `isCreateIssueModalOpen`, `toggleCreateIssueModal` — sub-issue create modal.
 *   - `isSubIssuesModalOpen`, `toggleSubIssuesModal` — existing-sub-issue picker.
 *   - `relationKey`, `isRelationModalOpen`, `setRelationKey`, `toggleRelationModal`, `createRelation` — relation modal + mutation.
 *   - `setLastWidgetAction` — records the last widget action so the toolbar can highlight it after a modal closes.
 *   - `issueCrudOperationState`, `setIssueCrudOperationState` — composite CRUD state for create/existing sub-issue flows.
 *
 * Side effects:
 *   - Calls `subIssueOperations.addSubIssue(workspaceSlug, projectId, parentIssueId, issueIds[])` from `./sub-issues/helper` — POSTs to the issue service to attach sub-issues.
 *   - Calls `handleLinkOperations` (returned by `./links/helper`) — wraps `IssueLinkService` create/update/delete operations.
 *   - Calls `createRelation(workspaceSlug, projectId, issueId, relationKey, ids[])` — POSTs to the issue-relation service.
 *   - Emits `setToast({ type: TOAST_TYPE.ERROR, ... })` from `@plane/propel/toast` when relation submit receives an empty selection.
 *   - On every modal close, resets relevant store fields (`setLastWidgetAction`, `setIssueLinkData`, `setRelationKey`, `setIssueCrudOperationState`) so the next open starts from a clean slate.
 *   - Renders `WorkItemAdditionalWidgetModals` from `@/plane-web/components/issues/issue-detail-widgets/modals` to compose any additional plane-web modals.
 */

import React from "react";
import { observer } from "mobx-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse, TIssue, TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web imports
import { WorkItemAdditionalWidgetModals } from "@/plane-web/components/issues/issue-detail-widgets/modals";
// local imports
import { IssueLinkCreateUpdateModal } from "../issue-detail/links/create-update-link-modal";
// helpers
import { CreateUpdateIssueModal } from "../issue-modal/modal";
import { useLinkOperations } from "./links/helper";
import { useSubIssueOperations } from "./sub-issues/helper";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

/**
 * MobX `observer` component that renders the active widget modal (link, sub-issue,
 * relation) for the issue-detail page. Hidden widgets are filtered via `hideWidgets`.
 *
 * @param props.workspaceSlug - Workspace slug from the route.
 * @param props.projectId - UUID of the project that owns the issue.
 * @param props.issueId - UUID of the work item whose widget modals are being managed.
 * @param props.issueServiceType - Discriminator for the issue service variant; selects which issue-detail store + service is consulted.
 * @param props.hideWidgets - Optional list of widgets to suppress; when a key is present, the corresponding modal is never rendered.
 */
export const IssueDetailWidgetModals = observer(function IssueDetailWidgetModals(props: Props) {
  const { workspaceSlug, projectId, issueId, issueServiceType, hideWidgets } = props;
  // store hooks
  const {
    isIssueLinkModalOpen,
    toggleIssueLinkModal: toggleIssueLinkModalStore,
    setIssueLinkData,
    isCreateIssueModalOpen,
    toggleCreateIssueModal,
    isSubIssuesModalOpen,
    toggleSubIssuesModal,
    relationKey,
    isRelationModalOpen,
    setRelationKey,
    setLastWidgetAction,
    toggleRelationModal,
    createRelation,
    issueCrudOperationState,
    setIssueCrudOperationState,
  } = useIssueDetail(issueServiceType);

  // helper hooks
  const subIssueOperations = useSubIssueOperations(issueServiceType);
  const handleLinkOperations = useLinkOperations(workspaceSlug, projectId, issueId, issueServiceType);

  // handlers
  /** Toggles the create-vs-existing sub-issue panel and records the parent issue id (plus the optional `TIssue` payload consumed by the create-modal body). */
  const handleIssueCrudState = (
    key: "create" | "existing",
    _parentIssueId: string | null,
    issue: TIssue | null = null
  ) => {
    setIssueCrudOperationState({
      ...issueCrudOperationState,
      [key]: {
        toggle: !issueCrudOperationState[key].toggle,
        parentIssueId: _parentIssueId,
        issue: issue,
      },
    });
  };

  const handleExistingIssuesModalClose = () => {
    handleIssueCrudState("existing", null, null);
    setLastWidgetAction("sub-work-items");
    toggleSubIssuesModal(null);
  };

  const handleExistingIssuesModalOnSubmit = async (_issue: ISearchIssueResponse[]) =>
    subIssueOperations.addSubIssue(
      workspaceSlug,
      projectId,
      issueId,
      _issue.map((issue) => issue.id)
    );

  const handleCreateUpdateModalClose = () => {
    handleIssueCrudState("create", null, null);
    toggleCreateIssueModal(false);
    setLastWidgetAction("sub-work-items");
  };

  const handleCreateUpdateModalOnSubmit = async (_issue: TIssue) => {
    if (_issue.parent_id) {
      await subIssueOperations.addSubIssue(workspaceSlug, projectId, _issue.parent_id, [_issue.id]);
    }
  };

  const handleIssueLinkModalOnClose = () => {
    toggleIssueLinkModalStore(false);
    setLastWidgetAction("links");
    setIssueLinkData(null);
  };

  const handleRelationOnClose = () => {
    setRelationKey(null);
    toggleRelationModal(null, null);
    setLastWidgetAction("relations");
  };

  /** Guards the relation POST: a missing `relationKey` makes the relation type ambiguous, and an empty selection short-circuits with a toast rather than emitting an empty request to the relation API. */
  const handleExistingIssueModalOnSubmit = async (data: ISearchIssueResponse[]) => {
    if (!relationKey) return;
    if (data.length === 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: "Please select at least one work item.",
      });
      return;
    }

    await createRelation(
      workspaceSlug,
      projectId,
      issueId,
      relationKey,
      data.map((i) => i.id)
    );

    toggleRelationModal(null, null);
  };

  // helpers
  const createUpdateModalData: Partial<TIssue> = {
    parent_id: issueCrudOperationState?.create?.parentIssueId,
    project_id: projectId,
  };

  const existingIssuesModalSearchParams = {
    sub_issue: true,
    issue_id: issueCrudOperationState?.existing?.parentIssueId,
  };

  // render conditions
  /** Both sub-issue modals additionally require a populated `parentIssueId` — otherwise the modal body would render with ambiguous inputs (no parent to attach to, no draft to seed). */
  const shouldRenderExistingIssuesModal =
    !hideWidgets?.includes("sub-work-items") &&
    issueCrudOperationState?.existing?.toggle &&
    issueCrudOperationState?.existing?.parentIssueId &&
    isSubIssuesModalOpen;

  const shouldRenderCreateUpdateModal =
    !hideWidgets?.includes("sub-work-items") &&
    issueCrudOperationState?.create?.toggle &&
    issueCrudOperationState?.create?.parentIssueId &&
    isCreateIssueModalOpen;

  return (
    <>
      {!hideWidgets?.includes("links") && (
        <IssueLinkCreateUpdateModal
          isModalOpen={isIssueLinkModalOpen}
          handleOnClose={handleIssueLinkModalOnClose}
          linkOperations={handleLinkOperations}
          issueServiceType={issueServiceType}
        />
      )}

      {shouldRenderCreateUpdateModal && (
        <CreateUpdateIssueModal
          isOpen={issueCrudOperationState?.create?.toggle}
          data={createUpdateModalData}
          onClose={handleCreateUpdateModalClose}
          onSubmit={handleCreateUpdateModalOnSubmit}
          isProjectSelectionDisabled
        />
      )}

      {shouldRenderExistingIssuesModal && (
        <ExistingIssuesListModal
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          isOpen={issueCrudOperationState?.existing?.toggle}
          handleClose={handleExistingIssuesModalClose}
          searchParams={existingIssuesModalSearchParams}
          handleOnSubmit={handleExistingIssuesModalOnSubmit}
        />
      )}

      {!hideWidgets?.includes("relations") && (
        <ExistingIssuesListModal
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          isOpen={isRelationModalOpen?.issueId === issueId && isRelationModalOpen?.relationType === relationKey}
          handleClose={handleRelationOnClose}
          searchParams={{ issue_relation: true, issue_id: issueId }}
          handleOnSubmit={handleExistingIssueModalOnSubmit}
          workspaceLevelToggle
        />
      )}

      <WorkItemAdditionalWidgetModals
        hideWidgets={hideWidgets ?? []}
        issueServiceType={issueServiceType}
        projectId={projectId}
        workItemId={issueId}
        workspaceSlug={workspaceSlug}
      />
    </>
  );
});
