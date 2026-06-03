/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Confirmation modal for archiving a work item.
 *
 * Rendered purpose: a centered `ModalCore` dialog that displays project identifier + sequence id and
 * confirms a non-destructive archive action; on confirm it invokes the caller-supplied `onSubmit`
 * and emits a success or error toast.
 *
 * Props:
 *   - data (TIssue | TDeDupeIssue, optional): pre-resolved issue payload (takes precedence over `dataId`)
 *   - dataId (string | null | undefined, optional): id used to resolve issue from `issueMap` when `data` is absent
 *   - handleClose (() => void, required): close-modal callback
 *   - isOpen (boolean, required): modal open state
 *   - onSubmit (() => Promise<void>, optional): archive operation invoked when the user confirms
 *
 * MobX stores read:
 *   - `useIssues()` — `issueMap` for resolving the issue payload from `dataId`
 *   - `useProject()` — `getProjectById` for resolving the project identifier used in the modal title
 *
 * Side effects:
 *   - Invokes parent-supplied `onSubmit` (typically a call into an issue store action which in turn hits
 *     `IssueArchiveService.archiveIssue` against the backend archive endpoint).
 *   - Emits success/error toasts via `setToast` from `@plane/propel/toast`, with i18n-keyed strings:
 *     `issue.archive.success.label`, `issue.archive.success.message`, `issue.archive.failed.message`,
 *     `common.error.label`.
 *
 * Imperative / derived state notes:
 *   - `isArchiving` local state drives the button loading indicator and the `t("common.archiving")` label.
 *   - `if (!dataId && !data) return null;` early-exits when neither identifier nor payload is provided.
 *
 * Consumers: rendered by issue-detail quick-action menus and list-item quick-action dropdowns —
 * e.g., `apps/web/core/components/issues/issue-detail/issue-detail-quick-actions.tsx`,
 * `apps/web/core/components/issues/issue-layouts/quick-action-dropdowns/*`, and bulk-archive flows.
 */
import { useState } from "react";
// i18n
import { useTranslation } from "@plane/i18n";
// types
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TDeDupeIssue, TIssue } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";

type Props = {
  data?: TIssue | TDeDupeIssue;
  dataId?: string | null | undefined;
  handleClose: () => void;
  isOpen: boolean;
  onSubmit?: () => Promise<void>;
};

export function ArchiveIssueModal(props: Props) {
  const { dataId, data, isOpen, handleClose, onSubmit } = props;
  const { t } = useTranslation();
  // states
  const [isArchiving, setIsArchiving] = useState(false);
  // store hooks
  const { getProjectById } = useProject();
  const { issueMap } = useIssues();

  if (!dataId && !data) return null;

  const issue = data ? data : issueMap[dataId!];
  const projectDetails = getProjectById(issue.project_id);

  const onClose = () => {
    setIsArchiving(false);
    handleClose();
  };

  const handleArchiveIssue = async () => {
    if (!onSubmit) return;

    setIsArchiving(true);
    await onSubmit()
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("issue.archive.success.label"),
          message: t("issue.archive.success.message"),
        });
        onClose();
        return;
      })
      .catch(() =>
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("common.error.label"),
          message: t("issue.archive.failed.message"),
        })
      )
      .finally(() => setIsArchiving(false));
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="px-5 py-4">
        <h3 className="text-18 font-medium 2xl:text-20">
          {t("issue.archive.label")} {projectDetails?.identifier} {issue.sequence_id}
        </h3>
        <p className="mt-3 text-13 text-secondary">{t("issue.archive.confirm_message")}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="lg" tabIndex={1} onClick={handleArchiveIssue} loading={isArchiving}>
            {isArchiving ? t("common.archiving") : t("common.archive")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
