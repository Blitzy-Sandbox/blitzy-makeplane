/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Relation-category selector for a work item (blocked-by, blocks, duplicate, relates-to, etc.).
 *
 * Rendered purpose: a chips-style row inside the issue detail relations widget that shows every
 * related issue for the given `relationKey`, supports per-chip remove, and opens an
 * `ExistingIssuesListModal` for adding new relations. The chip color and placeholder text are
 * sourced from `useTimeLineRelationOptions()`.
 *
 * Props (TIssueRelationSelect):
 *   - className (string, optional): wrapper class overrides
 *   - workspaceSlug (string, required): scopes the relation mutation
 *   - projectId (string, required): scopes the relation mutation
 *   - issueId (string, required): the work item whose relations are managed
 *   - relationKey (TIssueRelationTypes, required): the relation category (one of BLOCKED_BY,
 *     BLOCKING, DUPLICATE, RELATES_TO, ...) defined in `@/plane-web/types`
 *   - disabled (boolean, optional, default=false): suppresses interaction when true (chips still render)
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `createRelation`, `removeRelation`,
 *     `relation.getRelationByIssueIdRelationType(issueId, relationKey)`,
 *     `isRelationModalOpen`, `toggleRelationModal`
 *   - `useIssues()` — `issueMap` for resolving the related issue snapshot
 *   - `useProject()` — `getProjectById` for resolving each related issue's project identifier (used by
 *     `generateWorkItemLink`)
 *
 * Side effects:
 *   - Mutations: `createRelation(...)` (POST `/issues/<id>/issue-relation/`) and
 *     `removeRelation(...)` (DELETE) routed through the issue-detail store.
 *   - Toast emissions: error toast when the user submits an empty selection.
 *   - Navigations: each chip's `<Link>` opens the related work item in a new tab; the link href is
 *     built via `generateWorkItemLink` from `@plane/utils`.
 *   - Closes the modal on successful submission via `toggleRelationModal(null, null)`.
 *
 * Derived state notes:
 *   - `isRelationKeyModalActive` is true only when the modal is open AND its `(issueId, relationKey)`
 *     pair matches this component — this prevents siblings of the same issue with different
 *     relation categories from sharing modal state.
 *   - Returns `null` early when the relation set is undefined (loading state), distinct from the
 *     empty-array case (renders the placeholder).
 *
 * Imperative DOM/event notes:
 *   - The remove affordance uses `e.preventDefault(); e.stopPropagation();` to suppress the parent
 *     button's `toggleRelationModal(issueId, relationKey)` handler. Preserve this exactly.
 *   - The chip's external link also calls `stopPropagation()` to keep the modal from opening on link click.
 */

import React from "react";
import { observer } from "mobx-react";
import Link from "next/link";

import { EditIcon, CloseIcon } from "@plane/propel/icons";
// Plane
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { ISearchIssueResponse } from "@plane/types";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// Plane web imports
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
import type { TIssueRelationTypes } from "@/plane-web/types";
import type { TRelationObject } from "../issue-detail-widgets/relations";

type TIssueRelationSelect = {
  className?: string;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  relationKey: TIssueRelationTypes;
  disabled?: boolean;
};

export const IssueRelationSelect = observer(function IssueRelationSelect(props: TIssueRelationSelect) {
  const { className = "", workspaceSlug, projectId, issueId, relationKey, disabled = false } = props;
  // hooks
  const { getProjectById } = useProject();
  const {
    createRelation,
    removeRelation,
    relation: { getRelationByIssueIdRelationType },
    isRelationModalOpen,
    toggleRelationModal,
  } = useIssueDetail();
  const { issueMap } = useIssues();
  const { isMobile } = usePlatformOS();
  const relationIssueIds = getRelationByIssueIdRelationType(issueId, relationKey);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();

  const onSubmit = async (data: ISearchIssueResponse[]) => {
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

  if (!relationIssueIds) return null;

  const isRelationKeyModalActive =
    isRelationModalOpen?.relationType === relationKey && isRelationModalOpen?.issueId === issueId;

  const currRelationOption: TRelationObject | undefined = ISSUE_RELATION_OPTIONS[relationKey];

  return (
    <>
      <ExistingIssuesListModal
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        isOpen={isRelationKeyModalActive}
        handleClose={() => toggleRelationModal(null, null)}
        searchParams={{ issue_relation: true, issue_id: issueId }}
        handleOnSubmit={onSubmit}
        workspaceLevelToggle
      />

      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 rounded-sm px-2 py-0.5 outline-none",
          {
            "cursor-not-allowed": disabled,
            "hover:bg-layer-1": !disabled,
            "bg-layer-1": isRelationKeyModalActive,
          },
          className
        )}
        onClick={() => toggleRelationModal(issueId, relationKey)}
        disabled={disabled}
      >
        <div className="flex w-full items-start justify-between">
          {relationIssueIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 py-0.5">
              {relationIssueIds.map((relationIssueId) => {
                const currentIssue = issueMap[relationIssueId];
                if (!currentIssue) return;

                const projectDetails = getProjectById(currentIssue.project_id);

                return (
                  <div
                    key={relationIssueId}
                    className={`group flex items-center gap-1 rounded-sm px-1.5 pt-1 pb-1 leading-3 hover:bg-surface-2 ${currRelationOption?.className}`}
                  >
                    <Tooltip tooltipHeading="Title" tooltipContent={currentIssue.name} isMobile={isMobile}>
                      <Link
                        href={generateWorkItemLink({
                          workspaceSlug,
                          projectId: projectDetails?.id,
                          issueId: currentIssue.id,
                          projectIdentifier: projectDetails?.identifier,
                          sequenceId: currentIssue?.sequence_id,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-caption-sm-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {`${projectDetails?.identifier}-${currentIssue?.sequence_id}`}
                      </Link>
                    </Tooltip>
                    {!disabled && (
                      <Tooltip tooltipContent="Remove" position="bottom" isMobile={isMobile}>
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeRelation(workspaceSlug, projectId, issueId, relationKey, relationIssueId);
                          }}
                        >
                          <CloseIcon className="h-2.5 w-2.5 text-tertiary hover:text-danger-primary" />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-body-xs-regular text-placeholder">{currRelationOption?.placeholder}</span>
          )}
          {!disabled && (
            <span
              className={cn("flex-shrink-0 p-1 opacity-0 group-hover:opacity-100", {
                "text-placeholder": relationIssueIds.length === 0,
              })}
            >
              <EditIcon className="h-2.5 w-2.5 flex-shrink-0" />
            </span>
          )}
        </div>
      </button>
    </>
  );
});
