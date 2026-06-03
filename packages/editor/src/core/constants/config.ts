/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Baseline editor display settings and file-upload MIME allowlists for `@plane/editor`.
 *
 * Two distinct MIME allowlists are exported because the editor has two separate
 * file-ingress paths with different acceptance policies:
 *   - {@link ACCEPTED_IMAGE_MIME_TYPES}      — narrow, image-only list driving
 *     the custom-image extension UI (image button and file picker).
 *   - {@link ACCEPTED_ATTACHMENT_MIME_TYPES} — broader list driving the unified
 *     drag-drop + paste handler in `core/plugins/drop.ts`.
 *
 * Also exports {@link DEFAULT_DISPLAY_CONFIG}, the per-field fallback baseline
 * consumed by the editor wrapper and container when a caller-supplied display
 * config is missing or partial.
 */

// types
import type { TDisplayConfig } from "@/types";

/**
 * Per-field fallback baseline for the editor's display settings.
 *
 * Every field on {@link TDisplayConfig} is optional, so consumers (e.g. the
 * editor wrapper and the editor container) merge their caller-supplied
 * `displayConfig` against this constant on each render with a per-field `??`
 * fallback. The upstream caller in `apps/web` typically derives the supplied
 * config from user preferences fetched at runtime; this constant is the safety
 * net that guarantees the editor still renders coherently when those
 * preferences are unavailable or partial.
 *
 * Refer to {@link TDisplayConfig} for the field type contract; the JSDoc here
 * intentionally does not restate per-field documentation.
 */
export const DEFAULT_DISPLAY_CONFIG: TDisplayConfig = {
  fontSize: "large-font",
  fontStyle: "sans-serif",
  lineSpacing: "regular",
  wideLayout: false,
};

/**
 * MIME allowlists for files the editor accepts from the user.
 *
 * Two separate lists exist because the editor surfaces two distinct file-ingress
 * UIs, each with its own acceptance policy:
 *
 *   - `ACCEPTED_IMAGE_MIME_TYPES` — narrow, image-only allowlist used by the
 *     custom-image extension. Consumed in
 *     `core/extensions/custom-image/extension.tsx` and
 *     `core/extensions/custom-image/components/uploader.tsx`, where it drives
 *     both the runtime validation set and the HTML `<input accept="…">`
 *     attribute on the file picker.
 *
 *   - {@link ACCEPTED_ATTACHMENT_MIME_TYPES} — broader allowlist used by the
 *     unified drag-drop + paste handler in `core/plugins/drop.ts`. The handler
 *     consults both lists as a union when filtering dropped/pasted files and
 *     also uses {@link ACCEPTED_IMAGE_MIME_TYPES} on its own to classify a file
 *     as an image vs. a generic attachment for routing to the correct
 *     extension.
 *
 * The image MIME types intentionally appear in both lists; the drop handler
 * relies on that overlap, so keep the two arrays in sync when adding new image
 * formats.
 */
export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

/** See the JSDoc above {@link ACCEPTED_IMAGE_MIME_TYPES} for the rationale behind two separate allowlists. */
export const ACCEPTED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/tiff",
  "image/bmp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/rtf",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/midi",
  "audio/x-midi",
  "audio/aac",
  "audio/flac",
  "audio/x-m4a",
  "video/mp4",
  "video/mpeg",
  "video/ogg",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "application/zip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  "model/gltf-binary",
  "model/gltf+json",
  "application/octet-stream",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "text/css",
  "text/javascript",
  "application/json",
  "text/xml",
  "text/csv",
  "application/xml",
];
