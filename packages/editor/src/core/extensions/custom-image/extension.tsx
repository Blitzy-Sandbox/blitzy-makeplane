/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime extension factory for the Plane-specific custom image Tiptap
 * node — turns the schema-only `CustomImageExtensionConfig` (which
 * extends `@tiptap/extension-image`) into an editor-ready Node wired to
 * the application's file handling, upload validation, deferred-deletion
 * tracking, and React-rendered node view.
 *
 * Registered under `CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"`
 * (see `packages/editor/src/core/constants/extension.ts:L167`). This is
 * the Plane-specific custom variant; the upstream-named default image
 * node is registered separately under `CORE_EXTENSIONS.IMAGE = "image"`
 * (see `../image/extension.tsx`) so that legacy `<img>` HTML continues
 * to parse for pre-existing content. New images inserted through the
 * editor's slash menu, toolbar, drop zone, or paste handler land here.
 *
 * **Exposes** (inherited from `@tiptap/extension-image` upstream,
 * preserved via `...this.parent?.()` in `addOptions()` and `parseHTML`
 * / `renderHTML` left intact on `CustomImageExtensionConfig`):
 * - The `setImage({ src, alt, title })` parent command.
 * - The upstream image schema's `parseHTML` / `renderHTML` machinery
 *   (overridden in `extension-config.ts` to target the `image-component`
 *   HTML tag rather than `<img>`, so this is technically a redirected
 *   schema rather than a passthrough — see `extension-config.ts:L58-L68`).
 *
 * **Overrides** (layered on top of `@tiptap/extension-image`):
 * - Schema attributes (in `CustomImageExtensionConfig.addAttributes()`):
 *   adds `id`, `width` (default `"35%"`), `height` (default `"auto"`),
 *   `aspectRatio`, `alignment` (default `"left"`), and `status` (default
 *   `PENDING`) on top of upstream `src` / `alt` / `title`.
 * - `addOptions()` (here): merges parent options with file-handler
 *   callbacks (`getImageSource`, `getImageDownloadSource`, `restoreImage`,
 *   optionally `uploadImage` and `duplicateImage`).
 * - `addStorage()` (here): initializes per-editor state — `fileMap`
 *   (pending upload metadata), `deletedImageSet` (deferred-deletion
 *   bucket), `maxFileSize`, and a no-op `markdown.serialize`.
 * - `addCommands()` (here): registers `insertImageComponent` (the
 *   discriminated-union command for inserting new image nodes from
 *   drop or insert flows).
 * - `addKeyboardShortcuts()` (here): binds `ArrowDown` and `ArrowUp` to
 *   `insertEmptyParagraphAtNodeBoundaries` so the cursor can escape
 *   the atom image node.
 * - `addNodeView()` (here): renders via `ReactNodeViewRenderer` +
 *   `CustomImageNodeView`, giving the editor an interactive image
 *   block with resize handle, alignment toolbar, and upload UX.
 *
 * **Hides** (upstream behavior intentionally suppressed):
 * - The upstream default non-interactive `<img>` rendering is replaced
 *   at runtime by the React node view. Live editing never falls back
 *   to the upstream HTML renderer; `CustomImageNodeView` owns
 *   on-screen presentation, selection, resize, and alignment.
 *
 * Cross-references:
 * - Schema config: `./extension-config.ts` (declares the Tiptap module
 *   augmentation that types `editor.commands.insertImageComponent` and
 *   `editor.storage[CORE_EXTENSIONS.CUSTOM_IMAGE]`).
 * - Sibling default-image extension: `../image/extension.tsx`.
 * - Node view: `./components/node-view.tsx`.
 * - Soft-delete plugin: `core/plugins/file/delete.ts` (the system-wide
 *   cleanup hook that writes into `deletedImageSet`).
 * - Soft-delete restore plugin: `core/plugins/file/restore.ts`.
 * - Node ↔ file-set name mapping: `NODE_FILE_MAP` in
 *   `packages/editor/src/ce/constants/utility.ts:L22-L29`.
 */
import { ReactNodeViewRenderer } from "@tiptap/react";
import { v4 as uuidv4 } from "uuid";
// constants
import { ACCEPTED_IMAGE_MIME_TYPES } from "@/constants/config";
// helpers
import { isFileValid } from "@/helpers/file";
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
// types
import type { TFileHandler } from "@/types";
// local imports
import type { CustomImageNodeViewProps } from "./components/node-view";
import { CustomImageNodeView } from "./components/node-view";
import { CustomImageExtensionConfig } from "./extension-config";
import type { CustomImageExtensionOptions, CustomImageExtensionStorage } from "./types";
import { ECustomImageAttributeNames, ECustomImageStatus } from "./types";
import { getImageComponentImageFileMap } from "./utils";

/**
 * Constructor props for `CustomImageExtension`.
 *
 * @property fileHandler - `TFileHandler` instance providing
 *   `getAssetSrc`, `getAssetDownloadSrc`, `restore`, optionally `upload`
 *   and `duplicate`. These callbacks are forwarded into the extension's
 *   `addOptions()` so the runtime image lifecycle (upload, download,
 *   restore-on-undo, duplicate-on-copy-paste) is delegated to the
 *   application layer rather than reimplemented in the editor package.
 *
 *   The application-level `TFileHandler.upload(blockId, file)`
 *   implementation in `apps/web` wraps the apps/api v2 asset
 *   presigned-POST contract:
 *     1. `POST assets/v2/workspaces/<slug>/` (or the project-scoped
 *        equivalent `…/projects/<project_id>/`) returns
 *        `{ upload_data, asset_id, asset_url }` — `upload_data` is the
 *        presigned-POST envelope (URL + signed form fields) generated by
 *        `S3Storage.generate_presigned_post` against MinIO/S3.
 *     2. The browser uploads the file bytes directly to object storage
 *        using the presigned envelope — the editor package never sees
 *        the binary path.
 *     3. `PATCH assets/v2/workspaces/<slug>/<asset_id>/` marks the
 *        asset `is_uploaded = True` and queues
 *        `get_asset_object_metadata.delay()` for async metadata
 *        extraction.
 *   Editor code (this extension and `./components/uploader.tsx`)
 *   delegates this entire network workflow to `TFileHandler` and
 *   consumes only the resolved asset URL returned by `upload`. See
 *   `apps/api/plane/app/views/asset/v2.py`
 *   (`WorkspaceFileAssetEndpoint`, `ProjectAssetEndpoint`) and
 *   `apps/api/plane/app/urls/asset.py` for the route definitions.
 * @property isEditable - When `false`, the resulting node is rendered
 *   non-selectable and non-draggable (`selectable` / `draggable` keys
 *   on the extension are bound to this flag). Controls read-only vs.
 *   editing behavior at the schema level — `false` is used for
 *   published views and PDF export contexts.
 */
type Props = {
  fileHandler: TFileHandler;
  isEditable: boolean;
};

/**
 * Builds the runtime custom-image extension by extending
 * `CustomImageExtensionConfig` (which itself extends
 * `@tiptap/extension-image`). Registered under
 * `CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"`.
 *
 * `selectable` and `draggable` are bound to `isEditable`, so image
 * nodes participate in selection and drag only when the editor is in
 * editing mode — published / read-only views render them inert.
 *
 * The factory wires four runtime hooks on top of the schema:
 * - `addOptions()` merges parent options with file-handler callbacks
 *   (`getImageDownloadSource`, `getImageSource`, `restoreImage`, plus
 *   the optional `uploadImage` / `duplicateImage` keys forwarded only
 *   when present on the handler).
 * - `addStorage()` initializes per-editor state — see the `addStorage`
 *   JSDoc below for the `fileMap` + `deletedImageSet` + `maxFileSize`
 *   contract.
 * - `addCommands()` registers `insertImageComponent` — see the command
 *   JSDoc below for trigger, params, behavior, and side effects.
 * - `addKeyboardShortcuts()` binds `ArrowUp` / `ArrowDown` to
 *   `insertEmptyParagraphAtNodeBoundaries` so the cursor can escape
 *   the atom image node.
 * - `addNodeView()` returns a `ReactNodeViewRenderer` for
 *   `CustomImageNodeView`, giving the editor a React-rendered
 *   interactive image block with resize handle, alignment toolbar, and
 *   upload UX.
 *
 * @param props - See `Props` above.
 * @returns A Tiptap extension instance ready for registration in
 *   `extensions.ts` (see `CoreEditorExtensions`).
 */
export function CustomImageExtension(props: Props) {
  const { fileHandler, isEditable } = props;
  // derived values
  const { getAssetSrc, getAssetDownloadSrc, restore: restoreImageFn } = fileHandler;

  return CustomImageExtensionConfig.extend<CustomImageExtensionOptions, CustomImageExtensionStorage>({
    selectable: isEditable,
    draggable: isEditable,

    addOptions() {
      const upload = "upload" in fileHandler ? fileHandler.upload : undefined;
      const duplicate = "duplicate" in fileHandler ? fileHandler.duplicate : undefined;
      return {
        ...this.parent?.(),
        getImageDownloadSource: getAssetDownloadSrc,
        getImageSource: getAssetSrc,
        restoreImage: restoreImageFn,
        uploadImage: upload,
        duplicateImage: duplicate,
      };
    },

    /**
     * Initializes per-editor storage for the custom-image extension.
     * The Tiptap module augmentation in `./extension-config.ts:L28-L30`
     * types the returned object as the value of
     * `editor.storage[CORE_EXTENSIONS.CUSTOM_IMAGE]`
     * (i.e. `editor.storage.imageComponent`).
     *
     * Storage shape:
     *
     * - `fileMap: Map<string, UploadEntity>` — keyed by the per-image
     *   UUID generated in `insertImageComponent`. Tracks pending
     *   drop/insert metadata so `CustomImageUploader` can resume the
     *   upload flow on node mount (entries are removed after successful
     *   upload by the uploader; see `./components/uploader.tsx`).
     *
     * - `deletedImageSet: Map<string, boolean>` — the
     *   **deferred-deletion bucket** for images marked for removal
     *   during the editing session.
     *   - WHY: an image marked for deletion in the editor isn't actually
     *     deleted from server storage until the document is saved.
     *     Until save, the user can undo the removal and the image must
     *     remain restorable — server-side deletion is therefore
     *     deferred to save time.
     *   - WHO WRITES: `core/plugins/file/delete.ts`
     *     (`TrackFileDeletionPlugin`), which inspects the doc diff on
     *     every transaction and calls
     *     `editor.storage[nodeType]?.[fileSetName]?.set(src, true)`
     *     when an image node disappears from the doc. The
     *     `nodeType → fileSetName` lookup is `NODE_FILE_MAP` at
     *     `packages/editor/src/ce/constants/utility.ts:L22-L29`, which
     *     maps `CORE_EXTENSIONS.CUSTOM_IMAGE → "deletedImageSet"`.
     *   - WHO READS: the document save pipeline +
     *     `core/plugins/file/restore.ts` (`TrackFileRestorationPlugin`).
     *     On save, the application fans out `delete(src)` API calls
     *     for every entry; on restore (undo before save) the entry is
     *     removed and the image is recovered.
     *   - Map value semantics: `true` means "pending deletion at next
     *     save". The `Map<string, boolean>` shape is preserved for
     *     parity with the legacy default-image extension
     *     (`../image/extension.tsx:L168`).
     *
     * - `maxFileSize` — read from `fileHandler.validation?.maxFileSize`
     *   when the `validation` key is present, defaulting to `0` (no
     *   per-file limit) when absent. Consumed by `isFileValid` inside
     *   `insertImageComponent` and by `CustomImageUploader` for
     *   client-side size validation before invoking the upload service.
     *
     * - `markdown.serialize` — empty no-op that intentionally
     *   suppresses markdown serialization output for custom images.
     *   Custom images use the `image-component` HTML tag (not standard
     *   markdown `![alt](src)` syntax), so the markdown serializer must
     *   not emit a fallback `![]()` for these nodes.
     */
    addStorage() {
      const maxFileSize = "validation" in fileHandler ? fileHandler.validation?.maxFileSize : 0;

      return {
        fileMap: new Map(),
        deletedImageSet: new Map<string, boolean>(),
        maxFileSize,
        // escape markdown for images
        markdown: {
          serialize() {},
        },
      };
    },

    /**
     * Registers the `insertImageComponent` editor command.
     *
     * The Tiptap module augmentation in `./extension-config.ts:L22-L27`
     * types this command on the global `Commands` interface so
     * downstream code can call `editor.commands.insertImageComponent(...)`
     * with full type safety.
     *
     * `insertImageComponent` contract:
     * - Trigger: explicit `editor.commands.insertImageComponent({...})`
     *   calls from the slash-command menu, drop handlers (`useDropZone`
     *   in the editor container), and toolbar insert buttons. Not bound
     *   to a keyboard shortcut directly — invocation is always
     *   programmatic.
     * - Params (`InsertImageComponentProps`):
     *   - `file?: File` — only present on drop events.
     *   - `pos?: number` — explicit insertion position; current selection
     *     is used when absent.
     *   - `event: "insert" | "drop"` — discriminant for the upload flow
     *     branch (see below).
     * - Behavior:
     *   - On invalid file (rejected by `isFileValid` against
     *     `ACCEPTED_IMAGE_MIME_TYPES` and `this.storage.maxFileSize`):
     *     returns `false` and surfaces the validation message via
     *     `alert(message)`.
     *   - Generates a UUID via `uuidv4()` and uses it as the new node's
     *     `id` attribute; the same UUID is the key under which the
     *     upload metadata is stored in `fileMap`, letting
     *     `CustomImageUploader` later look up its `UploadEntity` on
     *     node mount.
     *   - For `drop` events: stores `{ file, event }` in `fileMap` so
     *     the uploader auto-uploads on mount.
     *   - For `insert` events: stores `{ event, hasOpenedFileInputOnce:
     *     false }` so the uploader opens the file picker on mount
     *     (once, non-touch only).
     *   - Inserts a node with `id` and `status: PENDING`; uses
     *     `insertContentAt(pos, ...)` when `pos` is supplied,
     *     `insertContent(...)` otherwise (which inserts at the current
     *     selection).
     * - Side effects: writes to `this.storage.fileMap`; mutates the
     *   editor document by inserting a new image node.
     * - Idempotency: NON-idempotent — each invocation generates a fresh
     *   UUID and inserts a new node, even when called with identical
     *   arguments.
     */
    addCommands() {
      return {
        insertImageComponent:
          (props) =>
          ({ commands }) => {
            // Early return if there's an invalid file being dropped
            if (
              props?.file &&
              !isFileValid({
                acceptedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
                file: props.file,
                maxFileSize: this.storage.maxFileSize,
                onError: (_error, message) => alert(message),
              })
            ) {
              return false;
            }

            // generate a unique id for the image to keep track of dropped
            // files' file data
            const fileId = uuidv4();

            const imageComponentImageFileMap = getImageComponentImageFileMap(this.editor);

            if (imageComponentImageFileMap) {
              if (props?.event === "drop" && props.file) {
                imageComponentImageFileMap.set(fileId, {
                  file: props.file,
                  event: props.event,
                });
              } else if (props.event === "insert") {
                imageComponentImageFileMap.set(fileId, {
                  event: props.event,
                  hasOpenedFileInputOnce: false,
                });
              }
            }

            const attributes = {
              [ECustomImageAttributeNames.ID]: fileId,
              [ECustomImageAttributeNames.STATUS]: ECustomImageStatus.PENDING,
            };

            if (props.pos) {
              return commands.insertContentAt(props.pos, {
                type: this.name,
                attrs: attributes,
              });
            }
            return commands.insertContent({
              type: this.name,
              attrs: attributes,
            });
          },
      };
    },

    /**
     * Binds `ArrowDown` and `ArrowUp` to
     * `insertEmptyParagraphAtNodeBoundaries(<direction>, this.name)` so
     * the caret can escape the atom image node by injecting an empty
     * paragraph at the node boundary when one does not already exist.
     *
     * Without this, an image node at the start or end of the document
     * traps the cursor — there is no adjacent paragraph for the caret
     * to land in and arrow keys become no-ops.
     */
    addKeyboardShortcuts() {
      return {
        ArrowDown: insertEmptyParagraphAtNodeBoundaries("down", this.name),
        ArrowUp: insertEmptyParagraphAtNodeBoundaries("up", this.name),
      };
    },
    /**
     * Returns a `ReactNodeViewRenderer` that mounts `CustomImageNodeView`
     * for every custom-image node instance. The node view receives
     * Tiptap's standard `NodeViewProps` (`editor`, `node`, `getPos`,
     * `selected`, `updateAttributes`, etc.) plus the typed
     * `node.attrs` shape `TCustomImageAttributes` (id, width, height,
     * aspectRatio, src, alignment, status).
     *
     * The wrapping arrow function exists solely to perform the
     * `props.node as CustomImageNodeViewProps["node"]` cast — a typed
     * narrowing from Tiptap's generic `Node` to the custom-image
     * specific attribute type. The cast has no runtime effect.
     */
    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <CustomImageNodeView {...props} node={props.node as CustomImageNodeViewProps["node"]} />
      ));
    },
  });
}
