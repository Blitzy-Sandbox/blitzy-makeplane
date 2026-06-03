/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Upload entry-point button for the issue-detail attachments widget.
 *
 * Rendered purpose: Wraps a `react-dropzone` file picker (single-file, size-capped at the
 * instance's `maxFileSize`) behind either a custom button node or the default `+` icon,
 * uploading the chosen file via the attachment store, refreshing the issue activity timeline,
 * and recording the attachments widget as the last action.
 *
 * Props:
 *  - `workspaceSlug` (string, required) — workspace slug used by the attachment service for API URL construction.
 *  - `projectId` (string, required) — project identifier of the parent issue.
 *  - `issueId` (string, required) — issue receiving the uploaded attachment.
 *  - `customButton` (React.ReactNode, optional) — replaces the default `PlusIcon` when provided; lets call sites use this component as a generic dropzone-trigger wrapper.
 *  - `disabled` (boolean, optional, default `false`) — disables the dropzone (also disabled while an upload is in flight).
 *  - `issueServiceType` (TIssueServiceType, required) — selects the issue-detail store slice; one of `EIssueServiceType.ISSUES`, `EPICS`, `WORK_ITEMS`.
 *
 * MobX stores read:
 *  - `useIssueDetail(issueServiceType)` — destructures `setLastWidgetAction` (action) and `fetchActivities` (async action).
 *  - `useAttachmentOperations(...)` (indirect) — produces the `create` operation that internally calls
 *    `attachment.createAttachment` on the same store slice (see `./helper.tsx`).
 *
 * Side effects:
 *  - Uploads the selected `File` via `attachmentOperations.create`, which routes through
 *    `IssueAttachmentService.uploadIssueAttachment` and the assets V2 presigned-upload flow:
 *    `POST /api/assets/v2/workspaces/<slug>/projects/<projectId>/<serviceType>/<issueId>/attachments/`
 *    returns a signed URL, the client uploads the file body directly to object storage, and a
 *    follow-up `PATCH` to the same path marks `is_uploaded=true` (see `IssueAttachmentV2Endpoint`
 *    in `apps/api/plane/app/views/issue/attachment.py`). Aborted uploads are eventually reaped
 *    by the `delete_unuploaded_file_asset` Celery task in
 *    `apps/api/plane/bgtasks/file_asset_task.py` (default 7-day retention for `is_uploaded=false`
 *    rows), so a closed tab mid-upload does not leak storage rows.
 *  - On upload failure: emits an error toast `"File could not be attached. Try uploading again."`.
 *  - On size/multi-file rejection: emits an error toast (either `"Only one file can be uploaded at a time."`
 *    or `"File must be of ${maxFileSize / 1024 / 1024}MB or less in size."`).
 *  - After every upload attempt (success or failure): refetches the issue activity timeline via
 *    `fetchActivities(workspaceSlug, projectId, issueId)` and calls `setLastWidgetAction("attachments")`.
 *  - Locally toggles `isLoading` state to disable the dropzone during an in-flight upload.
 *
 * Consumers (this directory): rendered by `./root.tsx` inside `IssueDetailWidgetCollapsibles` and
 * also reused by external dropzone-trigger surfaces that pass a `customButton`.
 */

import React, { useCallback, useState } from "react";
import { observer } from "mobx-react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { PlusIcon } from "@plane/propel/icons";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web hooks
import { useFileSize } from "@/plane-web/hooks/use-file-size";
// local imports
import { useAttachmentOperations } from "./helper";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const IssueAttachmentActionButton = observer(function IssueAttachmentActionButton(props: Props) {
  const { workspaceSlug, projectId, issueId, customButton, disabled = false, issueServiceType } = props;
  // state
  const [isLoading, setIsLoading] = useState(false);
  // store hooks
  const { setLastWidgetAction, fetchActivities } = useIssueDetail(issueServiceType);
  // file size
  const { maxFileSize } = useFileSize();
  // operations
  const { operations: attachmentOperations } = useAttachmentOperations(
    workspaceSlug,
    projectId,
    issueId,
    issueServiceType
  );
  // handlers
  const handleFetchPropertyActivities = useCallback(() => {
    fetchActivities(workspaceSlug, projectId, issueId);
  }, [fetchActivities, workspaceSlug, projectId, issueId]);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      const totalAttachedFiles = acceptedFiles.length + rejectedFiles.length;

      if (rejectedFiles.length === 0) {
        const currentFile: File = acceptedFiles[0];
        if (!currentFile || !workspaceSlug) return;

        setIsLoading(true);
        attachmentOperations
          .create(currentFile)
          .catch(() => {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Error!",
              message: "File could not be attached. Try uploading again.",
            });
          })
          .finally(() => {
            handleFetchPropertyActivities();
            setLastWidgetAction("attachments");
            setIsLoading(false);
          });
        return;
      }

      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message:
          totalAttachedFiles > 1
            ? "Only one file can be uploaded at a time."
            : `File must be of ${maxFileSize / 1024 / 1024}MB or less in size.`,
      });
      return;
    },
    [attachmentOperations, maxFileSize, workspaceSlug, handleFetchPropertyActivities, setLastWidgetAction]
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    maxSize: maxFileSize,
    multiple: false,
    disabled: isLoading || disabled,
  });

  return (
    <div
      onClick={(e) => {
        // TODO: Remove extra div and move event propagation to button
        e.stopPropagation();
      }}
    >
      <button {...getRootProps()} type="button" disabled={disabled}>
        <input {...getInputProps()} />
        {customButton ? customButton : <PlusIcon className="h-4 w-4" />}
      </button>
    </div>
  );
});
