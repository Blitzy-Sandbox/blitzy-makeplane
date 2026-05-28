/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Body content of the issue-detail attachments collapsible panel.
 *
 * Rendered purpose: Thin observer adapter that resolves attachment operation handlers
 * via `useAttachmentOperations` and delegates rendering of the actual attachment rows
 * (and in-flight upload entries) to `IssueAttachmentItemList`.
 *
 * Props:
 *  - `workspaceSlug` (string, required) — workspace slug for API URL construction inside attachment operations.
 *  - `projectId` (string, required) — project identifier for the parent issue.
 *  - `issueId` (string, required) — issue whose attachments are listed.
 *  - `disabled` (boolean, required) — when true, removes the attachment delete affordance in the list rows.
 *  - `issueServiceType` (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`) — selects which issue-detail
 *    store slice the helper hook reads from (used to disambiguate epics/drafts/work-items).
 *
 * MobX stores read: None directly. Indirectly, `useAttachmentOperations` calls
 * `useIssueDetail(issueServiceType)` to bind `createAttachment`, `removeAttachment`,
 * and `getAttachmentsUploadStatusByIssueId` — see `./helper.tsx`.
 *
 * Side effects: None originate here. The `attachmentHelpers` object passed down exposes
 * `operations.create` / `operations.remove` (which call `IssueAttachmentService` via the
 * store and emit promise/success/error toasts) and `snapshot.uploadStatus` (in-flight uploads).
 * Those side effects fire from the consumer `IssueAttachmentItemList`, not this file.
 */

import React from "react";
import { observer } from "mobx-react";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// local imports
import { IssueAttachmentItemList } from "../../attachment/attachment-item-list";
import { useAttachmentOperations } from "./helper";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentsCollapsibleContent = observer(function IssueAttachmentsCollapsibleContent(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType = EIssueServiceType.ISSUES } = props;
  // helper
  const attachmentHelpers = useAttachmentOperations(workspaceSlug, projectId, issueId, issueServiceType);
  return (
    <IssueAttachmentItemList
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      issueId={issueId}
      disabled={disabled}
      attachmentHelpers={attachmentHelpers}
      issueServiceType={issueServiceType}
    />
  );
});
