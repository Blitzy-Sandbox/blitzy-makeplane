/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact row presentation of a single persisted issue attachment in the list layout,
 * showing the file icon, name with extension, uploader avatar tooltip, size, and a
 * delete action exposed through an overflow menu.
 *
 * @remarks
 * Row click delegates to `window.open(fileURL, "_blank", "noopener,noreferrer")` rather than
 * rendering an anchor element — keeping the surrounding hover/menu UI behaviorally a single
 * button. The `noopener,noreferrer` features defeat reverse-tabnabbing and opener exposure.
 * Returns an empty fragment when the attachment id cannot be resolved from the store,
 * so callers can keep a stable id list even after partial deletes.
 *
 * Props (`TIssueAttachmentsListItem`):
 * - `attachmentId` (string, required) — id used to look up the attachment record
 * - `disabled` (boolean, optional) — disables the overflow menu (hides delete option)
 * - `issueServiceType` (`TIssueServiceType`, optional, default `EIssueServiceType.ISSUES`)
 *   — selects which issue-detail store namespace to bind to (e.g., epics vs. issues)
 *
 * MobX stores read:
 * - `useMember().getUserDetails` — uploader display name
 * - `useIssueDetail(issueServiceType).attachment.getAttachmentById(attachmentId)` —
 *   resolves the attachment record
 * - `useIssueDetail(issueServiceType).toggleDeleteAttachmentModal` — store-centralized
 *   modal toggle invoked on delete-menu click
 *
 * Side effects:
 * - Opens the attachment URL in a new tab via
 *   `window.open(fileURL, "_blank", "noopener,noreferrer")` (imperative DOM call — preferred
 *   over an anchor here to keep the row a single button; the `noopener,noreferrer` features
 *   defeat reverse-tabnabbing and opener exposure to the asset host)
 * - Calls `toggleDeleteAttachmentModal(attachmentId)` to surface the delete confirmation
 *   dialog (the parent `attachment-item-list.tsx` reads `attachmentDeleteModalId` from
 *   the store to render `IssueAttachmentDeleteModal`)
 *
 * Accessibility:
 * - Row is a `<button>` element; uploader and filename tooltips reuse Plane's tooltip
 *   primitive (mobile-aware via `usePlatformOS`).
 *
 * Consumers:
 * - `./attachment-item-list.tsx` (`IssueAttachmentItemList`).
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { TrashIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
import { convertBytesToSize, getFileExtension, getFileName, getFileURL, renderFormattedDate } from "@plane/utils";
// components
//
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { getFileIcon } from "@/components/icons";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueAttachmentsListItem = {
  attachmentId: string;
  disabled?: boolean;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentsListItem = observer(function IssueAttachmentsListItem(props: TIssueAttachmentsListItem) {
  const { t } = useTranslation();
  // props
  const { attachmentId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  // store hooks
  const { getUserDetails } = useMember();
  const {
    attachment: { getAttachmentById },
    toggleDeleteAttachmentModal,
  } = useIssueDetail(issueServiceType);
  // derived values
  const attachment = attachmentId ? getAttachmentById(attachmentId) : undefined;
  const fileName = getFileName(attachment?.attributes.name ?? "");
  const fileExtension = getFileExtension(attachment?.attributes.name ?? "");
  const fileIcon = getFileIcon(fileExtension, 18);
  const fileURL = getFileURL(attachment?.asset_url ?? "");
  // hooks
  const { isMobile } = usePlatformOS();

  if (!attachment) return <></>;

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(fileURL, "_blank", "noopener,noreferrer");
        }}
      >
        <div className="group flex h-11 items-center justify-between gap-3 pr-2 pl-9 hover:bg-surface-2">
          <div className="flex items-center gap-3 truncate text-13">
            <div className="flex items-center gap-3">{fileIcon}</div>
            <Tooltip tooltipContent={`${fileName}.${fileExtension}`} isMobile={isMobile}>
              <p className="truncate font-medium text-secondary">{`${fileName}.${fileExtension}`}</p>
            </Tooltip>
            <span className="flex size-1.5 rounded-full bg-layer-1" />
            <span className="flex-shrink-0 text-placeholder">{convertBytesToSize(attachment.attributes.size)}</span>
          </div>

          <div className="flex items-center gap-3">
            {attachment?.created_by && (
              <>
                <Tooltip
                  isMobile={isMobile}
                  tooltipContent={`${
                    getUserDetails(attachment?.created_by)?.display_name ?? ""
                  } uploaded on ${renderFormattedDate(attachment.updated_at)}`}
                >
                  <div className="flex items-center justify-center">
                    <ButtonAvatars showTooltip userIds={attachment?.created_by} />
                  </div>
                </Tooltip>
              </>
            )}

            <CustomMenu ellipsis closeOnSelect placement="bottom-end" disabled={disabled}>
              <CustomMenu.MenuItem
                onClick={() => {
                  toggleDeleteAttachmentModal(attachmentId);
                }}
              >
                <div className="flex items-center gap-2">
                  <TrashIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>{t("common.actions.delete")}</span>
                </div>
              </CustomMenu.MenuItem>
            </CustomMenu>
          </div>
        </div>
      </button>
    </>
  );
});
