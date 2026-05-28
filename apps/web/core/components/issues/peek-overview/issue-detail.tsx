/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central body editor for the work item peek-overview panel.
 *
 * Rendered purpose: composes the parent-issue context row, the type switcher, the duplicate-issue
 * detection popover, the editable title input, the rich-text description editor, the reaction row,
 * and the description-versions history launcher. Returns an empty fragment when the issue or its
 * project cannot be resolved.
 *
 * Props (Props):
 *   - editorRef (React.RefObject<EditorRefApi>, required): TipTap editor handle forwarded to the
 *     description input and used by version restore to set the editor value
 *   - workspaceSlug (string, required): scopes title / description update mutations
 *   - projectId (string, required): scopes title / description update mutations (note: although
 *     accepted via props, the file resolves `issue.project_id` for the persistence calls so the
 *     editor stays correctly scoped after a parent move)
 *   - issueId (string, required): identifies the rendered work item
 *   - issueOperations (TIssueOperations, required): the issue-update contract sourced from
 *     `../issue-detail`; description submits route through `issueOperations.update(...)`
 *   - disabled (boolean, required): edit-disabled flag (propagated to children)
 *   - isArchived (boolean, required): when true, forces title and description into read-only mode
 *     and hides the description-versions UI
 *   - isSubmitting (TNameDescriptionLoader, required): "submitting" | "submitted" | "saved" lifecycle
 *     flag used to drive the reload-confirmation alert and reset-to-"saved" transition
 *   - setIsSubmitting ((value: TNameDescriptionLoader) => void, required): callback to mutate
 *     the indicator state in the parent
 *
 * MobX stores read:
 *   - `useUser()` — `data` aliased as `currentUser`; the reaction row is hidden when no user is logged in
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` resolves the rendered issue
 *   - `useProject()` — `getProjectById(issue.project_id)` resolves the project (used to build the
 *     `useDebouncedDuplicateIssues` query)
 *   - `useMember()` — `getUserDetails(issue.created_by)` resolves the creator display name for the
 *     description-versions entity-information block
 *
 * Side effects:
 *   - Description save: `issueOperations.update(workspaceSlug, project_id, issue.id, { description_html, ...(isMigrationUpdate ? { skip_activity: "true" } : {}) })`
 *     →  PATCH /api/workspaces/<slug>/projects/<projectId>/issues/<issueId>/   (with optional `skip_activity` flag during migration writes)
 *   - Description-versions service calls via the module-scope `WorkItemVersionService` instance:
 *       listDescriptionVersions(workspaceSlug, projectId, issueId)         → GET    /description-versions/
 *       retrieveDescriptionVersion(workspaceSlug, projectId, issueId, id)  → GET    /description-versions/<id>/
 *   - Reload confirmation: `setShowAlert(true)` while `isSubmitting === "submitting"` so users get
 *     a browser beforeunload warning if they close the tab mid-save.
 *   - Duplicate-issue detection: `useDebouncedDuplicateIssues(...)` performs a debounced SWR fetch
 *     keyed on `(workspaceSlug, workspaceId, projectId, name, description_html, issueId)`; emits
 *     duplicates that drive the popover render condition.
 *   - On `isSubmitting === "submitted"`, a 2000ms `setTimeout` resets the indicator back to `"saved"`
 *     so the UI shows a brief confirmation before clearing.
 *
 * Imperative DOM / derived state notes:
 *   - `issueDescription` defaults to `"<p></p>"` when the persisted HTML is empty so the TipTap editor
 *     receives a non-empty root paragraph (TipTap rejects empty strings).
 *   - The duplicate-detection popover renders only when `duplicateIssues?.length > 0`.
 *   - `editorRef.current?.setEditorValue(descriptionHTML, true)` is used to imperatively restore a
 *     historical description version into the TipTap editor.
 *   - `WorkItemVersionService` is instantiated at module scope (line 37) — preserved verbatim per the
 *     system boundary "No refactoring, renaming, or restructuring of any kind".
 *
 * Consumers:
 *   - `apps/web/core/components/issues/peek-overview/view.tsx` (both layout branches)
 *
 * Architectural notes:
 *   - MobX exclusively — stores via React context.
 *   - Wrapped in `observer(...)` so the body re-renders when the resolved issue snapshot mutates.
 *   - Migration update path (`skip_activity: "true"`): used during HTML→binary description backfills
 *     to suppress activity log entries during one-time storage migrations.
 */
import { useEffect } from "react";
import { observer } from "mobx-react";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import { EFileAssetType } from "@plane/types";
import type { TNameDescriptionLoader } from "@plane/types";
// components
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
// plane web components
import { DeDupeIssuePopoverRoot } from "@/plane-web/components/de-dupe/duplicate-popover";
import { IssueTypeSwitcher } from "@/plane-web/components/issues/issue-details/issue-type-switcher";
// plane web hooks
import { useDebouncedDuplicateIssues } from "@/plane-web/hooks/use-debounced-duplicate-issues";
// services
import { WorkItemVersionService } from "@/services/issue";
// local components
import type { TIssueOperations } from "../issue-detail";
import { IssueParentDetail } from "../issue-detail/parent";
import { IssueReaction } from "../issue-detail/reactions";
import { IssueTitleInput } from "../title-input";
// services init
const workItemVersionService = new WorkItemVersionService();

type Props = {
  editorRef: React.RefObject<EditorRefApi>;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  disabled: boolean;
  isArchived: boolean;
  isSubmitting: TNameDescriptionLoader;
  setIsSubmitting: (value: TNameDescriptionLoader) => void;
};

export const PeekOverviewIssueDetails = observer(function PeekOverviewIssueDetails(props: Props) {
  const { editorRef, workspaceSlug, issueId, issueOperations, disabled, isArchived, isSubmitting, setIsSubmitting } =
    props;
  // store hooks
  const { data: currentUser } = useUser();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getProjectById } = useProject();
  const { getUserDetails } = useMember();
  // reload confirmation
  const { setShowAlert } = useReloadConfirmations(isSubmitting === "submitting");

  useEffect(() => {
    if (isSubmitting === "submitted") {
      setShowAlert(false);
      setTimeout(async () => {
        setIsSubmitting("saved");
      }, 2000);
    } else if (isSubmitting === "submitting") {
      setShowAlert(true);
    }
  }, [isSubmitting, setShowAlert, setIsSubmitting]);

  // derived values
  const issue = issueId ? getIssueById(issueId) : undefined;
  const projectDetails = issue?.project_id ? getProjectById(issue?.project_id) : undefined;
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

  if (!issue || !issue.project_id) return <></>;

  const issueDescription =
    issue.description_html !== undefined || issue.description_html !== null
      ? issue.description_html != ""
        ? issue.description_html
        : "<p></p>"
      : undefined;

  return (
    <div className="space-y-2">
      {issue.parent_id && (
        <IssueParentDetail
          workspaceSlug={workspaceSlug}
          projectId={issue.project_id}
          issueId={issueId}
          issue={issue}
          issueOperations={issueOperations}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <IssueTypeSwitcher issueId={issueId} disabled={isArchived || disabled} />
        {duplicateIssues?.length > 0 && (
          <DeDupeIssuePopoverRoot
            workspaceSlug={workspaceSlug}
            projectId={issue.project_id}
            rootIssueId={issueId}
            issues={duplicateIssues}
            issueOperations={issueOperations}
          />
        )}
      </div>
      <IssueTitleInput
        workspaceSlug={workspaceSlug}
        projectId={issue.project_id}
        issueId={issue.id}
        isSubmitting={isSubmitting}
        setIsSubmitting={(value) => setIsSubmitting(value)}
        issueOperations={issueOperations}
        disabled={disabled || isArchived}
        value={issue.name}
        containerClassName="-ml-3"
      />

      <DescriptionInput
        issueSequenceId={issue.sequence_id}
        containerClassName="-ml-3 border-none"
        disabled={disabled || isArchived}
        editorRef={editorRef}
        entityId={issue.id}
        fileAssetType={EFileAssetType.ISSUE_DESCRIPTION}
        initialValue={issueDescription}
        key={issue.id}
        onSubmit={async (value, isMigrationUpdate) => {
          if (!issue.id || !issue.project_id) return;
          await issueOperations.update(workspaceSlug, issue.project_id, issue.id, {
            description_html: value.description_html,
            ...(isMigrationUpdate ? { skip_activity: "true" } : {}),
          });
        }}
        setIsSubmitting={(value) => setIsSubmitting(value)}
        projectId={issue.project_id}
        workspaceSlug={workspaceSlug}
      />

      <div className="flex items-center justify-between gap-2">
        {currentUser && (
          <IssueReaction
            workspaceSlug={workspaceSlug}
            projectId={issue.project_id}
            issueId={issueId}
            currentUser={currentUser}
            disabled={isArchived}
          />
        )}
        {!disabled && (
          <DescriptionVersionsRoot
            className="flex-shrink-0"
            entityInformation={{
              createdAt: issue.created_at ? new Date(issue.created_at) : new Date(),
              createdByDisplayName: getUserDetails(issue.created_by ?? "")?.display_name ?? "",
              id: issueId,
              isRestoreDisabled: disabled || isArchived,
            }}
            fetchHandlers={{
              listDescriptionVersions: (issueId) =>
                workItemVersionService.listDescriptionVersions(
                  workspaceSlug,
                  issue.project_id?.toString() ?? "",
                  issueId
                ),
              retrieveDescriptionVersion: (issueId, versionId) =>
                workItemVersionService.retrieveDescriptionVersion(
                  workspaceSlug,
                  issue.project_id?.toString() ?? "",
                  issueId,
                  versionId
                ),
            }}
            handleRestore={(descriptionHTML) => editorRef.current?.setEditorValue(descriptionHTML, true)}
            projectId={issue.project_id}
            workspaceSlug={workspaceSlug}
          />
        )}
      </div>
    </div>
  );
});
