/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Slim row presentation of an in-flight attachment upload in the list layout,
 * showing the file icon, truncated name, and a circular progress indicator with
 * percentage label.
 *
 * @remarks
 * `pointer-events-none` is applied to the wrapper so users cannot interact with the
 * row while the upload is in progress.
 *
 * Props (`Props`):
 * - `uploadStatus` (`TAttachmentUploadStatus`, required) — snapshot from the
 *   issue-detail attachment store; exposes `name` and `progress` (0–100)
 *
 * MobX stores read:
 * - None directly. The `uploadStatus` object is passed in by the parent
 *   (`attachment-item-list.tsx`), which reads the upload-status array from
 *   `attachmentHelpers.snapshot.uploadStatus`.
 *
 * Side effects:
 * - None — purely presentational.
 *
 * Consumers:
 * - `./attachment-item-list.tsx` (`IssueAttachmentItemList`).
 */

import { observer } from "mobx-react";
// ui
import { Tooltip } from "@plane/propel/tooltip";
import { CircularProgressIndicator } from "@plane/ui";
// components
import { getFileExtension } from "@plane/utils";
import { getFileIcon } from "@/components/icons";
// helpers
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { TAttachmentUploadStatus } from "@/store/issue/issue-details/attachment.store";

type Props = {
  uploadStatus: TAttachmentUploadStatus;
};

export const IssueAttachmentsUploadItem = observer(function IssueAttachmentsUploadItem(props: Props) {
  // props
  const { uploadStatus } = props;
  // derived values
  const fileName = uploadStatus.name;
  const fileExtension = getFileExtension(uploadStatus.name ?? "");
  const fileIcon = getFileIcon(fileExtension, 18);
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="pointer-events-none flex h-11 items-center justify-between gap-3 bg-surface-2 pr-2 pl-9">
      <div className="flex items-center gap-3 truncate text-13">
        <div className="flex-shrink-0">{fileIcon}</div>
        <Tooltip tooltipContent={fileName} isMobile={isMobile}>
          <p className="truncate font-medium text-secondary">{fileName}</p>
        </Tooltip>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="flex-shrink-0">
          <CircularProgressIndicator size={20} strokeWidth={3} percentage={uploadStatus.progress} />
        </span>
        <div className="flex-shrink-0 text-13 font-medium">{uploadStatus.progress}% done</div>
      </div>
    </div>
  );
});
