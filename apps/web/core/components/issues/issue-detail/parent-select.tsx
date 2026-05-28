/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Parent assignment selector for the issue detail sidebar.
 *
 * Rendered purpose: a button-like row that opens the `ParentIssuesListModal` for picking a parent
 * work item. When the issue already has a parent, displays the parent's `IssueIdentifier` badge
 * (linkified to the parent issue) with an inline remove affordance; otherwise shows an "Add parent"
 * placeholder. An edit pencil icon appears on hover when not disabled.
 *
 * Props (TIssueParentSelect):
 *   - className (string, optional, default=""): wrapper class overrides
 *   - disabled (boolean, optional, default=false): suppresses interactivity (modal cannot open,
 *     remove affordance hidden, cursor changes to `not-allowed`)
 *   - issueId (string, required): the work item being assigned a parent
 *   - projectId (string, required): scopes the parent picker
 *   - workspaceSlug (string, required): scopes the parent picker
 *   - handleParentIssue ((issueId?: string | null) => Promise<void>, required): called with the
 *     picked parent id; clearing the parent is the caller's responsibility (typically resolves to a
 *     `PATCH /issues/<id>/ { parent_id: null }` via the issue-detail store action)
 *   - handleRemoveSubIssue ((workspaceSlug, projectId, parentIssueId, issueId) => Promise<void>, required):
 *     invoked when the user clicks the inline `X` next to the current parent badge — this calls the
 *     parent's sub-issue remove endpoint (DELETE on the parent, not on the current issue)
 *   - workItemLink (string, required): the URL for the linkified parent badge (pre-built by the
 *     caller via `generateWorkItemLink`)
 *
 * MobX stores read:
 *   - `useProject()` — `getProjectById` for resolving the parent's project identifier
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` for the current issue,
 *     `getIssueById(issue.parent_id)` for the parent snapshot, `isParentIssueModalOpen`, and
 *     `toggleParentIssueModal(...)`
 *
 * Side effects:
 *   - Toggles the parent-issue modal via `toggleParentIssueModal(issue.id)` / `toggleParentIssueModal(null)`.
 *   - Delegates the actual parent assignment / removal to the caller-supplied async handlers.
 *   - No direct service calls or toasts in this file.
 *
 * Imperative DOM/event notes:
 *   - The parent badge `<Link>` uses `e.stopPropagation()` to prevent the outer button's
 *     `toggleParentIssueModal` handler from firing on link click — preserve this exactly.
 *   - The remove `X` uses both `preventDefault()` AND `stopPropagation()` for the same reason.
 *   - The parent badge opens in a new tab (`target="_blank" rel="noopener noreferrer"`).
 *
 * Derived state notes:
 *   - `isParentIssueModalOpen === issueId` is the per-issue gate so two parent selectors on the
 *     same page (e.g., main + peek) do not share modal state.
 *   - Returns `<></>` early if the current issue cannot be resolved.
 *
 * Consumers: rendered by `./sidebar.tsx` (`IssueDetailsSidebar`) and the peek-overview
 * properties panel as the parent-work-item assignment affordance.
 */

import React from "react";
import { observer } from "mobx-react";
import Link from "next/link";

import { useTranslation } from "@plane/i18n";
import { EditIcon, CloseIcon } from "@plane/propel/icons";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// local imports
import { ParentIssuesListModal } from "../parent-issues-list-modal";

type TIssueParentSelect = {
  className?: string;
  disabled?: boolean;
  issueId: string;
  projectId: string;
  workspaceSlug: string;
  handleParentIssue: (_issueId?: string | null) => Promise<void>;
  handleRemoveSubIssue: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string
  ) => Promise<void>;
  workItemLink: string;
};

export const IssueParentSelect = observer(function IssueParentSelect(props: TIssueParentSelect) {
  const {
    className = "",
    disabled = false,
    issueId,
    projectId,
    workspaceSlug,
    handleParentIssue,
    handleRemoveSubIssue,
    workItemLink,
  } = props;
  const { t } = useTranslation();
  // store hooks
  const { getProjectById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { isParentIssueModalOpen, toggleParentIssueModal } = useIssueDetail();

  // derived values
  const issue = getIssueById(issueId);
  const parentIssue = issue?.parent_id ? getIssueById(issue.parent_id) : undefined;
  const parentIssueProjectDetails =
    parentIssue && parentIssue.project_id ? getProjectById(parentIssue.project_id) : undefined;
  const { isMobile } = usePlatformOS();

  if (!issue) return <></>;

  return (
    <>
      <ParentIssuesListModal
        projectId={projectId}
        issueId={issueId}
        isOpen={isParentIssueModalOpen === issueId}
        handleClose={() => toggleParentIssueModal(null)}
        onChange={(issue: any) => handleParentIssue(issue?.id)}
      />
      <button
        type="button"
        className={cn(
          "group flex items-center justify-between gap-2 rounded-sm px-2 py-0.5 outline-none",
          {
            "cursor-not-allowed": disabled,
            "hover:bg-layer-transparent-hover": !disabled,
            "bg-layer-transparent-selected": isParentIssueModalOpen,
          },
          className
        )}
        onClick={() => toggleParentIssueModal(issue.id)}
        disabled={disabled}
      >
        {issue.parent_id && parentIssue ? (
          <div className="flex items-center gap-1.5">
            <Tooltip tooltipHeading="Title" tooltipContent={parentIssue.name} isMobile={isMobile}>
              <Link href={workItemLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                {parentIssue?.project_id && parentIssueProjectDetails && (
                  <IssueIdentifier
                    projectId={parentIssue.project_id}
                    issueTypeId={parentIssue.type_id}
                    projectIdentifier={parentIssueProjectDetails?.identifier}
                    issueSequenceId={parentIssue.sequence_id}
                    size="xs"
                    variant="secondary"
                  />
                )}
              </Link>
            </Tooltip>

            {!disabled && (
              <Tooltip tooltipContent={t("common.remove")} position="bottom" isMobile={isMobile}>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveSubIssue(workspaceSlug, projectId, parentIssue.id, issueId);
                  }}
                >
                  <CloseIcon className="h-2.5 w-2.5 text-tertiary hover:text-danger-primary" />
                </span>
              </Tooltip>
            )}
          </div>
        ) : (
          <span className="text-body-xs-medium text-placeholder">{t("issue.add.parent")}</span>
        )}
        {!disabled && (
          <span
            className={cn("flex-shrink-0 p-1 opacity-0 group-hover:opacity-100", {
              "text-placeholder": !issue.parent_id && !parentIssue,
            })}
          >
            <EditIcon className="h-2.5 w-2.5 flex-shrink-0" />
          </span>
        )}
      </button>
    </>
  );
});
