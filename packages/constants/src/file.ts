/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Client-side maximum upload size (5 MiB) — fallback when instance config omits
 * `file_size_limit`; server applies its own cap via presigned POST (tech spec §5.2.9).
 * Consumer: `apps/web/ce/hooks/use-file-size.ts` and upload widgets in `apps/web/core/components/**`.
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * MIME allow-list for the avatar upload Dropzone (`accept` prop) — empty arrays
 * follow Dropzone's "any extension under this MIME" convention.
 * Consumer: `apps/web/core/components/core/modals/{user,workspace}-image-upload-modal.tsx`.
 */
export const ACCEPTED_AVATAR_IMAGE_MIME_TYPES_FOR_REACT_DROPZONE = {
  "image/jpeg": [],
  "image/jpg": [],
  "image/png": [],
  "image/webp": [],
};
/**
 * MIME allow-list for the project/workspace cover image Dropzone — duplicated from
 * the avatar list to allow future divergence without coupling.
 * Consumer: `apps/web/core/components/core/image-picker-popover.tsx`.
 */
export const ACCEPTED_COVER_IMAGE_MIME_TYPES_FOR_REACT_DROPZONE = {
  "image/jpeg": [],
  "image/jpg": [],
  "image/png": [],
  "image/webp": [],
};

/**
 * Execution-vector extensions blocked client-side — mirrors server validation in
 * `apps/api/plane/app/views/asset/**` and guards against double-extension smuggling.
 * Consumer: `packages/services/src/file/helper.ts` (`validateFilename`).
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
