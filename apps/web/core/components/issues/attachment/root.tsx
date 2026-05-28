/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestration component for the issue attachments section, composing
 * the upload dropzone and the persisted attachments list under a section header.
 *
 * @remarks
 * Renders inside the issue detail page. Creates a single issue-scoped helper
 * contract via {@link useAttachmentOperations} so the upload and list children
 * share one `create`/`remove` operations object and one MobX upload-status snapshot.
 *
 * Props (`TIssueAttachmentRoot`):
 * - `workspaceSlug` (string, required) — workspace slug used for asset routing
 * - `projectId` (string, required) — project identifier scoping the issue
 * - `issueId` (string, required) — issue identifier whose attachments are managed
 * - `disabled` (boolean, optional, default `false`) — disables the upload control and delete actions
 *
 * MobX stores read (transitively via {@link useAttachmentOperations}):
 * - `useIssueDetail().attachment` — for upload-status snapshot and attachment IDs
 *
 * Side effects:
 * - None directly; child components invoke `IssueAttachmentService.uploadIssueAttachment`
 *   (assets V2 presigned-upload flow against `IssueAttachmentV2Endpoint`, see
 *   `./issue-detail-widgets/attachments/helper.tsx` for the full contract and the
 *   `delete_unuploaded_file_asset` cleanup safety net) and delete operations, and emit
 *   toasts on completion.
 *
 * Consumers:
 * - `apps/web/core/components/issues/issue-detail-widgets/attachments/content.tsx`
 *   (and any caller that imports from `@/components/issues/attachment`).
 */

import { observer } from "mobx-react";
// hooks
import { useAttachmentOperations } from "../issue-detail-widgets/attachments/helper";
// components
import { IssueAttachmentUpload } from "./attachment-upload";
import { IssueAttachmentsList } from "./attachments-list";

export type TIssueAttachmentRoot = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

export const IssueAttachmentRoot = observer(function IssueAttachmentRoot(props: TIssueAttachmentRoot) {
  // props
  const { workspaceSlug, projectId, issueId, disabled = false } = props;
  // hooks
  const attachmentHelpers = useAttachmentOperations(workspaceSlug, projectId, issueId);

  return (
    <div className="relative space-y-3">
      <h3 className="text-body-sm-medium">Attachments</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <IssueAttachmentUpload
          workspaceSlug={workspaceSlug}
          disabled={disabled}
          attachmentOperations={attachmentHelpers.operations}
        />
        <IssueAttachmentsList issueId={issueId} disabled={disabled} attachmentHelpers={attachmentHelpers} />
      </div>
    </div>
  );
});
