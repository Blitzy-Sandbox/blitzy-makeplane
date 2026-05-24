/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue attachment contracts for the `@plane/types/issues` subfolder.
 *
 * Models file blobs (PDF, image, document, etc.) attached to an issue and
 * rendered in the issue-detail "Attachments" panel. The shapes here mirror
 * `apps/api/plane/db/models/issue.py::IssueAttachment` on the backend and the
 * `apps/api/plane/app/serializers/issue.py::IssueAttachmentSerializer`
 * representation; treat the serializer as the source of truth when these
 * types and the wire payload disagree.
 *
 * Upload contract (three phases — kept here so consumers don't need to read
 * the asset view to understand the lifecycle):
 *   1. Client requests a presigned URL envelope from the asset endpoint;
 *      the response is shaped as {@link TIssueAttachmentUploadResponse}, a
 *      composite of the generic presigned envelope and the freshly-created
 *      attachment row.
 *   2. Client uploads the file bytes directly to object storage using the
 *      `upload_data` POST envelope (see {@link TFileSignedURLResponse} in
 *      `../file` for the underlying S3 / object-store contract).
 *   3. Client finalizes the attachment via a separate confirmation call
 *      handled by `apps/api/plane/app/views/asset/v2.py`.
 *
 * Consumed by `apps/web/core/store/issue/issue-details/attachment.store.ts`
 * for normalized state, and by the components in
 * `apps/web/core/components/issues/attachment/` for rendering and uploads.
 * Re-exported via the folder barrel `./base.ts`, so importers should pull
 * from `@plane/types` rather than from this module directly.
 */

import type { TFileSignedURLResponse } from "../file";

/**
 * Persisted attachment record as returned by the backend serializer.
 *
 * Combines storage identity (`id`, `asset_url`), human metadata
 * (`attributes`), the parent issue foreign key, and a trimmed audit trail.
 * Note: the serializer intentionally omits `created_at` — consumers sort
 * and display by `updated_at` instead.
 *
 * @property id - Attachment primary key (UUID, server-set on persist).
 * @property attributes - Embedded file metadata blob preserved from upload.
 * @property attributes.name - Original filename as uploaded by the user,
 *   preserved verbatim for display and download-as semantics.
 * @property attributes.size - File size in bytes.
 * @property asset_url - URL to the asset bytes. May be a public URL or a
 *   short-lived signed URL with expiration depending on the workspace's
 *   privacy settings — consumers must NOT assume long-term cacheability.
 * @property issue_id - Foreign key to the owning `TIssue`.
 * @property updated_at - Last-modified timestamp transported as an ISO-8601
 *   string; used in lieu of `created_at` for ordering since the serializer
 *   does not expose `created_at`.
 * @property updated_by - User id of the last editor (audit trail).
 * @property created_by - User id of the original uploader (audit trail).
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
 * Composite response returned by the presigned-upload endpoint.
 *
 * Wraps the underlying {@link TFileSignedURLResponse} (the generic presigned
 * POST envelope defined in `../file`) with the freshly-created `attachment`
 * record. The client uploads the file bytes to the presigned URL THEN
 * issues a separate finalize call (see `apps/api/plane/app/views/asset/v2.py`)
 * to flip the record into a usable state — until that confirmation succeeds,
 * the `attachment.asset_url` may not resolve to readable bytes.
 *
 * @property attachment - The newly-persisted `TIssueAttachment` row, returned
 *   alongside the presigned URL so the client can render an optimistic entry
 *   immediately without waiting for the upload + finalize round-trip.
 */
export type TIssueAttachmentUploadResponse = TFileSignedURLResponse & {
  attachment: TIssueAttachment;
};

/**
 * Lookup of a single attachment record keyed by `issue_id`.
 *
 * Single-attachment-per-issue map shape used by the attachment store for
 * memoized single-issue fetches. Multi-attachment listings are normalized
 * separately via {@link TIssueAttachmentIdMap} plus a flat
 * `Record<attachmentId, TIssueAttachment>` table.
 */
export type TIssueAttachmentMap = {
  [issue_id: string]: TIssueAttachment;
};

/**
 * Lookup of attachment ids by `issue_id` for normalized state.
 *
 * Paired with a flat `Record<attachmentId, TIssueAttachment>` in the
 * attachment store, this map preserves per-issue ordering while keeping
 * each attachment row stored exactly once — avoiding duplication when the
 * same attachment is referenced from multiple list views.
 */
export type TIssueAttachmentIdMap = {
  [issue_id: string]: string[];
};
