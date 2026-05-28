/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * SubIssuesListItem — renders one sub-issue row inside the sub-issues list with a disclosure
 * chevron for nested expansion, an issue-type identifier badge, a truncated title with
 * tooltip, an inline property strip (state / priority / dates / assignees), and an overflow
 * action menu (edit, copy-link, remove, delete). When expanded, also recursively mounts
 * `SubIssuesListRoot` beneath itself to render the next nesting level.
 *
 * Props (see the `Props` type below):
 *   - workspaceSlug / projectId / parentIssueId / rootIssueId / issueId — routing and
 *     scoping ids; `rootIssueId` is also used for the root-comparison check that prevents
 *     infinite recursion at the top of the tree.
 *   - spacingLeft (defaults to 10) — pixel indent for this row's leading padding. The
 *     recursive `SubIssuesListRoot` mount adds `+22` per nesting level (line 264).
 *   - canEdit — gates the edit / remove / delete affordances in the overflow menu and the
 *     disabled state of the inline property dropdowns rendered by `SubIssuesListItemProperties`.
 *   - handleIssueCrudState — toggles the upstream CRUD modal state owned by `../content.tsx`
 *     for the `"update"` and `"delete"` arms (see "CRUD state split" below).
 *   - subIssueOperations — sub-issue mutation bundle from `useSubIssueOperations` (helper.ts);
 *     mediates `copyLink`, `removeSubIssue`, `updateSubIssue`. Passed down the chain
 *     `../content.tsx` → `./root.tsx` → `./list-group.tsx` → `./list-item.tsx` → `./properties.tsx`.
 *   - issueServiceType (defaults to `EIssueServiceType.ISSUES`) — selects the issue-detail
 *     store variant (issues vs. epics).
 *   - storeType (defaults to `EIssuesStoreType.PROJECT`) — forwarded into the recursive
 *     `SubIssuesListRoot` mount for nested expansion.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType).issue.getIssueById` — resolves the `TIssue` record
 *     for `issueId`.
 *   - `useIssueDetail(issueServiceType).subIssues.filters.getSubIssueFilters` — reads the
 *     `displayProperties` snapshot used to gate inline property visibility.
 *   - `useIssueDetail(issueServiceType).toggleCreateIssueModal` / `toggleDeleteIssueModal` —
 *     flips the global modal flags, paired with `handleIssueCrudState`.
 *   - `useIssueDetail().subIssues.subIssueHelpersByIssueId` / `setSubIssueHelpers` — reads
 *     and mutates the per-parent helper bag (see `subIssueHelpers` keys below). Note this
 *     uses the default service type, not the prop-supplied `issueServiceType`.
 *   - `useProject().getProjectById` — resolves the project record for identifier/sequence display.
 *
 * Sub-issue helper bag (`subIssueHelpers`) accessors:
 *   - `issue_visibility: string[]` — list of expanded parent ids. The chevron is rotated 90°
 *     when this row's id is in this list.
 *   - `preview_loader: string` — id of the issue currently fetching its sub-issues. While
 *     it matches this row, a spinning `Loader` icon replaces the chevron.
 *   - `issue_loader: string` — id of the issue with an in-flight row-level mutation. NOT
 *     read in this file but mutated by `subIssueOperations` during inline property edits;
 *     surfaced here for cross-file traceability.
 *
 * Side effects:
 *   - Chevron click: when collapsed, sets `preview_loader` → calls
 *     `fetchSubIssues(workspaceSlug, projectId, issueId)` → clears `preview_loader` → toggles
 *     `issue_visibility` (expands the row).
 *   - Row click (`ControlLink onClick`): calls `handleRedirection(workspaceSlug, issue, isMobile)`
 *     from `useIssuePeekOverviewRedirection` — navigates to the issue peek overview.
 *   - Edit menu item: invokes `handleIssueCrudState("update", parentIssueId, { ...issue })`
 *     then `toggleCreateIssueModal(true)` — opens the `CreateUpdateIssueModal` mounted at
 *     `../content.tsx:152`.
 *   - Copy-link menu item: invokes `subIssueOperations.copyLink(workItemLink)` — emits a
 *     success toast and writes the URL to the clipboard.
 *   - Remove menu item: invokes
 *     `subIssueOperations.removeSubIssue(workspaceSlug, issue.project_id, parentIssueId, issue.id)`
 *     — DETACHES the sub-issue from its parent (does NOT delete the issue record); emits toast.
 *   - Delete menu item: invokes `handleIssueCrudState("delete", parentIssueId, issue)` then
 *     `toggleDeleteIssueModal(issue.id)` — opens the `DeleteIssueModal` mounted at
 *     `../content.tsx:132`.
 *
 * CRUD state split (CRITICAL — two stores look identical but are NOT):
 *   - `content.tsx` owns the `update` / `delete` modal toggles via local `useState`
 *     (`issueCrudState`). This row writes to those arms via `handleIssueCrudState`.
 *   - `quick-action-button.tsx` and `title-actions.tsx` (parent folder) write to the MobX
 *     store's `issueCrudOperationState.create` / `.existing` for the create /
 *     existing-sub-issue dialogs. This row component does NOT touch those arms.
 *
 * Nested rendering: `<SubIssuesListRoot>` is mounted only when ALL of the following hold:
 *   1. `subIssueHelpers.issue_visibility.includes(issueId)` — this row is expanded.
 *   2. `issue.project_id` is defined — project context exists.
 *   3. `subIssueCount > 0` — the issue has children to render.
 *   4. `!isCurrentIssueRoot` — this row is NOT the rootIssueId (prevents infinite recursion).
 *
 * Consumers:
 *   - Rendered exclusively from `./list-group.tsx` (line 85) — one instance per work-item id
 *     in the group's `workItemIds` array.
 *
 * Implementation notes:
 *   - `useSubIssueOperations(EIssueServiceType.ISSUES)` is hard-coded — only `fetchSubIssues`
 *     is destructured from it. The rest of the operations bundle flows in via the
 *     `subIssueOperations` prop. The hard-coded `ISSUES` service type intentionally shadows
 *     the dynamic `issueServiceType` prop here because `fetchSubIssues` always targets the
 *     issues service even when the surrounding context is epics. Do NOT add a second
 *     operations bundle at this level — keep the prop-passed bundle as the source of truth.
 *   - All user-facing strings are translated via `useTranslation` from `@plane/i18n`; do NOT
 *     introduce hardcoded English literals.
 */

import { observer } from "mobx-react";
import { Link as Loader } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, EditIcon, TrashIcon, CloseIcon, ChevronRightIcon } from "@plane/propel/icons";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, TIssueServiceType, TSubIssueOperations } from "@plane/types";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
import { ControlLink, CustomMenu } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// helpers
import { useSubIssueOperations } from "@/components/issues/issue-detail-widgets/sub-issues/helper";
import { WithDisplayPropertiesHOC } from "@/components/issues/issue-layouts/properties/with-display-properties-HOC";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// local components
import { SubIssuesListItemProperties } from "./properties";
import { SubIssuesListRoot } from "./root";

type Props = {
  workspaceSlug: string;
  projectId: string;
  parentIssueId: string;
  rootIssueId: string;
  spacingLeft: number;
  canEdit: boolean;
  handleIssueCrudState: (
    key: "create" | "existing" | "update" | "delete",
    issueId: string,
    issue?: TIssue | null
  ) => void;
  subIssueOperations: TSubIssueOperations;
  issueId: string;
  issueServiceType?: TIssueServiceType;
  storeType?: EIssuesStoreType;
};

export const SubIssuesListItem = observer(function SubIssuesListItem(props: Props) {
  const {
    workspaceSlug,
    projectId,
    parentIssueId,
    rootIssueId,
    issueId,
    spacingLeft = 10,
    canEdit,
    handleIssueCrudState,
    subIssueOperations,
    issueServiceType = EIssueServiceType.ISSUES,
    storeType = EIssuesStoreType.PROJECT,
  } = props;
  const { t } = useTranslation();
  const {
    issue: { getIssueById },
    subIssues: {
      filters: { getSubIssueFilters },
    },
  } = useIssueDetail(issueServiceType);
  const {
    subIssues: { subIssueHelpersByIssueId, setSubIssueHelpers },
  } = useIssueDetail();
  const { fetchSubIssues } = useSubIssueOperations(EIssueServiceType.ISSUES);
  const { toggleCreateIssueModal, toggleDeleteIssueModal } = useIssueDetail(issueServiceType);
  const project = useProject();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const { isMobile } = usePlatformOS();
  const issue = getIssueById(issueId);

  // derived values
  const projectDetail = (issue && issue.project_id && project.getProjectById(issue.project_id)) || undefined;

  const subIssueHelpers = subIssueHelpersByIssueId(parentIssueId);
  const subIssueCount = issue?.sub_issues_count ?? 0;

  // derived values
  const subIssueFilters = getSubIssueFilters(parentIssueId);
  const displayProperties = subIssueFilters?.displayProperties ?? {};

  //
  const handleIssuePeekOverview = (issue: TIssue) => handleRedirection(workspaceSlug, issue, isMobile);

  if (!issue) return <></>;

  // check if current issue is the root issue
  const isCurrentIssueRoot = issueId === rootIssueId;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId: issue?.id,
    projectIdentifier: projectDetail?.identifier,
    sequenceId: issue?.sequence_id,
  });

  return (
    <div key={issueId}>
      <ControlLink
        id={`issue-${issue.id}`}
        href={workItemLink}
        onClick={() => handleIssuePeekOverview(issue)}
        className="w-full cursor-pointer"
      >
        {issue && (
          <div
            className="group relative flex h-full min-h-11 w-full items-center py-1 pr-2 transition-all hover:bg-surface-2"
            style={{ paddingLeft: `${spacingLeft}px` }}
          >
            <div className="flex size-5 flex-shrink-0 items-center justify-center">
              {/* disable the chevron when current issue is also the root issue*/}
              {/** Suppress the chevron when this row IS the rootIssueId to prevent infinite recursion at the root expansion point. */}
              {subIssueCount > 0 && !isCurrentIssueRoot && (
                <>
                  {/** `preview_loader` holds the issue id whose sub-issues are currently being fetched; while it matches this row, render a spinner in place of the chevron. */}
                  {subIssueHelpers.preview_loader.includes(issue.id) ? (
                    <div className="flex h-full w-full cursor-not-allowed items-center justify-center rounded-xs bg-layer-1 transition-all">
                      <Loader width={14} strokeWidth={2} className="animate-spin" />
                    </div>
                  ) : (
                    <div
                      className="flex h-full w-full cursor-pointer items-center justify-center text-placeholder hover:text-tertiary"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!subIssueHelpers.issue_visibility.includes(issueId)) {
                          setSubIssueHelpers(parentIssueId, "preview_loader", issueId);
                          await fetchSubIssues(workspaceSlug, projectId, issueId);
                          setSubIssueHelpers(parentIssueId, "preview_loader", issueId);
                        }
                        setSubIssueHelpers(parentIssueId, "issue_visibility", issueId);
                      }}
                    >
                      <ChevronRightIcon
                        className={cn("size-3.5 transition-all", {
                          "rotate-90": subIssueHelpers.issue_visibility.includes(issue.id),
                        })}
                        strokeWidth={2.5}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex w-full cursor-pointer items-center gap-3 truncate">
              <WithDisplayPropertiesHOC displayProperties={displayProperties || {}} displayPropertyKey="key">
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
              </WithDisplayPropertiesHOC>
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
              <SubIssuesListItemProperties
                workspaceSlug={workspaceSlug}
                parentIssueId={parentIssueId}
                issueId={issueId}
                canEdit={canEdit}
                updateSubIssue={subIssueOperations.updateSubIssue}
                displayProperties={displayProperties}
                issue={issue}
              />
            </div>

            <div className="flex-shrink-0 text-13">
              <CustomMenu placement="bottom-end" ellipsis>
                {canEdit && (
                  <CustomMenu.MenuItem
                    onClick={() => {
                      handleIssueCrudState("update", parentIssueId, { ...issue });
                      toggleCreateIssueModal(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <EditIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{t("issue.edit")}</span>
                    </div>
                  </CustomMenu.MenuItem>
                )}

                <CustomMenu.MenuItem
                  onClick={() => {
                    subIssueOperations.copyLink(workItemLink);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{t("issue.copy_link")}</span>
                  </div>
                </CustomMenu.MenuItem>

                {canEdit && (
                  <CustomMenu.MenuItem
                    onClick={() => {
                      if (issue.project_id)
                        subIssueOperations.removeSubIssue(workspaceSlug, issue.project_id, parentIssueId, issue.id);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <CloseIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      {issueServiceType === EIssueServiceType.ISSUES
                        ? t("issue.remove.parent.label")
                        : t("issue.remove.label")}
                    </div>
                  </CustomMenu.MenuItem>
                )}

                {canEdit && (
                  <CustomMenu.MenuItem
                    onClick={() => {
                      handleIssueCrudState("delete", parentIssueId, issue);
                      toggleDeleteIssueModal(issue.id);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <TrashIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{t("issue.delete.label")}</span>
                    </div>
                  </CustomMenu.MenuItem>
                )}
              </CustomMenu>
            </div>
          </div>
        )}
      </ControlLink>

      {/* should not expand the current issue if it is also the root issue*/}
      {/** Render nested sub-issues only when expanded AND the issue has children AND a project context exists AND it is not the root (prevents infinite recursion). */}
      {subIssueHelpers.issue_visibility.includes(issueId) &&
        issue.project_id &&
        subIssueCount > 0 &&
        !isCurrentIssueRoot && (
          <SubIssuesListRoot
            storeType={storeType}
            workspaceSlug={workspaceSlug}
            projectId={issue.project_id}
            parentIssueId={issue.id}
            rootIssueId={rootIssueId}
            spacingLeft={spacingLeft + 22}
            canEdit={canEdit}
            handleIssueCrudState={handleIssueCrudState}
            subIssueOperations={subIssueOperations}
          />
        )}
    </div>
  );
});
