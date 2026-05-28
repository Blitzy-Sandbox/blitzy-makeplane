/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Confirmation modal for deleting a workspace-level draft work item.
 *
 * Rendered purpose: a destructive-action `AlertModalCore` that confirms deletion of a
 * draft issue stored on the workspace (not yet promoted to a project). The actual delete
 * mutation is performed by the parent via the `onSubmit` callback — this modal only
 * gates the action behind a permission check and renders success/failure toasts.
 *
 * Props:
 *   - isOpen (boolean, required): modal open state
 *   - handleClose (() => void, required): close-modal callback invoked on cancel/dismiss
 *   - dataId (string | null | undefined, optional): draft id resolved via `issueMap` when `data` is absent
 *   - data (TWorkspaceDraftIssue, optional): hydrated draft record; takes precedence over `dataId`
 *   - onSubmit (() => Promise<void>, optional): parent-supplied delete mutation (typically wraps `WorkspaceDraftService.deleteIssue`)
 *
 * MobX stores read:
 *   - `useIssues()` — reads `issueMap` to resolve the draft when only `dataId` is passed
 *   - `useUser()` — reads the current user id for creator-vs-admin authorization
 *   - `useUserPermissions()` — `allowPermissions([ADMIN], PROJECT)` gate to authorize deletion
 *
 * Side effects:
 *   - Invokes the parent-supplied `onSubmit` async callback (the actual delete is owned by the consumer/store)
 *   - Emits `setToast` success/error notifications based on the mutation outcome
 *   - Renders an explicit permission-denied toast when the viewer is neither creator nor project admin
 *
 * Consumers:
 *   - `WorkspaceDraftIssueQuickActions` callers in `apps/web/core/components/issues/workspace-draft/`
 *   - `DraftIssueBlock` / workspace-draft list rows that surface the inline delete affordance
 */

import { useEffect, useState } from "react";
// types
import { PROJECT_ERROR_MESSAGES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkspaceDraftIssue } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// constants
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUser, useUserPermissions } from "@/hooks/store/user";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  dataId?: string | null | undefined;
  data?: TWorkspaceDraftIssue;
  onSubmit?: () => Promise<void>;
};

export function WorkspaceDraftIssueDeleteIssueModal(props: Props) {
  const { dataId, data, isOpen, handleClose, onSubmit } = props;
  // states
  const [isDeleting, setIsDeleting] = useState(false);
  // store hooks
  const { issueMap } = useIssues();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();
  const { data: currentUser } = useUser();

  // derived values
  const canPerformProjectAdminActions = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  useEffect(() => {
    setIsDeleting(false);
  }, [isOpen]);

  if (!dataId && !data) return null;

  // derived values
  const issue = data ? data : issueMap[dataId!];
  const isIssueCreator = issue?.created_by === currentUser?.id;
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
            title: `${t("success")}!`,
            message: t("workspace_draft_issues.toasts.deleted.success"),
          });
          onClose();
        })
        .catch((errors) => {
          const isPermissionError = errors?.error === "Only admin or creator can delete the work item";
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
      title={t("workspace_draft_issues.delete_modal.title")}
      content={<>{t("workspace_draft_issues.delete_modal.description")}</>}
      primaryButtonText={{
        loading: t("deleting"),
        default: t("delete"),
      }}
      secondaryButtonText={t("cancel")}
    />
  );
}
