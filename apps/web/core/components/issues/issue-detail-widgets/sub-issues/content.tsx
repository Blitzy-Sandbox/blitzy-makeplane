/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssuesCollapsibleContent` — body of the sub-issues collapsible; owns local CRUD modal state (`create` / `existing` / `update` / `delete`),
 * fetches sub-work-items on mount (and on `parentIssueId` change), conditionally renders the grouped sub-issues list, and surfaces the
 * delete confirmation and create/update issue modals when the local CRUD state requests them.
 *
 * Props (Props):
 *   - workspaceSlug (string, required): Active workspace slug; forwarded to the sub-issue service calls and the list root.
 *   - projectId (string, required): Active project id; forwarded to service calls and the list root.
 *   - parentIssueId (string, required): Issue id whose sub-work-items are listed; serves as the root key for sub-issue helpers (`${parentIssueId}_root`).
 *   - disabled (boolean, required): When true, the rendered `SubIssuesListRoot` runs with `canEdit={false}`, hiding mutation affordances.
 *   - issueServiceType (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`): Selects the `issue-detail` store slice used by both this component and the operations hook.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `toggleCreateIssueModal(open)`: action — toggles the shared create/update issue modal flag in the store; invoked when the local update modal closes.
 *   - `toggleDeleteIssueModal(issueId | null)`: action — toggles the shared delete modal flag; invoked when the local delete modal closes.
 *   - `subIssues.subIssueHelpersByIssueId(helperKey)`: selector — returns the helper bag for a parent issue key (issue_visibility, preview_loader, issue_loader).
 *   - `subIssues.setSubIssueHelpers(helperKey, helperType, value)`: action — sets `preview_loader` while fetching and `issue_visibility` once data is loaded.
 *
 * Side effects:
 *   - On mount and whenever `parentIssueId` changes, calls `useSubIssueOperations(issueServiceType).fetchSubIssues(workspaceSlug, projectId, parentIssueId)` — issues an API request that hydrates the sub-issues slice and the state-distribution map.
 *   - Maintains a four-mode local CRUD state — `create` (new sub-work-item dialog), `existing` (attach-existing flow opens via title actions, not here), `update` (inline edit dialog), `delete` (confirm-remove dialog). The `existing` slot is allocated for parity with `quick-action-button.tsx`/`title-actions.tsx` but is only opened upstream; this component only owns `create` / `update` / `delete` dialogs.
 *   - The delete dialog `onSubmit` calls `subIssueOperations.deleteSubIssue(workspaceSlug, projectId, parentIssueId, issueId)` (full delete) and emits toasts on failure (via the operations hook).
 *   - The update dialog `onSubmit` calls `subIssueOperations.updateSubIssue(workspaceSlug, projectId, parentIssueId, issueId, issueData, oldIssue, fromModal=true)` and emits success/error toasts.
 *   - List rendering is gated on `subIssueHelpers.issue_visibility.includes(parentIssueId)` so the list only mounts after the initial fetch resolves.
 *
 * Consumers: rendered by `./root.tsx` (`IssueDetailWidgetCollapsibles`) inside the
 * issue-detail widget shell mounted by `issue-detail/main-content.tsx` and the
 * peek-overview body.
 */

import React, { useEffect, useState, useCallback } from "react";
import { observer } from "mobx-react";
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
// components
import { DeleteIssueModal } from "@/components/issues/delete-issue-modal";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import { useSubIssueOperations } from "./helper";
import { SubIssuesListRoot } from "./issues-list/root";

type Props = {
  workspaceSlug: string;
  projectId: string;
  parentIssueId: string;
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
};

type TIssueCrudState = { toggle: boolean; parentIssueId: string | undefined; issue: TIssue | undefined };

export const SubIssuesCollapsibleContent = observer(function SubIssuesCollapsibleContent(props: Props) {
  const { workspaceSlug, projectId, parentIssueId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  // state
  const [issueCrudState, setIssueCrudState] = useState<{
    create: TIssueCrudState;
    existing: TIssueCrudState;
    update: TIssueCrudState;
    delete: TIssueCrudState;
  }>({
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
    update: {
      toggle: false,
      parentIssueId: undefined,
      issue: undefined,
    },
    delete: {
      toggle: false,
      parentIssueId: undefined,
      issue: undefined,
    },
  });
  // store hooks
  const {
    toggleCreateIssueModal,
    toggleDeleteIssueModal,
    subIssues: { subIssueHelpersByIssueId, setSubIssueHelpers },
  } = useIssueDetail(issueServiceType);

  // helpers
  const subIssueOperations = useSubIssueOperations(issueServiceType);
  const subIssueHelpers = subIssueHelpersByIssueId(`${parentIssueId}_root`);

  // handler
  const handleIssueCrudState = useCallback(
    (key: "create" | "existing" | "update" | "delete", _parentIssueId: string | null, issue: TIssue | null = null) => {
      setIssueCrudState({
        ...issueCrudState,
        [key]: {
          toggle: !issueCrudState[key].toggle,
          parentIssueId: _parentIssueId,
          issue,
        },
      });
    },
    [issueCrudState]
  );

  const handleFetchSubIssues = useCallback(async () => {
    const currentSubIssueHelpers = subIssueHelpersByIssueId(`${parentIssueId}_root`);
    if (!currentSubIssueHelpers.issue_visibility.includes(parentIssueId)) {
      try {
        setSubIssueHelpers(`${parentIssueId}_root`, "preview_loader", parentIssueId);
        await subIssueOperations.fetchSubIssues(workspaceSlug, projectId, parentIssueId);
        setSubIssueHelpers(`${parentIssueId}_root`, "issue_visibility", parentIssueId);
      } catch (error) {
        console.error("Error fetching sub-work items:", error);
      } finally {
        setSubIssueHelpers(`${parentIssueId}_root`, "preview_loader", "");
      }
    }
  }, [parentIssueId, projectId, setSubIssueHelpers, subIssueHelpersByIssueId, subIssueOperations, workspaceSlug]);

  useEffect(() => {
    handleFetchSubIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentIssueId]);

  // render conditions
  const shouldRenderDeleteIssueModal =
    issueCrudState?.delete?.toggle &&
    issueCrudState?.delete?.issue &&
    issueCrudState.delete.parentIssueId &&
    issueCrudState.delete.issue.id;

  const shouldRenderUpdateIssueModal = issueCrudState?.update?.toggle && issueCrudState?.update?.issue;

  return (
    <>
      {subIssueHelpers.issue_visibility.includes(parentIssueId) && (
        <SubIssuesListRoot
          storeType={EIssuesStoreType.PROJECT}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          parentIssueId={parentIssueId}
          rootIssueId={parentIssueId}
          spacingLeft={6}
          canEdit={!disabled}
          handleIssueCrudState={handleIssueCrudState}
          subIssueOperations={subIssueOperations}
          issueServiceType={issueServiceType}
        />
      )}

      {shouldRenderDeleteIssueModal && (
        <DeleteIssueModal
          isOpen={issueCrudState?.delete?.toggle}
          handleClose={() => {
            handleIssueCrudState("delete", null, null);
            toggleDeleteIssueModal(null);
          }}
          data={issueCrudState?.delete?.issue as TIssue}
          onSubmit={async () =>
            await subIssueOperations.deleteSubIssue(
              workspaceSlug,
              projectId,
              issueCrudState?.delete?.parentIssueId as string,
              issueCrudState?.delete?.issue?.id as string
            )
          }
          isSubIssue
        />
      )}

      {shouldRenderUpdateIssueModal && (
        <CreateUpdateIssueModal
          isOpen={issueCrudState?.update?.toggle}
          onClose={() => {
            handleIssueCrudState("update", null, null);
            toggleCreateIssueModal(false);
          }}
          data={issueCrudState?.update?.issue ?? undefined}
          onSubmit={async (_issue: TIssue) => {
            await subIssueOperations.updateSubIssue(
              workspaceSlug,
              projectId,
              parentIssueId,
              _issue.id,
              _issue,
              issueCrudState?.update?.issue,
              true
            );
          }}
        />
      )}
    </>
  );
});
