/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders a single related-issue row inside `RelationIssueList`, including the identifier badge, the
 * tooltip-wrapped title, the inline `RelationIssueProperty` editor (state/priority/assignees), and the
 * `CustomMenu` overflow menu wiring the per-row actions edit, copy-link, remove-relation, and delete.
 *
 * Rendered purpose: resolves the related issue from the issue-detail store, builds the canonical
 * work-item link via `generateWorkItemLink`, and surfaces both the click-to-peek interaction
 * (epic-aware) and a destructive-actions menu whose mutating items are gated on `!disabled` so that
 * copy-link remains usable in read-only contexts.
 *
 * Required props:
 *   - workspaceSlug (string): identifies the workspace; forwarded to redirection, `removeRelation`,
 *     and the work-item link builder.
 *   - issueId (string): the parent issue id that OWNS the relation — NOT the related issue this row
 *     represents. Used as the host id when invoking `removeRelation` and when lifting CRUD intent via
 *     `handleIssueCrudState`.
 *   - relationKey (TIssueRelationTypes from `@/plane-web/types`): the relation taxonomy (e.g.
 *     blocking, blocked_by, duplicate, relates_to); forwarded to `removeRelation` and
 *     `handleIssueCrudState`.
 *   - relationIssueId (string): id of the related issue this row represents. Used to look up the issue
 *     in the issue-detail store and as the target for the edit and delete modals.
 *   - disabled (boolean): when true, the edit, remove-relation, and delete menu items are hidden;
 *     copy-link remains available. The `Props` type marks this required but the destructure defaults
 *     it to `false` for callers that omit it.
 *   - handleIssueCrudState ((key: "update" | "delete" | "removeRelation", issueId, issue?,
 *     relationKey?, relationIssueId?) => void): parent-supplied callback that lifts CRUD intent so the
 *     parent can coordinate modal state with this row.
 *
 * Optional props:
 *   - issueServiceType (TIssueServiceType, default `EIssueServiceType.ISSUES`): routes
 *     `useIssueDetail` to either the work-item issue-detail store (`ISSUES`) or the epic issue-detail
 *     store (`EPICS`), so this single row component drives both surfaces.
 *
 * MobX stores read (via `observer`):
 *   - useIssueDetail(issueServiceType) — destructures `issue.getIssueById(relationIssueId)` to read
 *     the related issue plus the actions `removeRelation`, `toggleCreateIssueModal`, and
 *     `toggleDeleteIssueModal`. The `issueServiceType` argument selects between the work-item and
 *     epic issue-detail stores.
 *   - useProject() — `project.getProjectById(issue.project_id)` resolves the related issue's project
 *     identifier so the work-item URL can carry the `<IDENTIFIER>-<SEQUENCE>` suffix used in
 *     `generateWorkItemLink`.
 *
 * Non-store hooks:
 *   - useIssuePeekOverviewRedirection(!!issue?.is_epic) — epic-aware redirection helper that returns
 *     `handleRedirection` (peek-overview for work items, route-aware navigation for epics).
 *   - usePlatformOS() — exposes `isMobile` for tooltip rendering and redirection divergence.
 *   - useRelationOperations(EPICS | ISSUES based on `issue.is_epic`) — supplies the
 *     `{ copyLink, update, remove }` operations from
 *     `apps/web/core/components/issues/issue-detail-widgets/relations/helper.tsx`. Only `copyLink` is
 *     consumed directly here; `update` and `remove` are forwarded to the child
 *     `RelationIssueProperty`. The service-type selection controls the entity label ("Work item" vs.
 *     "Epic") used in toast messages.
 *
 * Side effects:
 *   - Mutations:
 *       - `removeRelation(workspaceSlug, projectId, issueId, relationKey, relationIssueId)` — MobX
 *         action on the issue-detail store that fans out to `IssueRelationService` (see
 *         `apps/web/core/services/issue/`).
 *       - `toggleCreateIssueModal(true)` — opens the edit modal via the issue-detail store.
 *       - `toggleDeleteIssueModal(relationIssueId)` — opens the delete-confirm modal via the
 *         issue-detail store.
 *       - `handleIssueCrudState("update" | "delete" | "removeRelation", ...)` — lifts CRUD intent into
 *         parent state so the parent's modal stack can react.
 *   - Navigations:
 *       - Epic rows: `window.open(workItemLink, "_blank")` — epics live under a different route shell
 *         (React Router v7) and are opened in a new tab on click instead of the peek-overview pane.
 *       - Work-item rows: `handleRedirection(workspaceSlug, issue, isMobile)` opens the peek-overview
 *         pane (or full-page route on mobile, per `usePlatformOS`).
 *   - API calls (indirect via `issueOperations`):
 *       - `copyLink(workItemLink)` — writes the canonical URL to the clipboard via
 *         `copyUrlToClipboard` (`@plane/utils`) and emits a success toast.
 *   - Toasts: success/error toasts are emitted from inside `useRelationOperations` via
 *     `@plane/propel/toast`.
 *
 * Render gating: returns an empty fragment if either the related issue or its `project_id` cannot be
 * resolved from the issue-detail / project stores (guards against the deletion-vs-render race that
 * can occur immediately after a successful remove).
 */

import React from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, EditIcon, TrashIcon, CloseIcon } from "@plane/propel/icons";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { ControlLink, CustomMenu } from "@plane/ui";
import { generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import type { TIssueRelationTypes } from "@/plane-web/types";
// local imports
import { useRelationOperations } from "../issue-detail-widgets/relations/helper";
import { RelationIssueProperty } from "./properties";

type Props = {
  workspaceSlug: string;
  issueId: string;
  relationKey: TIssueRelationTypes;
  relationIssueId: string;
  disabled: boolean;
  handleIssueCrudState: (
    key: "update" | "delete" | "removeRelation",
    issueId: string,
    issue?: TIssue | null,
    relationKey?: TIssueRelationTypes | null,
    relationIssueId?: string | null
  ) => void;
  issueServiceType?: TIssueServiceType;
};

export const RelationIssueListItem = observer(function RelationIssueListItem(props: Props) {
  const {
    workspaceSlug,
    issueId,
    relationKey,
    relationIssueId,
    disabled = false,
    handleIssueCrudState,
    issueServiceType = EIssueServiceType.ISSUES,
  } = props;

  const { t } = useTranslation();

  // store hooks
  const {
    issue: { getIssueById },
    removeRelation,
    toggleCreateIssueModal,
    toggleDeleteIssueModal,
  } = useIssueDetail(issueServiceType);
  const project = useProject();
  const { isMobile } = usePlatformOS();
  // derived values
  const issue = getIssueById(relationIssueId);
  const { handleRedirection } = useIssuePeekOverviewRedirection(!!issue?.is_epic);
  const issueOperations = useRelationOperations(issue?.is_epic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const projectDetail = (issue && issue.project_id && project.getProjectById(issue.project_id)) || undefined;
  const projectId = issue?.project_id;

  if (!issue || !projectId) return <></>;

  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug.toString(),
    projectId: issue?.project_id,
    issueId: issue?.id,
    projectIdentifier: projectDetail?.identifier,
    sequenceId: issue?.sequence_id,
    isEpic: issue?.is_epic,
  });

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) => {
    if (issue.is_epic) {
      // open epics in new tab
      window.open(workItemLink, "_blank");
      return;
    }
    handleRedirection(workspaceSlug, issue, isMobile);
  };

  const handleEditIssue = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    handleIssueCrudState("update", relationIssueId, { ...issue });
    toggleCreateIssueModal(true);
  };

  const handleDeleteIssue = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    handleIssueCrudState("delete", relationIssueId, issue);
    toggleDeleteIssueModal(relationIssueId);
    handleIssueCrudState("removeRelation", issueId, issue, relationKey, relationIssueId);
  };

  const handleCopyIssueLink = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    issueOperations.copyLink(workItemLink);
  };

  const handleRemoveRelation = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    removeRelation(workspaceSlug, projectId, issueId, relationKey, relationIssueId);
  };

  return (
    <div key={relationIssueId}>
      <ControlLink
        id={`issue-${issue.id}`}
        href={workItemLink}
        onClick={() => handleIssuePeekOverview(issue)}
        className="w-full cursor-pointer"
      >
        {issue && (
          <div className="group relative flex h-full min-h-11 w-full items-center px-1.5 py-1 transition-all hover:bg-surface-2">
            <span className="size-5 flex-shrink-0" />
            <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <div className="flex-shrink-0">
                {projectDetail && (
                  <IssueIdentifier
                    projectId={projectDetail.id}
                    issueTypeId={issue.type_id}
                    projectIdentifier={projectDetail.identifier}
                    issueSequenceId={issue.sequence_id}
                    size="xs"
                    variant="secondary"
                  />
                )}
              </div>

              <Tooltip tooltipContent={issue.name} isMobile={isMobile}>
                <span className="w-0 flex-1 truncate text-13 text-primary">{issue.name}</span>
              </Tooltip>
            </div>
            <div
              className="flex-shrink-0 text-13"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <RelationIssueProperty
                workspaceSlug={workspaceSlug}
                issueId={relationIssueId}
                disabled={disabled}
                issueOperations={issueOperations}
                issueServiceType={issueServiceType}
              />
            </div>
            <div className="flex-shrink-0 pl-2 text-13">
              <CustomMenu placement="bottom-end" ellipsis>
                {!disabled && (
                  <CustomMenu.MenuItem onClick={handleEditIssue}>
                    <div className="flex items-center gap-2">
                      <EditIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{t("common.actions.edit")}</span>
                    </div>
                  </CustomMenu.MenuItem>
                )}

                <CustomMenu.MenuItem onClick={handleCopyIssueLink}>
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{t("common.actions.copy_link")}</span>
                  </div>
                </CustomMenu.MenuItem>

                {!disabled && (
                  <CustomMenu.MenuItem onClick={handleRemoveRelation}>
                    <div className="flex items-center gap-2">
                      <CloseIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{t("common.actions.remove_relation")}</span>
                    </div>
                  </CustomMenu.MenuItem>
                )}

                {!disabled && (
                  <CustomMenu.MenuItem onClick={handleDeleteIssue}>
                    <div className="flex items-center gap-2">
                      <TrashIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{t("common.actions.delete")}</span>
                    </div>
                  </CustomMenu.MenuItem>
                )}
              </CustomMenu>
            </div>
          </div>
        )}
      </ControlLink>
    </div>
  );
});
