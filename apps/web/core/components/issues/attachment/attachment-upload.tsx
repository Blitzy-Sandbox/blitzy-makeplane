/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single-file drag-and-drop upload dropzone for issue attachments, enforcing the
 * global max-file-size limit and rendering contextual feedback for drag, reject,
 * in-progress, and idle states.
 *
 * @remarks
 * Backed by `react-dropzone` with `multiple: false`; the first accepted file is
 * uploaded via the provided `attachmentOperations.create`. Disables the input
 * while an upload is in flight or when the parent disables the control.
 *
 * Props (`Props`):
 * - `workspaceSlug` (string, required) — guards `onDrop` so uploads only fire when scoped to a workspace
 * - `disabled` (boolean, optional, default `false`) — disables the dropzone input
 * - `attachmentOperations` (`Pick<TAttachmentOperations, "create">`, required) — minimal
 *   contract; only `create` is needed because this widget never deletes
 *
 * MobX stores read:
 * - None directly; the upload is performed through the closure over
 *   `attachmentOperations.create` (which in turn calls the issue-detail attachment store).
 *
 * Side effects:
 * - File upload via `attachmentOperations.create` (presigned POST flow through
 *   `IssueAttachmentService` — see `issue-detail-widgets/attachments/helper.tsx`)
 * - Toggles local `isLoading` state to show "Uploading..." and to disable the input
 * - Surfaces a derived `fileError` string when `react-dropzone` rejects the file
 *   (type or size); no toast is emitted from here (the GRID variant relies on the
 *   inline string; the LIST variant in `attachment-item-list.tsx` uses toasts)
 *
 * Consumers:
 * - `./root.tsx` (`IssueAttachmentRoot`).
 */

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import { useDropzone } from "react-dropzone";
// plane web hooks
import { useFileSize } from "@/plane-web/hooks/use-file-size";
// types
import type { TAttachmentOperations } from "../issue-detail-widgets/attachments/helper";

type TAttachmentOperationsModal = Pick<TAttachmentOperations, "create">;

type Props = {
  workspaceSlug: string;
  disabled?: boolean;
  attachmentOperations: TAttachmentOperationsModal;
};

export const IssueAttachmentUpload = observer(function IssueAttachmentUpload(props: Props) {
  const { workspaceSlug, disabled = false, attachmentOperations } = props;
  // states
  const [isLoading, setIsLoading] = useState(false);
  // file size
  const { maxFileSize } = useFileSize();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const currentFile: File = acceptedFiles[0];
      if (!currentFile || !workspaceSlug) return;

      setIsLoading(true);
      attachmentOperations.create(currentFile).finally(() => setIsLoading(false));
    },
    [attachmentOperations, workspaceSlug]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone({
    onDrop,
    maxSize: maxFileSize,
    multiple: false,
    disabled: isLoading || disabled,
  });

  const fileError =
    fileRejections.length > 0 ? `Invalid file type or size (max ${maxFileSize / 1024 / 1024} MB)` : null;

  return (
    <div
      {...getRootProps()}
      className={`flex h-[60px] items-center justify-center rounded-md border-2 border-dashed bg-accent-primary/5 px-4 text-11 text-accent-primary ${
        isDragActive ? "border-accent-strong bg-accent-primary/10" : "border-subtle"
      } ${isDragReject ? "bg-danger-subtle" : ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <input {...getInputProps()} />
      <span className="flex items-center gap-2">
        {isDragActive ? (
          <p>Drop here...</p>
        ) : fileError ? (
          <p className="text-center text-danger-primary">{fileError}</p>
        ) : isLoading ? (
          <p className="text-center">Uploading...</p>
        ) : (
          <p className="text-center">Click or drag a file here</p>
        )}
      </span>
    </div>
  );
});
