/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type-only contract module for the custom-image extension.
 *
 * Defines the canonical attribute keys, the attribute value shapes, the
 * alignment + status enums, the upload tracking entity, the extension
 * options + storage shapes, and the final Tiptap node type binding. This
 * module has no runtime side effects; it exists to keep the schema, the
 * runtime extension, the file-handler integration, and the UI props
 * aligned at compile time so the persisted ProseMirror node attrs, the
 * `editor.storage.imageComponent.*` slot, and the React components stay
 * in lockstep.
 *
 * Consumers:
 *   - `extension-config.ts` — registers ProseMirror attribute slots via
 *     `ECustomImageAttributeNames` and types attribute parsing/rendering
 *     against `TCustomImageAttributes`.
 *   - `extension.tsx` — wires `CustomImageExtensionOptions` into
 *     `addOptions()` and seeds `CustomImageExtensionStorage` in
 *     `addStorage()`.
 *   - `utils.ts` — exports the `DEFAULT_CUSTOM_IMAGE_ATTRIBUTES` record,
 *     the `ensurePixelString` normalizer, and the
 *     `IMAGE_ALIGNMENT_OPTIONS` table keyed by `TCustomImageAlignment`.
 *   - `components/block.tsx` — reads node attrs typed as
 *     `TCustomImageAttributes` and tracks `TCustomImageSize` in
 *     component-local state.
 *   - `components/node-view.tsx` — drives the `ECustomImageStatus`
 *     state-machine transitions (including the `DUPLICATING` → terminal
 *     branch).
 *   - `components/uploader.tsx` — consumes `UploadEntity` from the
 *     editor storage `fileMap` and emits the
 *     `InsertImageComponentProps` discriminator on insertion.
 *   - `components/toolbar/root.tsx`, `components/toolbar/alignment.tsx`
 *     — surface the `TCustomImageAlignment` set and mutate node attrs.
 */
import type { Node } from "@tiptap/core";
// types
import type { TFileHandler } from "@/types";

/**
 * Canonical attribute key names for the custom-image node schema.
 *
 * Used to register attributes in `extension-config.ts`, to read/write
 * `node.attrs` in the UI components, and to type the
 * `TCustomImageAttributes` value shape so attribute access stays
 * misspell-free at the call site.
 *
 * Members:
 *   - `ID = "id"` — UUID generated at insertion time (`uuidv4()` in
 *     `insertImageComponent`); correlates the inserted node with its
 *     upload metadata in `editor.storage.imageComponent.fileMap`.
 *   - `WIDTH = "width"` — block width; sentinel `"35%"` until the first
 *     image load triggers the pixel-width calculation in
 *     `CustomImageBlock`.
 *   - `HEIGHT = "height"` — block height; sentinel `"auto"` until the
 *     aspect-ratio-based height is computed.
 *   - `ASPECT_RATIO = "aspectRatio"` — `naturalWidth / naturalHeight`;
 *     populated on first image load and preserved across resizes.
 *   - `SOURCE = "src"` — asset URL/identifier; the application's file
 *     handler resolves this to a fetchable URL via `getImageSource`.
 *   - `ALIGNMENT = "alignment"` — block alignment (left/center/right);
 *     rendered via CSS translate transforms in `CustomImageBlock`.
 *   - `STATUS = "status"` — lifecycle state; see `ECustomImageStatus`.
 */
export enum ECustomImageAttributeNames {
  ID = "id",
  WIDTH = "width",
  HEIGHT = "height",
  ASPECT_RATIO = "aspectRatio",
  SOURCE = "src",
  ALIGNMENT = "alignment",
  STATUS = "status",
}

/**
 * Template-literal type that types a CSS pixel string of the form
 * `"<number>px"`.
 *
 * Enforces the `px` suffix at compile time so consumers cannot pass a
 * bare number or a non-pixel CSS length where an exact pixel value is
 * required (e.g., resize handler output, normalized width/height in
 * `TCustomImageSize`, and the values written back via `ensurePixelString`
 * in `utils.ts`).
 */
export type Pixel = `${number}px`;

/**
 * Union of `Pixel` with a caller-supplied sentinel default.
 *
 * Lets attribute fields accept either an exact pixel string or a
 * sentinel default value (e.g., the initial `"35%"` width or `"auto"`
 * height that have not yet been resolved to pixels). Used in
 * `TCustomImageSize` and the width/height fields of
 * `TCustomImageAttributes`.
 */
export type PixelAttribute<TDefault> = Pixel | TDefault;

/**
 * Normalized in-component size state used by `CustomImageBlock` for
 * layout calculation.
 *
 * Distinct from `TCustomImageAttributes` (which is the persisted node
 * attribute shape) — this is the local React state shape after the
 * image has loaded and the renderer has resolved the sentinel
 * percentage/auto values into concrete pixels.
 *
 * Fields:
 *   - `width: PixelAttribute<"35%">` — either an exact pixel string or
 *     the initial `"35%"` sentinel before the first load.
 *   - `height: PixelAttribute<"auto">` — either an exact pixel string
 *     or the initial `"auto"` sentinel before the first load.
 *   - `aspectRatio: number | null` — the `naturalWidth / naturalHeight`
 *     ratio; nullable because legacy or first-load image nodes may not
 *     have it yet.
 */
export type TCustomImageSize = {
  width: PixelAttribute<"35%">;
  height: PixelAttribute<"auto">;
  aspectRatio: number | null;
};

/**
 * Discriminated string union of allowed alignment values for a
 * custom-image block.
 *
 * Mirrors the `value` field of `IMAGE_ALIGNMENT_OPTIONS` in `utils.ts`
 * and the CSS classes applied in `CustomImageBlock`
 * (`ml-[50%] -translate-x-1/2` for center, `ml-[100%] -translate-x-full`
 * for right, no transform for left).
 */
export type TCustomImageAlignment = "left" | "center" | "right";

/**
 * Lifecycle state machine for custom-image nodes.
 *
 * Drives the UI branching between upload UX, loading skeleton, error
 * UX, and the final rendered image block. Two transition flows:
 *   - Fresh insert: `PENDING` → `UPLOADING` → `UPLOADED`.
 *   - Copy-paste of an existing asset: `DUPLICATING` →
 *     `UPLOADED` on success, or `DUPLICATING` → `DUPLICATION_FAILED`
 *     on error.
 *
 * State transitions:
 *   - `PENDING = "pending"` — initial state set by
 *     `insertImageComponent`; the node has an `id` but no `src`. The
 *     `CustomImageUploader` is displayed, awaiting file selection or
 *     drop.
 *   - `UPLOADING = "uploading"` — set by `CustomImageUploader` when
 *     `uploadImageEditorCommand` is invoked. The uploader displays
 *     "Uploading..." text + progress badge.
 *   - `UPLOADED = "uploaded"` — terminal success state. The image
 *     block (`CustomImageBlock`) is rendered with resize handles +
 *     toolbar.
 *   - `DUPLICATING = "duplicating"` — entered after copy-paste of an
 *     existing image: the document references an existing asset, but
 *     the application must server-side duplicate the asset to avoid
 *     sharing storage between the original and the duplicate.
 *     `CustomImageNodeView` calls `extension.options.duplicateImage(src)`
 *     and waits for the new asset id.
 *   - `DUPLICATION_FAILED = "duplication-failed"` — terminal failure
 *     state for the duplicate path. Triggers retry UX in
 *     `CustomImageUploader`.
 */
export enum ECustomImageStatus {
  PENDING = "pending",
  UPLOADING = "uploading",
  UPLOADED = "uploaded",
  DUPLICATING = "duplicating",
  DUPLICATION_FAILED = "duplication-failed",
}

/**
 * Persisted node-attribute shape stored on each custom-image
 * ProseMirror node.
 *
 * Keyed by `ECustomImageAttributeNames` member values; reflects what
 * is round-tripped through `parseHTML` / `renderHTML` in the
 * `<image-component>` tag declared in `extension-config.ts`.
 *
 * Nullability rationale: `ID`, `WIDTH`, `HEIGHT`, `ASPECT_RATIO`,
 * `SOURCE` are nullable to support nodes inserted before upload
 * (PENDING state) and legacy documents missing the aspect-ratio
 * attribute. `ALIGNMENT` and `STATUS` are always non-null because they
 * always have valid defaults from `DEFAULT_CUSTOM_IMAGE_ATTRIBUTES`
 * (`utils.ts`).
 *
 * WIDTH/HEIGHT typing: the union of `PixelAttribute<...>` with `number`
 * exists because resize logic may assign numeric values transiently,
 * even though the normalized rendering value is always a pixel string
 * (normalized via `ensurePixelString` in `utils.ts`).
 */
export type TCustomImageAttributes = {
  [ECustomImageAttributeNames.ID]: string | null;
  [ECustomImageAttributeNames.WIDTH]: PixelAttribute<"35%" | number> | null;
  [ECustomImageAttributeNames.HEIGHT]: PixelAttribute<"auto" | number> | null;
  [ECustomImageAttributeNames.ASPECT_RATIO]: number | null;
  [ECustomImageAttributeNames.SOURCE]: string | null;
  [ECustomImageAttributeNames.ALIGNMENT]: TCustomImageAlignment;
  [ECustomImageAttributeNames.STATUS]: ECustomImageStatus;
};

/**
 * Discriminated union tracking the per-image upload context kept in
 * `editor.storage.imageComponent.fileMap`.
 *
 * Each entry is keyed by the image node's UUID, so the uploader
 * component can resume the upload flow (or auto-open the file picker)
 * on node mount without re-deriving intent from the surrounding
 * document state.
 *
 * Variants:
 *   - `{ event: "insert" }` — image inserted via slash-command, menu,
 *     or keyboard. No file is attached yet; the uploader auto-opens the
 *     file picker on mount (non-touch only).
 *   - `{ event: "drop", file: File }` — image inserted by
 *     drag-and-drop. The `file` is the dropped `File` object; the
 *     uploader auto-uploads on mount without prompting.
 *
 * Common field:
 *   - `hasOpenedFileInputOnce?: boolean` — set to `true` after the
 *     uploader opens the file picker once, so the picker doesn't
 *     reopen on subsequent re-renders/mounts within the same session.
 */
export type UploadEntity = ({ event: "insert" } | { event: "drop"; file: File }) & { hasOpenedFileInputOnce?: boolean };

/**
 * Argument shape for the `insertImageComponent` Tiptap command.
 *
 * The command is declared in `extension-config.ts`'s module
 * augmentation and implemented in `extension.tsx`'s `addCommands()`.
 *
 * Fields:
 *   - `file?: File` — optional; only present for `event === "drop"`
 *     invocations.
 *   - `pos?: number` — optional explicit insertion position; when
 *     omitted, the command inserts at the current selection.
 *   - `event: "insert" | "drop"` — discriminator matching
 *     `UploadEntity['event']`; determines whether the uploader opens
 *     the file picker or auto-uploads.
 */
export type InsertImageComponentProps = {
  file?: File;
  pos?: number;
  event: "insert" | "drop";
};

/**
 * Tiptap `addOptions()` shape for the runtime extension.
 *
 * Wires the application's `TFileHandler` callbacks into the extension
 * so the editor can resolve, restore, upload, and duplicate image
 * assets through the application's API layer without coupling to a
 * specific service implementation.
 *
 * Fields:
 *   - `getImageDownloadSource: TFileHandler["getAssetDownloadSrc"]` —
 *     resolves the download URL (typically a signed URL with
 *     `Content-Disposition: attachment`).
 *   - `getImageSource: TFileHandler["getAssetSrc"]` — resolves the
 *     display URL (typically a signed URL for in-browser rendering).
 *   - `restoreImage: TFileHandler["restore"]` — restores a previously
 *     soft-deleted asset (used when the user undoes a deletion before
 *     save).
 *   - `uploadImage?: TFileHandler["upload"]` — uploads a file. Optional
 *     because read-only file handlers omit this.
 *   - `duplicateImage?: TFileHandler["duplicate"]` — server-side
 *     duplicates an existing asset on copy-paste. Optional because
 *     handlers without duplication semantics will fall through (status
 *     `DUPLICATING` never transitions to `UPLOADED`).
 */
export type CustomImageExtensionOptions = {
  getImageDownloadSource: TFileHandler["getAssetDownloadSrc"];
  getImageSource: TFileHandler["getAssetSrc"];
  restoreImage: TFileHandler["restore"];
  uploadImage?: TFileHandler["upload"];
  duplicateImage?: TFileHandler["duplicate"];
};

/**
 * Tiptap `addStorage()` shape for the runtime extension.
 *
 * Holds per-editor mutable state shared across image-node lifecycle
 * handlers. Reachable from the rest of the editor via
 * `editor.storage.imageComponent.*` (the `"imageComponent"` key is
 * `CORE_EXTENSIONS.CUSTOM_IMAGE` in
 * `packages/editor/src/core/constants/extension.ts`).
 *
 * Fields:
 *   - `fileMap: Map<string, UploadEntity>` — keyed by image UUID.
 *     Tracks pending upload context so `CustomImageUploader` can resume
 *     the upload flow on node mount (either by auto-uploading a drop
 *     file or by auto-opening the file picker for an insert).
 *
 *   - `deletedImageSet: Map<string, boolean>` — the **deferred-deletion
 *     bucket** for images marked for deletion during the editing
 *     session. An image deleted in the editor must not be physically
 *     deleted from server storage until the document is saved; this
 *     map tracks deletion intent so it can be reverted (undo) and so
 *     the document save pipeline knows which assets to delete on save.
 *
 *     Writer: `core/plugins/file/delete.ts` (`TrackFileDeletionPlugin`)
 *     — on every doc transaction, the plugin diffs old vs. new
 *     descendants and calls
 *     `editor.storage[nodeType]?.[nodeFileSetDetails.fileSetName]?.set(src, true)`
 *     for each removed image node. The node-type → fileSet-name mapping
 *     is declared in `NODE_FILE_MAP` (`ce/constants/utility.ts`) where
 *     `CORE_EXTENSIONS.CUSTOM_IMAGE → { fileSetName: "deletedImageSet" }`.
 *
 *     Readers: the document save pipeline (which fans out
 *     delete-asset API calls for each map entry) and
 *     `core/plugins/file/restore.ts` (`TrackFileRestorationPlugin`)
 *     which removes entries when a deleted node is re-introduced (undo
 *     before save).
 *
 *     Map value semantics: the value `true` means "pending deletion at
 *     next save". The boolean shape is preserved for parity with the
 *     legacy image extension (`core/extensions/image/extension.tsx`).
 *
 *   - `maxFileSize: number` — per-file upload size limit in bytes.
 *     Sourced from `fileHandler.validation?.maxFileSize`; defaults to
 *     `0` (effectively no limit) when validation is absent. Enforced
 *     both in `insertImageComponent` (server-pushed drop validation)
 *     and in `CustomImageUploader` (client-side picker validation).
 *
 * Note: `extension.tsx`'s `addStorage` also seeds a `markdown` no-op
 * `serialize` to opt the custom-image node out of markdown
 * serialization. That field is intentionally NOT in
 * `CustomImageExtensionStorage` because the markdown extension reads
 * it through a separate ambient interface.
 */
export type CustomImageExtensionStorage = {
  fileMap: Map<string, UploadEntity>;
  deletedImageSet: Map<string, boolean>;
  maxFileSize: number;
};

/**
 * The fully-specialized Tiptap `Node` type for the custom-image
 * extension.
 *
 * Binds `CustomImageExtensionOptions` and `CustomImageExtensionStorage`
 * into Tiptap's generic `Node<O, S>` shape so consumers
 * (e.g., `extension-config.ts`, `extension.tsx`,
 * `components/node-view.tsx`) get correct typing when they reference
 * `extension.options.uploadImage` or
 * `editor.storage[CORE_EXTENSIONS.CUSTOM_IMAGE].deletedImageSet`.
 */
export type CustomImageExtensionType = Node<CustomImageExtensionOptions, CustomImageExtensionStorage>;
