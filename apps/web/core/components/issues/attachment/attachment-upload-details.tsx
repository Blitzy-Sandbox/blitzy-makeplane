/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Card-style progress row for an in-flight attachment upload in the grid layout,
 * showing the file icon, truncated name, extension, and a circular progress indicator
 * with percentage label.
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
 *   (`attachments-list.tsx`), which reads the upload-status array from
 *   `attachmentHelpers.snapshot.uploadStatus`.
 *
 * Side effects:
 * - None — purely presentational.
 *
 * Consumers:
 * - `./attachments-list.tsx` (`IssueAttachmentsList`).
 */

import { observer } from "mobx-react";
import { Tooltip } from "@plane/propel/tooltip";
import { CircularProgressIndicator } from "@plane/ui";
import { getFileExtension, truncateText } from "@plane/utils";
// ui
// icons
import { getFileIcon } from "@/components/icons";
// helpers
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { TAttachmentUploadStatus } from "@/store/issue/issue-details/attachment.store";

type Props = {
  uploadStatus: TAttachmentUploadStatus;
};

export const IssueAttachmentsUploadDetails = observer(function IssueAttachmentsUploadDetails(props: Props) {
  // props
  const { uploadStatus } = props;
  // derived values
  const fileName = uploadStatus.name;
  const fileExtension = getFileExtension(uploadStatus.name ?? "");
  const fileIcon = getFileIcon(fileExtension, 28);
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="pointer-events-none flex h-[60px] items-center justify-between gap-1 rounded-md border-[2px] border-subtle bg-surface-2 px-4 py-2 text-13">
      <div className="flex flex-shrink-0 items-center gap-3">
        <div className="h-7 w-7">{fileIcon}</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Tooltip tooltipContent={fileName} isMobile={isMobile}>
              <span className="text-13">{truncateText(`${fileName}`, 10)}</span>
            </Tooltip>
          </div>

          <div className="flex items-center gap-3 text-11 text-secondary">
            <span>{fileExtension.toUpperCase()}</span>
          </div>
        </div>
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
