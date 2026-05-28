/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central body of the issue detail page (everything left of the sidebar).
 *
 * Rendered purpose: vertically stacks the parent breadcrumb, issue-type switcher, save-status
 * indicator, duplicate-issue popover, editable title input, rich-text description editor with
 * version history, issue-level reactions, the widget toolbar (sub-issues, links, attachments,
 * relations), the responsive properties panel (mobile-only at `<768px`), and the activity feed.
 *
 * Props:
 *   - workspaceSlug (string, required): scopes all child mutations
 *   - projectId (string, required): scopes all child mutations
 *   - issueId (string, required): the work item being viewed
 *   - issueOperations (TIssueOperations, required): issue-update contract from `./root` — `update`
 *     is invoked by the description editor's `onSubmit`
 *   - isEditable (boolean, required): when false, title/description/issue-type are read-only and
 *     description-version restore is disabled
 *   - isArchived (boolean, required): archives override `isEditable` for editor-level disabling
 *
 * MobX stores read:
 *   - `useUser()` — `data: currentUser` for the reactions panel gate
 *   - `useMember()` — `getUserDetails(issue.created_by)` for the description-version entity info
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)`, `peekIssue` (the peek-overlay flag)
 *   - `useProject()` — `getProjectById(projectId)` for the project workspace id used by duplicate detection
 *
 * Side effects:
 *   - SWR-backed duplicate-issue lookup via `useDebouncedDuplicateIssues(...)` (1-second debounce
 *     against the work item title/description; suppressed when in peek mode).
 *   - Description persistence via `issueOperations.update(workspaceSlug, issue.project_id, issue.id,
 *     { description_html, skip_activity? })` — when `isMigrationUpdate` is true, `skip_activity:
 *     "true"` is appended so the activity feed is not polluted by silent HTML→ProseMirror migrations.
 *   - Description version history is fetched via the module-level `workItemVersionService =
 *     new WorkItemVersionService()` (`WorkItemVersionService.listDescriptionVersions` /
 *     `.retrieveDescriptionVersion`).
 *   - The reload-confirmation hook (`useReloadConfirmations`) surfaces a beforeunload prompt
 *     whenever `isSubmitting === "submitting"`.
 *   - No direct toast emissions in this file; child components handle their own user feedback.
 *
 * Imperative DOM / derived state notes:
 *   - `editorRef` (typed as `EditorRefApi` from `@plane/editor`) is forwarded to `DescriptionInput`
 *     and is invoked by `DescriptionVersionsRoot.handleRestore` to programmatically set the editor
 *     value when a historical version is selected (`editorRef.current?.setEditorValue(html, true)`).
 *   - The submission lifecycle effect transitions `"submitted" → "saved"` after a 2000ms timeout —
 *     this is the visible delay between save completion and the "Saved" indicator disappearing.
 *     Preserve the 2000ms constant.
 *   - `isPeekModeActive = Boolean(peekIssue)` — when true, the `DeDupeIssuePopoverRoot` modals are
 *     suppressed (`renderDeDupeActionModals={!isPeekModeActive}`) to prevent stacked modal layers,
 *     and the same flag suppresses the issue-detail-widgets modals.
 *   - `windowSize[0] < 768` mounts the inline `PeekOverviewProperties` so the metadata panel is
 *     accessible on small screens where the sidebar is hidden.
 *   - Returns `<></>` early when the issue or its `project_id` cannot be resolved.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import type { TNameDescriptionLoader } from "@plane/types";
import { EFileAssetType, EIssueServiceType } from "@plane/types";
import { getTextContent } from "@plane/utils";
// components
import { DescriptionVersionsRoot } from "@/components/core/description-versions";
import { DescriptionInput } from "@/components/editor/rich-text/description-input";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import useReloadConfirmations from "@/hooks/use-reload-confirmation";
import useSize from "@/hooks/use-window-size";
// plane web components
import { DeDupeIssuePopoverRoot } from "@/plane-web/components/de-dupe/duplicate-popover";
import { IssueTypeSwitcher } from "@/plane-web/components/issues/issue-details/issue-type-switcher";
import { useDebouncedDuplicateIssues } from "@/plane-web/hooks/use-debounced-duplicate-issues";
// services
import { WorkItemVersionService } from "@/services/issue";
// local imports
import { IssueDetailWidgets } from "../issue-detail-widgets";
import { NameDescriptionUpdateStatus } from "../issue-update-status";
import { PeekOverviewProperties } from "../peek-overview/properties";
import { IssueTitleInput } from "../title-input";
import { IssueActivity } from "./issue-activity";
import { IssueParentDetail } from "./parent";
import { IssueReaction } from "./reactions";
import type { TIssueOperations } from "./root";
// services init
const workItemVersionService = new WorkItemVersionService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  isEditable: boolean;
  isArchived: boolean;
};

export const IssueMainContent = observer(function IssueMainContent(props: Props) {
  const { workspaceSlug, projectId, issueId, issueOperations, isEditable, isArchived } = props;
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  // states
  const [isSubmitting, setIsSubmitting] = useState<TNameDescriptionLoader>("saved");
  // hooks
  const windowSize = useSize();
  const { data: currentUser } = useUser();
  const { getUserDetails } = useMember();
  const {
    issue: { getIssueById },
    peekIssue,
  } = useIssueDetail();
  const { getProjectById } = useProject();
  const { setShowAlert } = useReloadConfirmations(isSubmitting === "submitting");
  // derived values
  const projectDetails = getProjectById(projectId);
  const issue = issueId ? getIssueById(issueId) : undefined;
  // debounced duplicate issues swr
  const { duplicateIssues } = useDebouncedDuplicateIssues(
    workspaceSlug,
    projectDetails?.workspace.toString(),
    projectDetails?.id,
    {
      name: issue?.name,
      description_html: getTextContent(issue?.description_html),
      issueId: issue?.id,
    }
  );

  useEffect(() => {
    if (isSubmitting === "submitted") {
      setShowAlert(false);
      setTimeout(async () => setIsSubmitting("saved"), 2000);
    } else if (isSubmitting === "submitting") setShowAlert(true);
  }, [isSubmitting, setShowAlert, setIsSubmitting]);

  if (!issue || !issue.project_id) return <></>;

  const isPeekModeActive = Boolean(peekIssue);

  return (
    <>
      <div className="space-y-4 rounded-lg">
        {issue.parent_id && (
          <IssueParentDetail
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            issue={issue}
            issueOperations={issueOperations}
          />
        )}

        <div className="mb-2.5 flex items-center justify-between gap-4">
          <IssueTypeSwitcher issueId={issueId} disabled={isArchived || !isEditable} />
          <div className="flex items-center gap-3">
            <NameDescriptionUpdateStatus isSubmitting={isSubmitting} />
            {duplicateIssues?.length > 0 && (
              <DeDupeIssuePopoverRoot
                workspaceSlug={workspaceSlug}
                projectId={issue.project_id}
                rootIssueId={issueId}
                issues={duplicateIssues}
                issueOperations={issueOperations}
                renderDeDupeActionModals={!isPeekModeActive}
              />
            )}
          </div>
        </div>

        <IssueTitleInput
          workspaceSlug={workspaceSlug}
          projectId={issue.project_id}
          issueId={issue.id}
          isSubmitting={isSubmitting}
          setIsSubmitting={(value) => setIsSubmitting(value)}
          issueOperations={issueOperations}
          disabled={isArchived || !isEditable}
          value={issue.name}
          containerClassName="-ml-3"
        />

        <DescriptionInput
          issueSequenceId={issue.sequence_id}
          containerClassName="-ml-6 border-none p-0! pl-6!"
          disabled={isArchived || !isEditable}
          editorRef={editorRef}
          entityId={issue.id}
          fileAssetType={EFileAssetType.ISSUE_DESCRIPTION}
          initialValue={issue.description_html}
          key={issue.id}
          onSubmit={async (value, isMigrationUpdate) => {
            if (!issue.id || !issue.project_id) return;
            await issueOperations.update(workspaceSlug, issue.project_id, issue.id, {
              description_html: value.description_html,
              ...(isMigrationUpdate ? { skip_activity: "true" } : {}),
            });
          }}
          projectId={issue.project_id}
          setIsSubmitting={(value) => setIsSubmitting(value)}
          workspaceSlug={workspaceSlug}
        />

        <div className="flex items-center justify-between gap-2">
          {currentUser && (
            <IssueReaction
              className="flex-shrink-0"
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              currentUser={currentUser}
              disabled={isArchived}
            />
          )}
          {isEditable && (
            <DescriptionVersionsRoot
              className="flex-shrink-0"
              entityInformation={{
                createdAt: issue.created_at ? new Date(issue.created_at) : new Date(),
                createdByDisplayName: getUserDetails(issue.created_by ?? "")?.display_name ?? "",
                id: issueId,
                isRestoreDisabled: !isEditable || isArchived,
              }}
              fetchHandlers={{
                listDescriptionVersions: (issueId) =>
                  workItemVersionService.listDescriptionVersions(workspaceSlug, projectId, issueId),
                retrieveDescriptionVersion: (issueId, versionId) =>
                  workItemVersionService.retrieveDescriptionVersion(workspaceSlug, projectId, issueId, versionId),
              }}
              handleRestore={(descriptionHTML) => editorRef.current?.setEditorValue(descriptionHTML, true)}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
            />
          )}
        </div>
      </div>

      <IssueDetailWidgets
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        disabled={!isEditable || isArchived}
        renderWidgetModals={!isPeekModeActive}
        issueServiceType={EIssueServiceType.ISSUES}
      />

      {windowSize[0] < 768 && (
        <PeekOverviewProperties
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          issueOperations={issueOperations}
          disabled={!isEditable || isArchived}
        />
      )}

      <IssueActivity workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} disabled={isArchived} />
    </>
  );
});
