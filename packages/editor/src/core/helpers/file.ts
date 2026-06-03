/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * File validation helpers used by the editor's image upload flows.
 *
 * Validates file presence, MIME type against an accepted list, and file size against a maximum; surfaces failures through an injected `onError` callback so the caller can display per-error messages.
 */

/**
 * Discriminator for file validation failure modes surfaced by `isFileValid`.
 *
 * Consumers (custom-image extension, `use-file-upload` hook) switch on these values to render an error-specific message in the uploader UI.
 */
export enum EFileError {
  INVALID_FILE_TYPE = "INVALID_FILE_TYPE",
  FILE_SIZE_TOO_LARGE = "FILE_SIZE_TOO_LARGE",
  NO_FILE_SELECTED = "NO_FILE_SELECTED",
}

type TArgs = {
  acceptedMimeTypes: string[];
  file: File;
  maxFileSize: number;
  onError: (error: EFileError, message: string) => void;
};

/**
 * Validates a `File` against MIME-type and size constraints, invoking `onError` and returning `false` for the first violation; otherwise returns `true`.
 *
 * Consumed by `extensions/custom-image/extension.tsx` (drop/paste paths) and `hooks/use-file-upload.ts` (input file paths) to short-circuit upload before the asset service is contacted.
 *
 * @param args.acceptedMimeTypes - Allow-list of MIME strings; `file.type` must be present in this list.
 * @param args.file - The browser `File` object to validate.
 * @param args.maxFileSize - Maximum allowed size in bytes; the error message divides by 1024*1024 for the displayed MB limit.
 * @param args.onError - Failure-callback invoked with one of `EFileError.NO_FILE_SELECTED`, `EFileError.INVALID_FILE_TYPE`, or `EFileError.FILE_SIZE_TOO_LARGE` plus a human-readable message.
 */
export const isFileValid = (args: TArgs): boolean => {
  const { acceptedMimeTypes, file, maxFileSize, onError } = args;

  if (!file) {
    onError(EFileError.NO_FILE_SELECTED, "No file selected. Please select a file to upload.");
    return false;
  }

  if (!acceptedMimeTypes.includes(file.type)) {
    onError(EFileError.INVALID_FILE_TYPE, "Invalid file type.");
    return false;
  }

  if (file.size > maxFileSize) {
    onError(
      EFileError.FILE_SIZE_TOO_LARGE,
      `File size too large. Please select a file smaller than ${maxFileSize / 1024 / 1024}MB.`
    );
    return false;
  }

  return true;
};
