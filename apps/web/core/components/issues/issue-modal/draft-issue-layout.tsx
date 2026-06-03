/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Draft-aware wrapper around the shared issue form that adds discard-confirmation and "save to drafts" behavior.
 *
 * Rendered purpose: composes `IssueFormRoot` and `ConfirmIssueDiscard` to detect unsaved changes on close,
 * sanitize ephemeral / empty fields, and prompt the user to discard or save the in-progress work item as a draft.
 *
 * Props (`DraftIssueProps extends IssueFormProps`):
 *   - changesMade (Partial<TIssue> | null, required): the dirty form snapshot tracked by `CreateUpdateIssueModalBase`
 *   - onChange ((formData: Partial<TIssue> | null) => void, required): callback used to clear or update the
 *     parent's `changesMade` state (typically `setChangesMade(null)`)
 *   - …all `IssueFormProps` fields (forwarded to `IssueFormRoot`) — see `./form` for the full prop list
 *
 * MobX stores read:
 *   - `useIssueModal()` — `handleCreateUpdatePropertyValues` (additional-property persistence after a draft is created)
 *   - `useWorkspaceDraftIssues()` — `createIssue` (persists the work item to the workspace draft store)
 *
 * Side effects:
 *   - Draft persistence: `createIssue(workspaceSlug, payload)` from the workspace draft store. The payload is
 *     the sanitized `changesMade` snapshot, merging `name → trim() || "Untitled"` and `project_id` from the
 *     form prop.
 *   - Property persistence: `handleCreateUpdatePropertyValues({ issueId, issueTypeId, projectId, workspaceSlug,
 *     isDraft: true })` fired after a successful draft create.
 *   - Toasts: `setToast({ type: TOAST_TYPE.SUCCESS | ERROR, ... })` with i18n strings
 *     `workspace_draft_issues.toasts.created.success` / `.error`.
 *   - No direct service calls — persistence flows through the `useWorkspaceDraftIssues()` store hook,
 *     which delegates to `WorkspaceDraftService` (defined in `apps/web/core/services/issue/workspace_draft.service.ts`).
 *   - No navigations — `onClose` is invoked instead.
 *
 * Derived state / imperative notes:
 *   - `sanitizeChanges()` strips: null/undefined/empty-string values, empty objects/arrays, `project_id`
 *     (irrelevant for the draft payload key), `priority === "none"`, and `description_html` that is "empty HTML"
 *     by `isEmptyHtmlString(html, ["img"])` (images alone do not count as content).
 *   - `handleClose()` decision tree:
 *       1. If `data?.id` is truthy → user is editing an existing work item → close immediately (no discard prompt).
 *       2. Else if `changesMade` is non-null AND sanitized changes are non-empty → open the discard modal.
 *       3. Else → close immediately.
 *   - `handleDraftAndClose()` (passed to `IssueFormRoot` as `handleDraftAndClose`) creates a draft when there
 *     are sanitized changes and `data.id` is absent, then closes. Wired into the form-level "save to drafts"
 *     button flow.
 *   - The local `issueDiscardModal` boolean controls `ConfirmIssueDiscard.isOpen`.
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively — workspace draft issues live in `apps/web/core/store/workspace-draft/` and are exposed
 *     via the `useWorkspaceDraftIssues` hook.
 *   - i18n via `@plane/i18n` `useTranslation()`; all user-facing strings are i18n keys.
 *   - Router context (`workspaceSlug`) sourced from `useParams()`.
 */

import { useState } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// Plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { isEmptyHtmlString } from "@plane/utils";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
// local imports
import { ConfirmIssueDiscard } from "../confirm-issue-discard";
import { IssueFormRoot } from "./form";
import type { IssueFormProps } from "./form";

export interface DraftIssueProps extends IssueFormProps {
  changesMade: Partial<TIssue> | null;
  onChange: (formData: Partial<TIssue> | null) => void;
}

export const DraftIssueLayout = observer(function DraftIssueLayout(props: DraftIssueProps) {
  const { changesMade, data, onChange, onClose, projectId } = props;
  // states
  const [issueDiscardModal, setIssueDiscardModal] = useState(false);
  // router params
  const { workspaceSlug } = useParams();
  // store hooks
  const { handleCreateUpdatePropertyValues } = useIssueModal();
  const { createIssue } = useWorkspaceDraftIssues();
  const { t } = useTranslation();

  const sanitizeChanges = (): Partial<TIssue> => {
    const sanitizedChanges = { ...changesMade };
    Object.entries(sanitizedChanges).forEach(([key, value]) => {
      const issueKey = key as keyof TIssue;
      if (value === null || value === undefined || value === "") delete sanitizedChanges[issueKey];
      if (typeof value === "object" && isEmpty(value)) delete sanitizedChanges[issueKey];
      if (Array.isArray(value) && value.length === 0) delete sanitizedChanges[issueKey];
      if (issueKey === "project_id") delete sanitizedChanges.project_id;
      if (issueKey === "priority" && value && value === "none") delete sanitizedChanges.priority;
      if (
        issueKey === "description_html" &&
        changesMade?.description_html &&
        isEmptyHtmlString(changesMade.description_html, ["img"])
      )
        delete sanitizedChanges.description_html;
    });
    return sanitizedChanges;
  };

  const handleClose = () => {
    // If the user is updating an existing work item, we don't need to show the discard modal
    if (data?.id) {
      onClose();
      setIssueDiscardModal(false);
    } else {
      if (changesMade) {
        const sanitizedChanges = sanitizeChanges();
        if (isEmpty(sanitizedChanges)) {
          onClose();
          setIssueDiscardModal(false);
        } else setIssueDiscardModal(true);
      } else {
        onClose();
        setIssueDiscardModal(false);
      }
    }
  };

  const handleCreateDraftIssue = async () => {
    if (!changesMade || !workspaceSlug || !projectId) return;

    const payload = {
      ...changesMade,
      name: changesMade?.name && changesMade?.name?.trim() !== "" ? changesMade.name?.trim() : "Untitled",
      project_id: projectId,
    };

    const response = await createIssue(workspaceSlug.toString(), payload)
      .then((res) => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: `${t("success")}!`,
          message: t("workspace_draft_issues.toasts.created.success"),
        });
        onChange(null);
        setIssueDiscardModal(false);
        onClose();
        return res;
      })
      .catch((_error) => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: `${t("error")}!`,
          message: t("workspace_draft_issues.toasts.created.error"),
        });
      });

    if (response && handleCreateUpdatePropertyValues) {
      handleCreateUpdatePropertyValues({
        issueId: response.id,
        issueTypeId: response.type_id,
        projectId,
        workspaceSlug: workspaceSlug?.toString(),
        isDraft: true,
      });
    }
  };

  const handleDraftAndClose = () => {
    const sanitizedChanges = sanitizeChanges();
    if (!data?.id && !isEmpty(sanitizedChanges)) {
      handleCreateDraftIssue();
    }
    onClose();
  };

  return (
    <>
      <ConfirmIssueDiscard
        isOpen={issueDiscardModal}
        handleClose={() => setIssueDiscardModal(false)}
        onConfirm={handleCreateDraftIssue}
        onDiscard={() => {
          onChange(null);
          setIssueDiscardModal(false);
          onClose();
        }}
      />
      <IssueFormRoot {...props} onClose={handleClose} handleDraftAndClose={handleDraftAndClose} />
    </>
  );
});
