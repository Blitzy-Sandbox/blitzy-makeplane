/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue attachment contracts mirroring `apps/api/plane/db/models/issue.py::IssueAttachment`
 * and `IssueAttachmentSerializer`; consumed by `apps/web/core/store/issue/issue-details/attachment.store.ts`
 * and the `apps/web/core/components/issues/attachment/` components.
 */

import type { TFileSignedURLResponse } from "../file";

/**
 * Persisted attachment record from the backend serializer; the serializer omits
 * `created_at`, so consumers order by `updated_at`, and `asset_url` may be a
 * short-lived signed URL that must not be assumed long-term cacheable.
 */
export type TIssueAttachment = {
  id: string;
  attributes: {
    name: string;
    size: number;
  };
  asset_url: string;
  issue_id: string;
  // required
  updated_at: string;
  updated_by: string;
  created_by: string;
};

/**
 * Presigned-upload response wrapping the generic envelope with the freshly-created
 * attachment row; bytes must still be uploaded and finalized via `apps/api/plane/app/views/asset/v2.py`
 * before `asset_url` resolves to readable bytes.
 */
export type TIssueAttachmentUploadResponse = TFileSignedURLResponse & {
  attachment: TIssueAttachment;
};

/**
 * Single-attachment-per-issue map used for memoized single-issue fetches in
 * the attachment store.
 */
export type TIssueAttachmentMap = {
  [issue_id: string]: TIssueAttachment;
};

/**
 * Normalized lookup of attachment ids per issue, paired with a flat
 * `Record<attachmentId, TIssueAttachment>` table in the attachment store.
 */
export type TIssueAttachmentIdMap = {
  [issue_id: string]: string[];
};
