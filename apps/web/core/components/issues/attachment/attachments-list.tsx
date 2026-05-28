/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the grid-variant attachments list for an issue, prepending in-flight upload
 * placeholders and then mapping persisted attachment IDs to {@link IssueAttachmentsDetail} cards.
 *
 * @remarks
 * Used inside the main issue detail page (composed by {@link IssueAttachmentRoot}).
 * In-flight uploads come from `attachmentHelpers.snapshot.uploadStatus`; persisted
 * IDs come from the issue-detail attachment store. This split lets the user see
 * upload progress and existing attachments in a single visual flow.
 *
 * Props (`TIssueAttachmentsList`):
 * - `issueId` (string, required) — issue whose attachment IDs are read
 * - `attachmentHelpers` (`TAttachmentHelpers`, required) — `{ operations, snapshot }`
 *   contract; `operations.remove` is forwarded to the per-row delete flow
 * - `disabled` (boolean, optional) — propagated to each attachment card to hide delete action
 *
 * MobX stores read:
 * - `useIssueDetail().attachment.getAttachmentsByIssueId(issueId)` — persisted attachment IDs
 *
 * Side effects:
 * - None directly. Child rows trigger uploads/deletes via `attachmentHelpers.operations`.
 *
 * Consumers:
 * - `./root.tsx` (`IssueAttachmentRoot`).
 */

import { observer } from "mobx-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TAttachmentHelpers } from "../issue-detail-widgets/attachments/helper";
// components
import { IssueAttachmentsDetail } from "./attachment-detail";
import { IssueAttachmentsUploadDetails } from "./attachment-upload-details";

type TIssueAttachmentsList = {
  issueId: string;
  attachmentHelpers: TAttachmentHelpers;
  disabled?: boolean;
};

export const IssueAttachmentsList = observer(function IssueAttachmentsList(props: TIssueAttachmentsList) {
  const { issueId, attachmentHelpers, disabled } = props;
  // store hooks
  const {
    attachment: { getAttachmentsByIssueId },
  } = useIssueDetail();
  // derived values
  const { snapshot: attachmentSnapshot } = attachmentHelpers;
  const { uploadStatus } = attachmentSnapshot;
  const issueAttachments = getAttachmentsByIssueId(issueId);

  return (
    <>
      {uploadStatus?.map((uploadStatus) => (
        <IssueAttachmentsUploadDetails key={uploadStatus.id} uploadStatus={uploadStatus} />
      ))}
      {issueAttachments?.map((attachmentId) => (
        <IssueAttachmentsDetail
          key={attachmentId}
          attachmentId={attachmentId}
          disabled={disabled}
          attachmentHelpers={attachmentHelpers}
        />
      ))}
    </>
  );
});
