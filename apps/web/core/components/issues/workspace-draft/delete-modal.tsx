/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Confirmation dialog for deleting a workspace draft issue.
 *
 * Resolves the target issue from either the provided `data` prop or by
 * looking up `dataId` in `issueMap`, enforces creator-or-project-admin
 * authorization client-side, and delegates the actual delete to the
 * parent-supplied `onSubmit` callback (typically
 * `deleteIssue(workspaceSlug, issueId)` on the workspace draft store).
 *
 * Props:
 *   - isOpen (boolean, required): modal visibility.
 *   - handleClose (() => void, required): close handler.
 *   - dataId? (string | null | undefined): issue id used to look up the
 *     issue via `issueMap` when `data` is not pre-resolved.
 *   - data? (TWorkspaceDraftIssue): pre-resolved issue snapshot; takes
 *     precedence over `dataId`.
 *   - onSubmit? (() => Promise<void>): actual delete operation; the parent
 *     performs persistence (no network call is made from this component).
 *
 * MobX stores read (via React context):
 *   - useIssues — issueMap (only used when falling back from `dataId`).
 *   - useUserPermissions — allowPermissions (project-admin gate).
 *   - useUser — currentUser (drives the `isIssueCreator` check).
 *   - useTranslation — translator for localized title, body, and toasts.
 *
 * Side effects:
 *   - Unauthorized actors (neither creator nor project admin) get a
 *     permission-error toast and the modal closes without invoking
 *     `onSubmit` — this prevents unnecessary 4xx requests.
 *   - On submit success emits `workspace_draft_issues.toasts.deleted.success`.
 *   - On submit error inspects `errors?.error` for the server-side
 *     permission-error signature and selects the appropriate toast message
 *     (permissionError vs. issueDeleteError).
 *   - Modal is always closed in `finally` to avoid sticky open state.
 *
 * Renders via `AlertModalCore` from `@plane/ui` — no custom layout.
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
