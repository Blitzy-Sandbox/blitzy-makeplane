/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Destructive-action confirmation modal for permanently deleting a work item, sub-work item, or epic.
 *
 * Rendered purpose: an `AlertModalCore` dialog that gates work item deletion behind a permission
 * check (only the issue creator or a project admin may delete) and shows entity-aware wording.
 *
 * Props:
 *   - isOpen (boolean, required): modal open state
 *   - handleClose (() => void, required): close-modal callback
 *   - dataId (string | null | undefined, optional): id used to resolve the issue from `issueMap` when `data` is not provided
 *   - data (TIssue | TDeDupeIssue, optional): pre-resolved issue payload (takes precedence over `dataId`)
 *   - isSubIssue (boolean, optional, default=false): switches confirmation copy to sub-work-item wording
 *   - onSubmit (() => Promise<void>, optional): the actual delete operation invoked when the user confirms
 *   - isEpic (boolean, optional, default=false): switches copy to epic-specific wording
 *
 * MobX stores read:
 *   - `useIssues()` — `issueMap` for resolving an issue payload from `dataId`
 *   - `useProject()` — `getProjectById` for resolving project identifier + sequence id wording
 *   - `useUser()` — current user (used for the `isIssueCreator` check)
 *   - `useUserPermissions()` — `allowPermissions` for the project-admin gate
 *
 * Side effects:
 *   - Invokes the `onSubmit` callback supplied by the parent (which in turn calls `IssueService.delete*` or the relevant
 *     issue-store action).
 *   - Emits `setToast` (success / permission-error / generic-error variants) via `@plane/propel/toast`.
 *   - On unauthorized attempt, short-circuits with an error toast and closes the modal.
 *
 * Imperative / derived state notes:
 *   - `useEffect` resets `isDeleting` whenever `isOpen` changes so that re-opening the modal starts in a fresh state.
 *   - `authorized = isIssueCreator || canPerformProjectAdminActions`. Permission check is also re-validated server-side;
 *     the client check is a UX optimization that prevents a needless API round-trip.
 *   - `PROJECT_ERROR_MESSAGES.permissionError` / `issueDeleteError` are i18n-keyed message bundles from `@plane/constants`.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import { PROJECT_ERROR_MESSAGES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TDeDupeIssue, TIssue } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// constants
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// plane-web

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  dataId?: string | null | undefined;
  data?: TIssue | TDeDupeIssue;
  isSubIssue?: boolean;
  onSubmit?: () => Promise<void>;
  isEpic?: boolean;
};

export const DeleteIssueModal = observer(function DeleteIssueModal(props: Props) {
  const { dataId, data, isOpen, handleClose, isSubIssue = false, onSubmit, isEpic = false } = props;
  // states
  const [isDeleting, setIsDeleting] = useState(false);
  // store hooks
  const { workspaceSlug } = useParams();
  const { issueMap } = useIssues();
  const { getProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();

  const { data: currentUser } = useUser();

  useEffect(() => {
    setIsDeleting(false);
  }, [isOpen]);

  if (!dataId && !data) return null;

  // derived values
  const issue = data ? data : issueMap[dataId!];
  const projectDetails = getProjectById(issue?.project_id);
  const isIssueCreator = issue?.created_by === currentUser?.id;

  const canPerformProjectAdminActions = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug?.toString(),
    projectDetails?.id
  );

  const authorized = isIssueCreator || canPerformProjectAdminActions;

  const onClose = () => {
    setIsDeleting(false);
    handleClose();
  };

  const handleIssueDelete = async () => {
    setIsDeleting(true);

    if (!authorized) {
      setToast({
        title: t(PROJECT_ERROR_MESSAGES.permissionError.i18n_title),
        type: TOAST_TYPE.ERROR,
        message:
          PROJECT_ERROR_MESSAGES.permissionError.i18n_message && t(PROJECT_ERROR_MESSAGES.permissionError.i18n_message),
      });
      onClose();
      return;
    }
    if (onSubmit)
      await onSubmit()
        .then(() => {
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("common.success"),
            message: t("entity.delete.success", {
              entity: isSubIssue ? t("common.sub_work_item") : isEpic ? t("common.epic") : t("common.work_item"),
            }),
          });
          onClose();
        })
        .catch((errors) => {
          const isPermissionError =
            errors?.error ===
            `Only admin or creator can delete the ${isSubIssue ? "sub-work item" : isEpic ? "epic" : "work item"}`;
          const currentError = isPermissionError
            ? PROJECT_ERROR_MESSAGES.permissionError
            : PROJECT_ERROR_MESSAGES.issueDeleteError;
          setToast({
            title: t(currentError.i18n_title),
            type: TOAST_TYPE.ERROR,
            message: currentError.i18n_message && t(currentError.i18n_message),
          });
        })
        .finally(() => onClose());
  };

  return (
    <AlertModalCore
      handleClose={onClose}
      handleSubmit={handleIssueDelete}
      isSubmitting={isDeleting}
      isOpen={isOpen}
      title={t("entity.delete.label", { entity: isEpic ? t("common.epic") : t("common.work_item") })}
      content={
        <>
          {/* TODO: Translate here */}
          {`Are you sure you want to delete ${isEpic ? "epic" : "work item"} `}
          <span className="font-medium break-words text-primary">
            {projectDetails?.identifier}-{issue?.sequence_id}
          </span>
          {` ? All of the data related to the ${isEpic ? "epic" : "work item"} will be permanently removed. This action cannot be undone.`}
        </>
      }
    />
  );
});
