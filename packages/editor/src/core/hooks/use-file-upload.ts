/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Client-side file-upload and drag-and-drop primitives for the editor's attachment and image UI.
 *
 * - `useUploader` orchestrates a single-file upload flow: MIME-type validation,
 *   optional local preview via `FileReader`, the async upload command, and
 *   progress-status notification.
 * - `useDropZone` manages browser drag state at the document level and delegates
 *   multi-file drops to `uploadFirstFileAndInsertRemaining`.
 *
 * Note: `uploadFirstFileAndInsertRemaining` is exported (publicly callable) but is
 * primarily an internal helper consumed by `useDropZone`.
 */

import type { Editor, NodeViewProps } from "@tiptap/core";
import type { DragEvent } from "react";
import { useCallback, useEffect, useState } from "react";
// helpers
import type { EFileError } from "@/helpers/file";
import { isFileValid } from "@/helpers/file";
// plugins
import { insertFilesSafely } from "@/plugins/drop";
// types
import type { TEditorCommands } from "@/types";

/**
 * Inputs accepted by `useUploader`.
 *
 * Fields:
 *  - `acceptedMimeTypes`: MIME allowlist enforced by `isFileValid`; values originate from
 *    `ACCEPTED_*` constants in `core/constants/config.ts`.
 *  - `editorCommand`: async function that performs the actual upload and returns the final
 *    server URL (or `undefined` on failure).
 *  - `handleProgressStatus`: optional progress sink (e.g., to drive a global
 *    "is uploading" UI flag).
 *  - `loadFileFromFileSystem`: optional callback receiving the local data URL (from
 *    `FileReader.readAsDataURL`) so the UI can show a preview before the server URL resolves.
 *  - `maxFileSize`: byte limit enforced by `isFileValid`.
 *  - `onInvalidFile`: invoked with an `EFileError` discriminator and the offending file
 *    when validation fails (both MIME-type rejection and oversize rejection use this callback
 *    with different `EFileError` codes).
 *  - `onUpload`: invoked once with the final server URL after a successful upload.
 */
type TUploaderArgs = {
  acceptedMimeTypes: string[];
  editorCommand: (file: File) => Promise<string | undefined>;
  handleProgressStatus?: (isUploading: boolean) => void;
  loadFileFromFileSystem?: (file: string) => void;
  maxFileSize: number;
  onInvalidFile: (error: EFileError, file: File, message: string) => void;
  onUpload: (url: string, file: File) => void;
};

/**
 * Single-file upload hook with validation, optional local preview, and progress reporting.
 *
 * When `loadFileFromFileSystem` is provided, the hook reads the file as a data URL via
 * `FileReader.readAsDataURL` and pushes that into the UI immediately so users see a preview
 * while the server-side upload completes; the preview URL is later replaced by
 * `onUpload(url, file)` once the real URL is known.
 *
 * Returns `{ isUploading, uploadFile }` — `isUploading` is a local React state flag and
 * `uploadFile(file)` is the user-facing trigger.
 *
 * Side effects:
 *  - Validates the file via `isFileValid` (rejects on bad MIME or oversize via `onInvalidFile`).
 *  - Reads a local data URL via `FileReader` only when `loadFileFromFileSystem` is provided.
 *  - Calls `editorCommand(file)` to perform the network upload.
 *  - Calls `onUpload(url, file)` on success; `console.error`s on caught failures.
 *  - Calls `handleProgressStatus(true | false)` around the upload window.
 *
 * `editorCommand` failures (rejected promise or `undefined` URL) are caught and logged;
 * no exception escapes the hook.
 */
export const useUploader = (args: TUploaderArgs) => {
  const {
    acceptedMimeTypes,
    editorCommand,
    handleProgressStatus,
    loadFileFromFileSystem,
    maxFileSize,
    onInvalidFile,
    onUpload,
  } = args;
  // states
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      handleProgressStatus?.(true);
      setIsUploading(true);
      const isValid = isFileValid({
        acceptedMimeTypes,
        file,
        maxFileSize,
        onError: (error, message) => onInvalidFile(error, file, message),
      });
      if (!isValid) {
        handleProgressStatus?.(false);
        setIsUploading(false);
        return;
      }
      try {
        if (loadFileFromFileSystem) {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result) {
              loadFileFromFileSystem(reader.result as string);
            } else {
              console.error("Failed to read the file: reader.result is null");
            }
          };
          reader.onerror = () => {
            console.error("Error reading file");
          };
          reader.readAsDataURL(file);
        }
        const url = await editorCommand(file);

        if (!url) {
          throw new Error("Something went wrong while uploading the file.");
        }
        onUpload(url, file);
      } catch {
        console.error("useFileUpload: Error in uploading file");
      } finally {
        handleProgressStatus?.(false);
        setIsUploading(false);
      }
    },
    [
      acceptedMimeTypes,
      editorCommand,
      handleProgressStatus,
      loadFileFromFileSystem,
      maxFileSize,
      onInvalidFile,
      onUpload,
    ]
  );

  return { isUploading, uploadFile };
};

/**
 * Inputs accepted by `useDropZone`.
 *
 * Fields:
 *  - `editor`: the TipTap `Editor` instance the drop targets.
 *  - `getPos`: ProseMirror node-view position function used as the insertion anchor for
 *    additional files.
 *  - `type`: narrowed `TEditorCommands` discriminator — either `"attachment"` or `"image"`.
 *  - `uploader`: the per-file upload callback (usually `useUploader().uploadFile`).
 */
type TDropzoneArgs = {
  editor: Editor;
  getPos: NodeViewProps["getPos"];
  type: Extract<TEditorCommands, "attachment" | "image">;
  uploader: (file: File) => Promise<void>;
};

/**
 * Drag-and-drop coordinator that listens for document-wide drag activity and dispatches
 * file drops into the editor.
 *
 * Side effects:
 *  - Installs `dragstart` and `dragend` listeners on `document.body` in a `useEffect`
 *    (cleaned up on unmount). Listeners are global because the editor's drop UI must
 *    react to drags that begin outside the editor's DOM tree.
 *
 * Returned shape and contract:
 *  - `isDragging`: true between any `document.body` `dragstart` and `dragend`
 *    (a global drag is in progress anywhere on the page).
 *  - `draggedInside`: true while the dragged file pointer is over THIS drop zone
 *    (set by `onDragEnter`, cleared by `onDragLeave` and after `onDrop`).
 *  - `onDragEnter` / `onDragLeave`: zone-local handlers callers attach to the wrapping
 *    `<div>` element.
 *  - `onDrop`: zone-local handler that calls `e.preventDefault()`, resolves the editor
 *    position from `getPos()`, no-ops when no files are present or the editor is read-only
 *    or the position is undefined, and delegates to `uploadFirstFileAndInsertRemaining`
 *    for the multi-file case.
 */
export const useDropZone = (args: TDropzoneArgs) => {
  const { editor, getPos, type, uploader } = args;
  // states
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [draggedInside, setDraggedInside] = useState<boolean>(false);

  useEffect(() => {
    const dragStartHandler = () => {
      setIsDragging(true);
    };

    const dragEndHandler = () => {
      setIsDragging(false);
    };

    document.body.addEventListener("dragstart", dragStartHandler);
    document.body.addEventListener("dragend", dragEndHandler);

    return () => {
      document.body.removeEventListener("dragstart", dragStartHandler);
      document.body.removeEventListener("dragend", dragEndHandler);
    };
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDraggedInside(false);
      const filesList = e.dataTransfer.files;
      const pos = getPos();

      if (filesList.length === 0 || !editor.isEditable || pos === undefined) {
        return;
      }

      await uploadFirstFileAndInsertRemaining({
        editor,
        filesList,
        pos,
        type,
        uploader,
      });
    },
    [editor, type, uploader, getPos]
  );
  const onDragEnter = useCallback(() => setDraggedInside(true), []);
  const onDragLeave = useCallback(() => setDraggedInside(false), []);

  return {
    isDragging,
    draggedInside,
    onDragEnter,
    onDragLeave,
    onDrop,
  };
};

/**
 * Inputs accepted by `uploadFirstFileAndInsertRemaining`.
 *
 * Fields mirror the `useDropZone` arguments plus the resolved `pos` and the raw browser `FileList`.
 */
type TMultipleFileArgs = {
  editor: Editor;
  filesList: FileList;
  pos: number;
  type: Extract<TEditorCommands, "attachment" | "image">;
  uploader: (file: File) => Promise<void>;
};

/**
 * Uploads the first file in the list synchronously via `uploader`, then asks ProseMirror to
 * insert the remaining files as fresh nodes via `insertFilesSafely`.
 *
 * The first-file upload is intentionally NOT awaited — it is fire-and-forget so the rest of the
 * list can be inserted immediately. This split exists because the first file already has a node
 * in the editor at `pos` (the drop target) and only needs the upload to populate it; the
 * remaining files need new placeholder nodes inserted at sequential positions (computed as
 * `Math.min(pos + 1, docSize)` to avoid out-of-range insertions on small documents).
 * `insertFilesSafely` is responsible for placeholder creation and subsequent per-file upload
 * triggering.
 *
 * Side effects:
 *  - Invokes `uploader(firstFile)` (fire-and-forget; no `await`).
 *  - Invokes `insertFilesSafely(...)` (a `core/plugins/drop` helper) for files 1..N.
 *
 * Returns `Promise<void>`. Empty `filesList` logs an error to console and early-returns.
 */
export const uploadFirstFileAndInsertRemaining = async (args: TMultipleFileArgs) => {
  const { editor, filesList, pos, type, uploader } = args;
  const filesArray = Array.from(filesList);
  if (filesArray.length === 0) {
    console.error("No files found to upload.");
    return;
  }

  // Upload the first file
  const firstFile = filesArray[0];
  uploader(firstFile);
  // Insert the remaining files
  const remainingFiles = filesArray.slice(1);
  if (remainingFiles.length > 0) {
    const docSize = editor.state.doc.content.size;
    const posOfNextFileToBeInserted = Math.min(pos + 1, docSize);
    insertFilesSafely({
      editor,
      files: remainingFiles,
      initialPos: posOfNextFileToBeInserted,
      event: "drop",
      type,
    });
  }
};
