/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Attachment operations hook and related types for the issue-detail attachments widget.
 *
 * This module is the single source of truth for the imperative attachment surface
 * consumed by the attachments widget components (`root.tsx`, `title.tsx`,
 * `content.tsx`, `quick-action-button.tsx`) and the downstream
 * `IssueAttachmentItemList`. It binds the issue-detail MobX store's attachment
 * sub-slice to a stable, identifier-scoped `create` / `remove` API and surfaces the
 * current in-flight upload snapshot for progress UI.
 *
 * State slice read (MobX): `useIssueDetail(issueServiceType).attachment` —
 *   - `createAttachment` (async action) — POSTs the file through `IssueAttachmentService`
 *     to `/api/workspaces/<slug>/projects/<id>/issues/<issue_id>/issue-attachments/` and
 *     records an in-flight upload entry until the promise resolves.
 *   - `removeAttachment` (async action) — deletes an attachment by id via the same service.
 *   - `getAttachmentsUploadStatusByIssueId` (computed accessor) — returns the array of
 *     in-flight upload entries for the given issue, used by the list to render
 *     placeholder rows while uploads are processing.
 *
 * Side effects emitted by this module:
 *   - `setPromiseToast` on upload (loading → success/error toast strings).
 *   - `setToast` success on remove; `setToast` error on remove failure.
 *
 * Consumers (this directory): `content.tsx`, `quick-action-button.tsx`.
 */

import { useMemo } from "react";
import { setPromiseToast, TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TAttachmentUploadStatus } from "@/store/issue/issue-details/attachment.store";

/**
 * Imperative attachment API exposed to consumers of `useAttachmentOperations`.
 *
 * @property create  Uploads a single `File` to the current issue's attachment endpoint
 *                   and resolves once the persistence promise from the store completes.
 * @property remove  Deletes the attachment identified by `attachmentId` from the current issue.
 */
export type TAttachmentOperations = {
  create: (file: File) => Promise<void>;
  remove: (attachmentId: string) => Promise<void>;
};

/**
 * Snapshot of in-flight upload state for the issue under view.
 *
 * @property uploadStatus  Array of `TAttachmentUploadStatus` entries currently being uploaded,
 *                         or `undefined` when no uploads are tracked. Sourced from
 *                         `attachment.store.ts` — see that module for entry shape.
 */
export type TAttachmentSnapshot = {
  uploadStatus: TAttachmentUploadStatus[] | undefined;
};

/**
 * Return contract of `useAttachmentOperations`.
 *
 * Bundles the imperative `operations` and the observable `snapshot` so that consumers
 * can pass a single helpers object down to attachment list rows.
 */
export type TAttachmentHelpers = {
  operations: TAttachmentOperations;
  snapshot: TAttachmentSnapshot;
};

/**
 * Hook that binds the issue-detail attachment store to a stable, identifier-scoped
 * imperative API plus an observable upload snapshot.
 *
 * @param workspaceSlug    Workspace slug used for API URL construction.
 * @param projectId        Project identifier of the parent issue.
 * @param issueId          Issue receiving the attachment operations.
 * @param issueServiceType Selects the issue-detail store slice (issues vs. drafts vs. epics).
 *                         Defaults to `EIssueServiceType.ISSUES`.
 * @returns A `TAttachmentHelpers` object — `operations.create(file)` / `operations.remove(id)`
 *          memoized on the identifier tuple and store actions, plus `snapshot.uploadStatus`
 *          read from `attachment.getAttachmentsUploadStatusByIssueId(issueId)`.
 *
 * Side effects:
 *  - `operations.create` triggers `attachment.createAttachment` (POST presigned-upload via
 *    `IssueAttachmentService`) and wraps the promise with `setPromiseToast`
 *    (loading: `"Uploading attachment..."`, success: `"Attachment uploaded"`, error: `"Attachment not uploaded"`).
 *  - `operations.remove` calls `attachment.removeAttachment` (DELETE) and emits `setToast` success
 *    on resolution (`"Attachment removed"`) or `setToast` error in the catch branch (`"Attachment not removed"`).
 *  - Both operations throw `new Error("Missing required fields")` when any of `workspaceSlug`,
 *    `projectId`, or `issueId` is falsy — guards against invalid call sites.
 */
export const useAttachmentOperations = (
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  issueServiceType: TIssueServiceType = EIssueServiceType.ISSUES
): TAttachmentHelpers => {
  const {
    attachment: { createAttachment, removeAttachment, getAttachmentsUploadStatusByIssueId },
  } = useIssueDetail(issueServiceType);

  const attachmentOperations: TAttachmentOperations = useMemo(
    () => ({
      create: async (file) => {
        if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
        const attachmentUploadPromise = createAttachment(workspaceSlug, projectId, issueId, file);
        setPromiseToast(attachmentUploadPromise, {
          loading: "Uploading attachment...",
          success: {
            title: "Attachment uploaded",
            message: () => "The attachment has been successfully uploaded",
          },
          error: {
            title: "Attachment not uploaded",
            message: () => "The attachment could not be uploaded",
          },
        });

        await attachmentUploadPromise;
      },
      remove: async (attachmentId) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await removeAttachment(workspaceSlug, projectId, issueId, attachmentId);
          setToast({
            message: "The attachment has been successfully removed",
            type: TOAST_TYPE.SUCCESS,
            title: "Attachment removed",
          });
        } catch (_error) {
          setToast({
            message: "The Attachment could not be removed",
            type: TOAST_TYPE.ERROR,
            title: "Attachment not removed",
          });
        }
      },
    }),
    [workspaceSlug, projectId, issueId, createAttachment, removeAttachment]
  );
  const attachmentsUploadStatus = getAttachmentsUploadStatusByIssueId(issueId);

  return {
    operations: attachmentOperations,
    snapshot: { uploadStatus: attachmentsUploadStatus },
  };
};
