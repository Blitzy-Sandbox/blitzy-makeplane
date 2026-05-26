/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Upload fallback UX for the custom-image node.
 *
 * Rendered by `CustomImageNodeView` (./node-view.tsx) when the underlying image
 * node is not yet a fully-uploaded image — i.e., before `src` is set, while
 * uploading, when the image source failed to load, or when a copy-paste
 * duplication attempt failed. Handles the placeholder text, hidden file input,
 * drag-and-drop dropzone, and (when duplication failed) the retry button.
 *
 * Display states:
 *   - "Add an image"        — idle, editable
 *   - "Drop image here"     — dragging a file over the dropzone, editable
 *   - "Uploading..."        — an upload is in flight
 *   - "Error loading image" — image source failed to load or duplication failed
 *
 * Hooks used:
 *   - `useUploader` (from `@/hooks/use-file-upload`) orchestrates the upload
 *     lifecycle (validate, flip status to UPLOADING, invoke
 *     `extension.options.uploadImage`, report progress).
 *   - `useDropZone` (from `@/hooks/use-file-upload`) wires drag/drop handlers.
 *   - `uploadFirstFileAndInsertRemaining` — when the `<input multiple>` selects
 *     several files, the first uploads into the current node and the
 *     remainder are inserted as additional image nodes following this one.
 *
 * Cross-extension dependencies:
 *   - Writes `editor.storage.utility.uploadInProgress` (boolean) via
 *     `handleProgressStatus`; external code (e.g., the document save pipeline
 *     in apps/api) can read this flag to detect a pending upload.
 *   - Reads `editor.storage.utility.isTouchDevice` to gate auto-opening the
 *     native file picker on mount; auto-open is disabled on touch devices
 *     because mobile WebViews handle synthetic clicks inconsistently.
 *
 * Mount-time upload resumption:
 *   On mount this component looks up the per-node `UploadEntity` (defined in
 *   `../types.ts` as `{ event: "insert" | "drop"; ... }`) in
 *   `editor.storage.imageComponent.fileMap` via `getImageComponentImageFileMap`
 *   from `../utils`. For `event === "drop"` entries with a `file`, auto-invokes
 *   `uploadFile(file)`. For `event === "insert"` entries (e.g., the toolbar
 *   "Insert image" button), programmatically clicks the hidden file input on
 *   non-touch devices to open the native picker and stores
 *   `hasOpenedFileInputOnce: true` so subsequent renders don't re-open it.
 *
 * Post-upload cursor handling:
 *   After a successful upload the cursor is moved to a following paragraph
 *   (or a new paragraph is created via `editor.commands.createParagraphNear()`).
 *   Cursor manipulation is gated by a race-condition check
 *   (`currentNode.type.name === node.type.name && currentNode.attrs.src === url`)
 *   so concurrent edits made while the upload was in flight don't reposition
 *   the cursor incorrectly.
 *
 * Consumed by:
 *   - `./node-view.tsx` — `CustomImageNodeView` renders this uploader
 *     conditionally when `shouldShowBlock` is false.
 */

import { ImageIcon, RotateCcw } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
// plane imports
import { cn } from "@plane/utils";
// constants
import { ACCEPTED_IMAGE_MIME_TYPES } from "@/constants/config";
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import type { EFileError } from "@/helpers/file";
// hooks
import { useUploader, useDropZone, uploadFirstFileAndInsertRemaining } from "@/hooks/use-file-upload";
// local imports
import { ECustomImageStatus } from "../types";
import { getImageComponentImageFileMap } from "../utils";
import type { CustomImageNodeViewProps } from "./node-view";

/**
 * Props for {@link CustomImageUploader}.
 *
 * Extends `CustomImageNodeViewProps` from `./node-view` with five
 * upload-specific fields owned by the parent `CustomImageNodeView`:
 *
 * - `failedToLoadImage` (boolean) — set by the parent when the rendered image
 *   source 404s or otherwise fails to load.
 * - `hasDuplicationFailed` (boolean) — set by the parent when a copy-paste
 *   duplication attempt has failed.
 * - `loadImageFromFileSystem` ((file: string) => void) — callback used during
 *   local-file preview; the parent shows the file-system blob URL while the
 *   network upload completes.
 * - `maxFileSize` (number) — max upload size in bytes; sourced from
 *   `editor.storage.imageComponent.maxFileSize` in the parent
 *   `CustomImageNodeView`.
 * - `setIsUploaded` ((isUploaded: boolean) => void) — callback the parent uses
 *   to flip its `isUploaded` flag once the network upload finalizes.
 */
type CustomImageUploaderProps = CustomImageNodeViewProps & {
  failedToLoadImage: boolean;
  hasDuplicationFailed: boolean;
  loadImageFromFileSystem: (file: string) => void;
  maxFileSize: number;
  setIsUploaded: (isUploaded: boolean) => void;
};

/**
 * Renders the fallback upload UX (placeholder, hidden file input, drop zone,
 * and a retry button on duplication failure) for a custom-image node that is
 * not yet a fully-uploaded image.
 *
 * @param props - See {@link CustomImageUploaderProps} for the full prop
 *   contract (`editor`, `extension`, `node`, `failedToLoadImage`,
 *   `hasDuplicationFailed`, `loadImageFromFileSystem`, `maxFileSize`,
 *   `setIsUploaded`, plus the inherited `NodeViewProps` fields).
 *
 * MobX stores read: NONE — this is editor-internal code; the documentation
 * directive about MobX applies to `apps/web` stores, not to the @plane/editor
 * package.
 *
 * Side effects:
 *   - Calls `extension.options.uploadImage(imageEntityId, file)` to perform
 *     the server-side upload (contract defined in `../types.ts` →
 *     `CustomImageExtensionOptions`).
 *   - Calls `updateAttributes({ src, status: UPLOADED })` on success.
 *   - Calls `imageComponentImageFileMap.delete(imageEntityId)` to clean up
 *     the upload-meta entry.
 *   - Calls `editor.commands.setTextSelection(pos + 1)` or
 *     `editor.commands.createParagraphNear()` to advance the cursor after
 *     upload (gated by the race-condition guard described in the module doc).
 *   - Writes `editor.storage.utility.uploadInProgress = isUploading` for
 *     cross-extension observation.
 *   - On invalid file: `alert(message)` (user-visible browser dialog).
 */
export function CustomImageUploader(props: CustomImageUploaderProps) {
  const {
    editor,
    extension,
    failedToLoadImage,
    getPos,
    loadImageFromFileSystem,
    maxFileSize,
    node,
    selected,
    setIsUploaded,
    updateAttributes,
    hasDuplicationFailed,
  } = props;
  // refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasTriggeredFilePickerRef = useRef(false);
  const hasTriedUploadingOnMountRef = useRef(false);
  const { id: imageEntityId } = node.attrs;
  // derived values
  const imageComponentImageFileMap = useMemo(() => getImageComponentImageFileMap(editor), [editor]);
  // editor.storage.utility is owned by UtilityExtension; isTouchDevice gates
  // auto-opening the native file picker (mobile WebViews handle synthetic
  // clicks inconsistently, so we skip the auto-open there).
  const isTouchDevice = !!editor.storage.utility.isTouchDevice;

  /**
   * Finalizes an upload: writes the resolved asset src into node attrs, marks
   * the node as UPLOADED, clears the file-map meta entry, and advances the
   * cursor.
   *
   * Cursor advance is gated on
   * (`currentNode.type === node.type && currentNode.attrs.src === url`) to
   * avoid repositioning if a concurrent edit moved the selection elsewhere
   * while the upload was in flight.
   */
  const onUpload = useCallback(
    (url: string) => {
      if (url) {
        if (!imageEntityId) return;
        setIsUploaded(true);
        // Update the node view's src attribute post upload
        updateAttributes({
          src: url,
          status: ECustomImageStatus.UPLOADED,
        });
        imageComponentImageFileMap?.delete(imageEntityId);

        const pos = getPos();
        // get current node
        const getCurrentSelection = editor.state.selection;
        const currentNode = editor.state.doc.nodeAt(getCurrentSelection.from);

        // Race-condition guard: only reposition the cursor if the user hasn't moved
        // the selection away from the just-uploaded image while the upload was in flight.
        // only if the cursor is at the current image component, manipulate
        // the cursor position
        if (
          currentNode &&
          currentNode.type.name === node.type.name &&
          currentNode.attrs.src === url &&
          pos !== undefined
        ) {
          // control cursor position after upload
          const nextNode = editor.state.doc.nodeAt(pos + 1);

          if (nextNode && nextNode.type.name === CORE_EXTENSIONS.PARAGRAPH) {
            // If there is a paragraph node after the image component, move the focus to the next node
            editor.commands.setTextSelection(pos + 1);
          } else {
            // create a new paragraph after the image component post upload
            editor.commands.createParagraphNear();
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageComponentImageFileMap, imageEntityId, updateAttributes, getPos]
  );

  const uploadImageEditorCommand = useCallback(
    async (file: File) => {
      updateAttributes({ status: ECustomImageStatus.UPLOADING });
      return await extension.options.uploadImage?.(imageEntityId ?? "", file);
    },
    [extension.options, imageEntityId, updateAttributes]
  );

  const handleProgressStatus = useCallback(
    (isUploading: boolean) => {
      // Mirror upload-in-progress to cross-extension storage so external code
      // (e.g., the document save pipeline in apps/api) can detect any pending upload.
      editor.storage.utility.uploadInProgress = isUploading;
    },
    [editor]
  );

  const handleInvalidFile = useCallback((_error: EFileError, _file: File, message: string) => {
    alert(message);
  }, []);

  // hooks
  const { isUploading: isImageBeingUploaded, uploadFile } = useUploader({
    acceptedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
    editorCommand: uploadImageEditorCommand,
    handleProgressStatus,
    loadFileFromFileSystem: loadImageFromFileSystem,
    maxFileSize,
    onInvalidFile: handleInvalidFile,
    onUpload,
  });

  const { draggedInside, onDrop, onDragEnter, onDragLeave } = useDropZone({
    editor,
    getPos,
    type: "image",
    uploader: uploadFile,
  });

  /**
   * Resumes the upload that was queued when the image node was inserted.
   *
   * For drop entries with a `file`, this auto-invokes `uploadFile(file)`.
   * For insert entries (e.g., clicking the toolbar "Insert image" button),
   * this programmatically clicks the hidden file input on non-touch devices
   * to open the native picker. The `hasOpenedFileInputOnce` flag prevents
   * re-opening on subsequent renders.
   */
  // after the image component is mounted we start the upload process based on
  // it's uploaded
  useEffect(() => {
    if (hasTriedUploadingOnMountRef.current) return;

    // the meta data of the image component
    const meta = imageComponentImageFileMap?.get(imageEntityId ?? "");
    if (meta) {
      if (meta.event === "drop" && "file" in meta) {
        hasTriedUploadingOnMountRef.current = true;
        uploadFile(meta.file);
      } else if (meta.event === "insert" && fileInputRef.current && !hasTriggeredFilePickerRef.current) {
        if (meta.hasOpenedFileInputOnce) return;
        if (!isTouchDevice) {
          fileInputRef.current.click();
        }
        hasTriggeredFilePickerRef.current = true;
        imageComponentImageFileMap?.set(imageEntityId ?? "", { ...meta, hasOpenedFileInputOnce: true });
      }
    } else {
      hasTriedUploadingOnMountRef.current = true;
    }
  }, [imageEntityId, isTouchDevice, uploadFile, imageComponentImageFileMap]);

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      e.preventDefault();
      const filesList = e.target.files;
      const pos = getPos();
      if (!filesList || pos === undefined) {
        return;
      }
      await uploadFirstFileAndInsertRemaining({
        editor,
        filesList,
        pos,
        type: "image",
        uploader: uploadFile,
      });
    },
    [uploadFile, editor, getPos]
  );

  const isErrorState = failedToLoadImage || hasDuplicationFailed;

  const borderColor =
    selected && editor.isEditable && !isErrorState
      ? "color-mix(in srgb, var(--border-color-accent-strong) 20%, transparent)"
      : undefined;

  const getDisplayMessage = useCallback(() => {
    const isUploading = isImageBeingUploaded;
    if (isErrorState) {
      return "Error loading image";
    }

    if (isUploading) {
      return "Uploading...";
    }

    if (draggedInside && editor.isEditable) {
      return "Drop image here";
    }

    return "Add an image";
  }, [draggedInside, editor.isEditable, isErrorState, isImageBeingUploaded]);

  const handleRetryClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasDuplicationFailed && editor.isEditable) {
        updateAttributes({ status: ECustomImageStatus.DUPLICATING });
      }
    },
    [hasDuplicationFailed, editor.isEditable, updateAttributes]
  );

  return (
    <div
      className={cn(
        "image-upload-component flex cursor-default items-center justify-start gap-2 rounded-lg border border-dashed bg-layer-3 px-2 py-3 text-tertiary transition-all duration-200 ease-in-out",
        {
          "border-subtle": !(selected && editor.isEditable && !isErrorState),
          "cursor-pointer hover:bg-layer-3-hover hover:text-secondary": editor.isEditable && !isErrorState,
          "bg-layer-3-hover text-secondary": draggedInside && editor.isEditable && !isErrorState,
          "bg-accent-primary/10 text-accent-secondary hover:bg-accent-primary/10 hover:text-accent-secondary":
            selected && editor.isEditable && !isErrorState,
          "cursor-default bg-danger-subtle text-danger-primary": isErrorState,
          "hover:bg-danger-subtle-hover hover:text-danger-primary": isErrorState && editor.isEditable,
          "bg-danger-subtle-selected": isErrorState && selected,
          "hover:bg-danger-subtle-active": isErrorState && selected && editor.isEditable,
        }
      )}
      style={borderColor ? { borderColor } : undefined}
      onDrop={onDrop}
      onDragOver={onDragEnter}
      onDragLeave={onDragLeave}
      contentEditable={false}
      onClick={() => {
        if (!failedToLoadImage && editor.isEditable && !hasDuplicationFailed) {
          fileInputRef.current?.click();
        }
      }}
    >
      <ImageIcon className="size-4" />
      <div className="flex-1 text-14 font-medium">{getDisplayMessage()}</div>
      {hasDuplicationFailed && editor.isEditable && (
        <button
          type="button"
          onClick={handleRetryClick}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 font-medium text-danger-primary transition-all duration-200 ease-in-out hover:bg-danger-subtle-hover",
            {
              "hover:bg-danger-subtle-hover": selected,
            }
          )}
          title="Retry duplication"
        >
          <RotateCcw className="size-3" />
          <span className="text-11">Retry</span>
        </button>
      )}
      <input
        className="size-0 overflow-hidden"
        ref={fileInputRef}
        hidden
        type="file"
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
        onChange={onFileChange}
        multiple
      />
    </div>
  );
}
