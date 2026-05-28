/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Card-style row for a single persisted issue attachment in the grid layout, showing
 * the file icon, truncated name, uploader tooltip, extension, size, an open-in-new-tab
 * link, and a delete button gated by a locally-owned confirmation modal.
 *
 * @remarks
 * Returns an empty fragment when the attachment cannot be resolved from the
 * issue-detail store, allowing the parent list to stay declarative without
 * pre-filtering its ID list.
 *
 * Props (`TIssueAttachmentsDetail`):
 * - `attachmentId` (string, required) — id used to look up the attachment record
 * - `attachmentHelpers` (`Exclude<TAttachmentHelpers, "create">`, required) — exposes
 *   `operations.remove` for the delete action; the `create` field is intentionally
 *   excluded since this row is read-only against uploads
 * - `disabled` (boolean, optional) — hides the delete button when truthy
 *
 * MobX stores read:
 * - `useMember().getUserDetails` — uploader display name for the tooltip
 * - `useIssueDetail().attachment.getAttachmentById(attachmentId)` — resolves the attachment record
 *
 * Side effects:
 * - Opens `IssueAttachmentDeleteModal` (locally-controlled via `useState`) which on
 *   confirmation calls `attachmentHelpers.operations.remove` (DELETE through
 *   `IssueAttachmentService` against the assets V2 endpoint at
 *   `/api/assets/v2/workspaces/<slug>/projects/<projectId>/<serviceType>/<issueId>/attachments/<assetId>/`)
 * - `Link` (next/link) opens `fileURL` in a new tab via `target="_blank"` with
 *   `rel="noopener noreferrer"` to defeat reverse-tabnabbing/opener exposure
 *
 * Consumers:
 * - `./attachments-list.tsx` (`IssueAttachmentsList`).
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { CloseIcon } from "@plane/propel/icons";
// ui
import { Tooltip } from "@plane/propel/tooltip";
import {
  convertBytesToSize,
  getFileExtension,
  getFileName,
  getFileURL,
  renderFormattedDate,
  truncateText,
} from "@plane/utils";
// icons
//
import { getFileIcon } from "@/components/icons";
// components
import { IssueAttachmentDeleteModal } from "@/components/issues/attachment/delete-attachment-modal";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { TAttachmentHelpers } from "../issue-detail-widgets/attachments/helper";

type TAttachmentOperationsRemoveModal = Exclude<TAttachmentHelpers, "create">;

type TIssueAttachmentsDetail = {
  attachmentId: string;
  attachmentHelpers: TAttachmentOperationsRemoveModal;
  disabled?: boolean;
};

export const IssueAttachmentsDetail = observer(function IssueAttachmentsDetail(props: TIssueAttachmentsDetail) {
  // props
  const { attachmentId, attachmentHelpers, disabled } = props;
  // store hooks
  const { getUserDetails } = useMember();
  const {
    attachment: { getAttachmentById },
  } = useIssueDetail();
  // state
  const [isDeleteIssueAttachmentModalOpen, setIsDeleteIssueAttachmentModalOpen] = useState(false);
  // derived values
  const attachment = attachmentId ? getAttachmentById(attachmentId) : undefined;
  const fileName = getFileName(attachment?.attributes.name ?? "");
  const fileExtension = getFileExtension(attachment?.asset_url ?? "");
  const fileIcon = getFileIcon(fileExtension, 28);
  const fileURL = getFileURL(attachment?.asset_url ?? "");
  // hooks
  const { isMobile } = usePlatformOS();

  if (!attachment) return <></>;

  return (
    <>
      {isDeleteIssueAttachmentModalOpen && (
        <IssueAttachmentDeleteModal
          isOpen={isDeleteIssueAttachmentModalOpen}
          onClose={() => setIsDeleteIssueAttachmentModalOpen(false)}
          attachmentOperations={attachmentHelpers.operations}
          attachmentId={attachmentId}
        />
      )}
      <div className="flex h-[60px] items-center justify-between gap-1 rounded-md border-[2px] border-subtle bg-surface-1 px-4 py-2 text-13">
        <Link href={fileURL ?? ""} target="_blank" rel="noopener noreferrer">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7">{fileIcon}</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Tooltip tooltipContent={fileName} isMobile={isMobile}>
                  <span className="text-13">{truncateText(`${fileName}`, 10)}</span>
                </Tooltip>
                <Tooltip
                  isMobile={isMobile}
                  tooltipContent={`${
                    getUserDetails(attachment.updated_by)?.display_name ?? ""
                  } uploaded on ${renderFormattedDate(attachment.updated_at)}`}
                >
                  <span>
                    <AlertCircle className="h-3 w-3" />
                  </span>
                </Tooltip>
              </div>

              <div className="flex items-center gap-3 text-11 text-secondary">
                <span>{fileExtension.toUpperCase()}</span>
                <span>{convertBytesToSize(attachment.attributes.size)}</span>
              </div>
            </div>
          </div>
        </Link>

        {!disabled && (
          <button type="button" onClick={() => setIsDeleteIssueAttachmentModalOpen(true)}>
            <CloseIcon className="h-4 w-4 text-secondary hover:text-primary" />
          </button>
        )}
      </div>
    </>
  );
});
