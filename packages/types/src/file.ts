/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * File upload contracts for the `@plane/types` package.
 *
 * Models the metadata, S3 presigned POST envelope, and asset duplication payloads used
 * by `apps/api/plane/app/views/asset/v2.py`. See tech spec §5.2.9 for the presigned upload
 * sequence. `entity_type` uses `EFileAssetType` to discriminate the parent entity (issue,
 * page, comment, project cover, user avatar, etc.).
 */

import type { EFileAssetType } from "./enums";

/**
 * Minimal file-side metadata (no entity context).
 *
 * Fields:
 * - `name`: original filename
 * - `size`: file size in bytes (server-side limit varies by entity_type and plan)
 * - `type`: MIME type (e.g. "image/png")
 */
export type TFileMetaDataLite = {
  name: string;
  // file size in bytes
  size: number;
  type: string;
};

/**
 * Entity-side asset linkage.
 *
 * Fields:
 * - `entity_identifier`: id of the parent entity (issue, page, etc.) the file is attached to
 * - `entity_type`: discriminator from `EFileAssetType` identifying which entity family
 *   (e.g. ISSUE_ATTACHMENT, PAGE_DESCRIPTION, USER_AVATAR)
 */
export type TFileEntityInfo = {
  entity_identifier: string;
  entity_type: EFileAssetType;
};

/**
 * Combined metadata + entity linkage — used in upload-finalize requests.
 */
export type TFileMetaData = TFileMetaDataLite & TFileEntityInfo;

/**
 * S3 presigned POST envelope returned by the upload-start endpoint.
 *
 * The client should POST the file to `upload_data.url` using `upload_data.fields` as
 * form fields (multipart/form-data). On successful upload, call the finalize endpoint
 * with `asset_id` to link the asset to the parent entity. See tech spec §5.2.9.
 *
 * Fields:
 * - `asset_id`: stable asset id (use this when finalizing or referencing the asset)
 * - `asset_url`: long-lived public/internal URL of the asset (post-upload)
 * - `upload_data.url`: S3 endpoint to POST the file to
 * - `upload_data.fields`: AWS SigV4 form fields (must be sent verbatim, in this exact order)
 */
export type TFileSignedURLResponse = {
  asset_id: string;
  asset_url: string;
  upload_data: {
    url: string;
    fields: {
      "Content-Type": string;
      key: string;
      "x-amz-algorithm": string;
      "x-amz-credential": string;
      "x-amz-date": string;
      policy: string;
      "x-amz-signature": string;
    };
  };
};

/**
 * Request payload to duplicate one or more assets in the asset store.
 *
 * Used when cloning an issue/page — the existing asset blobs are copied server-side
 * to new asset ids tied to the cloned entity.
 *
 * Fields:
 * - `entity_id`: id of the new (target) parent entity
 * - `entity_type`: discriminator for the new parent
 * - `project_id`: optional — required when target entity is project-scoped
 * - `asset_ids`: ids of source assets to copy
 */
export type TDuplicateAssetData = {
  entity_id: string;
  entity_type: EFileAssetType;
  project_id?: string;
  asset_ids: string[];
};

/**
 * Response map from source asset id → new (duplicated) asset id.
 *
 * Consumers should rewrite references in the cloned entity's content using this map.
 */
export type TDuplicateAssetResponse = Record<string, string>; // asset_id -> new_asset_id
