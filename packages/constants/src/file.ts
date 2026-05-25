/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Maximum allowed upload size in bytes (5 MiB).
 *
 * Enforced client-side by React Dropzone components before upload begins; the server applies its own
 * (typically larger) cap in `apps/api/plane/app/views/asset/**` and via presigned-POST size constraints
 * (see tech spec §5.2.9). The `useFileSize` hook at `apps/web/ce/hooks/use-file-size.ts` uses this value
 * as the fallback when the runtime instance config does not specify `file_size_limit`.
 *
 * Consumers: avatar/cover/attachment upload widgets across `apps/web/core/components/**` and
 * `apps/web/ce/hooks/use-file-size.ts`.
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Accepted MIME types for the user/workspace avatar upload dropzone.
 *
 * Keys are MIME strings expected by React Dropzone's `accept` prop; values stay empty per Dropzone's
 * "any extension under this MIME" convention (the empty array signals that all file extensions matching
 * the MIME are accepted).
 *
 * Consumers: `apps/web/core/components/core/modals/user-image-upload-modal.tsx` and
 * `apps/web/core/components/core/modals/workspace-image-upload-modal.tsx`.
 */
export const ACCEPTED_AVATAR_IMAGE_MIME_TYPES_FOR_REACT_DROPZONE = {
  "image/jpeg": [],
  "image/jpg": [],
  "image/png": [],
  "image/webp": [],
};
/**
 * Accepted MIME types for the project/workspace cover image upload dropzone.
 *
 * Structurally identical to {@link ACCEPTED_AVATAR_IMAGE_MIME_TYPES_FOR_REACT_DROPZONE} today but kept
 * as a separate constant so the avatar and cover dropzones can diverge in the future without coupling.
 *
 * Consumers: `apps/web/core/components/core/image-picker-popover.tsx`.
 */
export const ACCEPTED_COVER_IMAGE_MIME_TYPES_FOR_REACT_DROPZONE = {
  "image/jpeg": [],
  "image/jpg": [],
  "image/png": [],
  "image/webp": [],
};

/**
 * File extensions blocked from upload to prevent execution-vector attachments.
 *
 * Mirrored by server-side validation in `apps/api/plane/app/views/asset/**`; this client-side list
 * provides a friendly pre-flight check (including a guard against double-extension smuggling such as
 * `report.exe.pdf`) before the upload is attempted.
 *
 * Consumers: `packages/services/src/file/helper.ts` (`validateFilename`) and attachment/asset upload
 * validators across `apps/web/core/components/**`.
 */
export const DANGEROUS_EXTENSIONS = [
  "exe",
  "bat",
  "cmd",
  "sh",
  "php",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "dll",
  "vbs",
  "jar",
  "ps1",
];
