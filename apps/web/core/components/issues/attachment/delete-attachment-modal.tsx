/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Destructive confirmation modal for removing an issue attachment, resolving the
 * attachment record from the issue-detail store and delegating the delete call to
 * `attachmentOperations.remove`.
 *
 * @remarks
 * Returns an empty fragment when the attachment id cannot be resolved, so callers
 * can safely conditionally render this on a stale id without crashing.
 *
 * Also exports `TAttachmentOperationsRemoveModal = Pick<TAttachmentOperations, "remove">`
 * — the narrowed operations contract this modal consumes.
 *
 * Props (`Props`):
 * - `isOpen` (boolean, required) — controls modal visibility
 * - `onClose` (() => void, required) — closes the modal; called after the delete
 *   promise settles (`finally`) so the modal closes regardless of success/error
 * - `attachmentId` (string, required) — id used to look up the attachment record
 *   and pass into `attachmentOperations.remove`
 * - `attachmentOperations` (`TAttachmentOperationsRemoveModal`, required) — minimal
 *   operations contract; only `remove` is needed
 * - `issueServiceType` (`TIssueServiceType`, optional, default `EIssueServiceType.ISSUES`)
 *   — selects which issue-detail store namespace to bind to
 *
 * MobX stores read:
 * - `useIssueDetail(issueServiceType).attachment.getAttachmentById(attachmentId)`
 *   — resolves the attachment record to render its filename in the confirmation copy
 *
 * Side effects:
 * - Calls `attachmentOperations.remove(attachment.id)` (DELETE through
 *   `IssueAttachmentService` against the assets V2 endpoint
 *   `/api/assets/v2/workspaces/<slug>/projects/<projectId>/<serviceType>/<issueId>/attachments/<assetId>/`);
 *   local `loader` state drives `AlertModalCore`'s `isSubmitting` indicator while
 *   the delete is in flight.
 * - Closes the modal via `onClose` in `.finally(...)` so the modal closes on both
 *   success and failure paths (failure toasts are emitted upstream).
 *
 * Consumers:
 * - `./attachment-detail.tsx` (`IssueAttachmentsDetail` — grid variant)
 * - `./attachment-item-list.tsx` (`IssueAttachmentItemList` — list variant)
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane-i18n
import { useTranslation } from "@plane/i18n";
// types
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// helper
import { getFileName } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TAttachmentOperations } from "../issue-detail-widgets/attachments/helper";

export type TAttachmentOperationsRemoveModal = Pick<TAttachmentOperations, "remove">;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  attachmentId: string;
  attachmentOperations: TAttachmentOperationsRemoveModal;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentDeleteModal = observer(function IssueAttachmentDeleteModal(props: Props) {
  const { t } = useTranslation();
  const { isOpen, onClose, attachmentId, attachmentOperations, issueServiceType = EIssueServiceType.ISSUES } = props;
  // states
  const [loader, setLoader] = useState(false);

  // store hooks
  const {
    attachment: { getAttachmentById },
  } = useIssueDetail(issueServiceType);

  // derived values
  const attachment = attachmentId ? getAttachmentById(attachmentId) : undefined;

  // handlers
  const handleClose = () => {
    onClose();
    setLoader(false);
  };

  const handleDeletion = async (assetId: string) => {
    setLoader(true);
    attachmentOperations.remove(assetId).finally(() => handleClose());
  };

  if (!attachment) return <></>;
  return (
    <AlertModalCore
      handleClose={handleClose}
      handleSubmit={() => handleDeletion(attachment.id)}
      isSubmitting={loader}
      isOpen={isOpen}
      title={t("attachment.delete")}
      content={
        <>
          {/* TODO: Translate here */}
          Are you sure you want to delete attachment-{" "}
          <span className="font-bold">{getFileName(attachment.attributes.name)}</span>? This attachment will be
          permanently removed. This action cannot be undone.
        </>
      }
    />
  );
});
