/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Utility "glue" extension for the Plane editor.
 *
 * Wires `FilePlugins`, `DropHandlerPlugin`, `MarkdownClipboardPlugin`, and
 * `prosemirror-codemark` into the editor's plugin pipeline. Provisions
 * cross-extension storage (`editor.storage.utility`) holding the asset
 * list, asset upload status, the in-progress upload flag, and the
 * active-dropbar-extensions array consumed by other extensions
 * (placeholder, enter-key, mentions, slash-commands, table drag handles,
 * bubble-menu, side-menu, etc.).
 */

import { Extension } from "@tiptap/core";
import codemark from "prosemirror-codemark";
// helpers
import { CORE_EXTENSIONS } from "@/constants/extension";
import { restorePublicImages } from "@/helpers/image-helpers";
// plugins
import type { TAdditionalActiveDropbarExtensions } from "@/plane-editor/types/utils";
import { DropHandlerPlugin } from "@/plugins/drop";
import { FilePlugins } from "@/plugins/file/root";
import { MarkdownClipboardPlugin } from "@/plugins/markdown-clipboard";
import type { IEditorProps, TEditorAsset, TFileHandler } from "@/types";

/** Discriminated union of dropbar extensions tracked in `activeDropbarExtensions`. */
type TActiveDropbarExtensions =
  | CORE_EXTENSIONS.MENTION
  | CORE_EXTENSIONS.EMOJI
  | CORE_EXTENSIONS.SLASH_COMMANDS
  | CORE_EXTENSIONS.TABLE
  | "bubble-menu"
  | CORE_EXTENSIONS.SIDE_MENU
  | TAdditionalActiveDropbarExtensions;

declare module "@tiptap/core" {
  interface Commands {
    [CORE_EXTENSIONS.UTILITY]: {
      updateAssetsUploadStatus: (updatedStatus: TFileHandler["assetsUploadStatus"]) => () => void;
      updateAssetsList: (
        args:
          | {
              asset: TEditorAsset;
            }
          | {
              idToRemove: string;
            }
      ) => () => void;
      addActiveDropbarExtension: (extension: TActiveDropbarExtensions) => () => void;
      removeActiveDropbarExtension: (extension: TActiveDropbarExtensions) => () => void;
    };
  }
  interface Storage {
    [CORE_EXTENSIONS.UTILITY]: UtilityExtensionStorage;
  }
}

/**
 * Storage slot installed on `editor.storage[CORE_EXTENSIONS.UTILITY]`.
 *
 * Cross-extension state container — every consumer below depends on
 * `UtilityExtension` being composed in the editor's extension array.
 *
 * - `assetsList` — tracked asset metadata used by `editor-ref.ts`
 *   (`assets` getter) and the file-handler cleanup pipeline so that
 *   uploaded assets can be reconciled with the persisted document on
 *   save and pruned on deletion.
 * - `assetsUploadStatus` — per-asset upload progress map provided by the
 *   file handler; read by `custom-image/components/upload-status.tsx` and
 *   reflected back to consumers via `use-editor.ts`.
 * - `uploadInProgress` — read by `placeholder.ts` (to suppress the empty
 *   placeholder during active uploads), `use-editor.ts`, and
 *   `editor-ref.ts#isEditorReadyToDiscard` to gate destructive UI flows.
 * - `activeDropbarExtensions` — registry of currently-open floating menus
 *   (mention, emoji, slash, table drag handles, side-menu, bubble-menu)
 *   read by `enter-key.ts` to arbitrate keyboard events when multiple
 *   menus could otherwise compete for the same shortcut.
 * - `isTouchDevice` — cached pointer-environment flag forwarded from
 *   editor props; consumed by `emoji.ts`, `custom-image/components/`
 *   uploader/block to switch to touch-friendly interactions.
 */
export type UtilityExtensionStorage = {
  assetsList: TEditorAsset[];
  assetsUploadStatus: TFileHandler["assetsUploadStatus"];
  uploadInProgress: boolean;
  activeDropbarExtensions: TActiveDropbarExtensions[];
  isTouchDevice: boolean;
};

type Props = Pick<IEditorProps, "disabledExtensions" | "flaggedExtensions" | "getEditorMetaData"> & {
  fileHandler: TFileHandler;
  isEditable: boolean;
  isTouchDevice: boolean;
};

/**
 * Glue extension wiring file/drop/clipboard/codemark plugins and the
 * shared `editor.storage.utility` cross-extension state.
 *
 * Authored from scratch (not a wrapper around an upstream TipTap
 * extension) so the exposes/overrides/hides triplet does not apply.
 *
 * ProseMirror plugins composed (via `addProseMirrorPlugins`):
 *   - `FilePlugins` — file upload, drop, and paste-to-upload pipelines
 *     (also tracks asset deletion/restoration for cleanup semantics).
 *   - `codemark` — inline-code keyboard shortcuts (typing
 *     `` `text` `` toggles the `code` mark).
 *   - `MarkdownClipboardPlugin` — copy-time HTML→markdown conversion so
 *     pasting outside the editor yields markdown.
 *   - `DropHandlerPlugin` — top-level drop/paste handler that fans out
 *     to feature-specific drop logic (images, attachments).
 *
 * Storage installed at `editor.storage[CORE_EXTENSIONS.UTILITY]` — see
 * {@link UtilityExtensionStorage} for the full slot inventory and
 * consumer map.
 *
 * Commands exposed at `editor.commands.*`:
 *   - `updateAssetsUploadStatus(updatedStatus)` — replaces the upload
 *     status map; called from `use-editor.ts` when the consumer hook
 *     receives a new upload-status snapshot.
 *   - `updateAssetsList({ asset } | { idToRemove })` — idempotently adds
 *     or removes an asset by id. Uses a `Set` plus a defensive `find`
 *     check so duplicates cannot enter the list even if a caller races
 *     two adds for the same id.
 *   - `addActiveDropbarExtension` / `removeActiveDropbarExtension` —
 *     push/splice (not Set-based) so insertion order is preserved for
 *     consumers that arbitrate based on most-recently-opened menu.
 *
 * `onCreate`: invokes `restorePublicImages` to rebuild presigned URLs
 * for legacy public-image references in the loaded document so they
 * keep rendering after migration to gated storage.
 *
 * `priority: 1000`: well above TipTap defaults so the utility plugins
 * register early in the ProseMirror plugin chain regardless of this
 * extension's array position in `extensions.ts`. WHY: drop/paste
 * interception must run before content-aware extensions (e.g., link
 * auto-paste) get the event, and the shared storage must exist before
 * extensions like `placeholder.ts` or `enter-key.ts` read it.
 *
 * @param props - Per-instance composition arguments.
 * @param props.disabledExtensions - Feature names to omit; forwarded to
 *   `DropHandlerPlugin` so disabled extensions cannot intercept drops.
 * @param props.flaggedExtensions - Feature-flagged extension names;
 *   forwarded to `DropHandlerPlugin` for gated drop behaviors.
 * @param props.fileHandler - Upload/restore/delete callbacks consumed
 *   by `FilePlugins` and `restorePublicImages`; its
 *   `assetsUploadStatus` snapshot seeds `editor.storage.utility` in
 *   read-write mode.
 * @param props.getEditorMetaData - Workspace/project/issue context
 *   lookup used by `MarkdownClipboardPlugin` to enrich copied HTML
 *   with custom-component metadata.
 * @param props.isEditable - When `false` (read-only mode), the file
 *   deletion plugin is omitted and `assetsUploadStatus` is initialized
 *   empty.
 * @param props.isTouchDevice - Cached pointer-environment flag stored
 *   on `editor.storage.utility.isTouchDevice` for downstream UI
 *   branches that need touch-friendly affordances.
 * @returns A TipTap `Extension` instance ready to be appended to the
 *   editor's extension array. Must be composed in `extensions.ts`
 *   because cross-extension storage reads in other extensions depend
 *   on its presence.
 */
export const UtilityExtension = (props: Props) => {
  const { disabledExtensions, flaggedExtensions, fileHandler, getEditorMetaData, isEditable, isTouchDevice } = props;
  const { restore } = fileHandler;

  return Extension.create<Record<string, unknown>, UtilityExtensionStorage>({
    name: CORE_EXTENSIONS.UTILITY,
    priority: 1000,

    addProseMirrorPlugins() {
      return [
        ...FilePlugins({
          editor: this.editor,
          isEditable,
          fileHandler,
        }),
        ...codemark({ markType: this.editor.schema.marks.code }),
        MarkdownClipboardPlugin({
          editor: this.editor,
          getEditorMetaData,
        }),
        DropHandlerPlugin({
          disabledExtensions,
          flaggedExtensions,
          editor: this.editor,
        }),
      ];
    },

    onCreate() {
      restorePublicImages(this.editor, restore);
    },

    addStorage() {
      return {
        assetsList: [],
        assetsUploadStatus: isEditable && "assetsUploadStatus" in fileHandler ? fileHandler.assetsUploadStatus : {},
        uploadInProgress: false,
        activeDropbarExtensions: [],
        isTouchDevice,
      };
    },

    addCommands() {
      return {
        updateAssetsUploadStatus: (updatedStatus) => () => {
          this.storage.assetsUploadStatus = updatedStatus;
        },
        updateAssetsList: (args) => () => {
          const uniqueAssets = new Set(this.storage.assetsList);
          if ("asset" in args) {
            const alreadyExists = this.storage.assetsList.find((asset) => asset.id === args.asset.id);
            if (!alreadyExists) {
              uniqueAssets.add(args.asset);
            }
          } else if ("idToRemove" in args) {
            const asset = this.storage.assetsList.find((asset) => asset.id === args.idToRemove);
            if (asset) {
              uniqueAssets.delete(asset);
            }
          }
          this.storage.assetsList = Array.from(uniqueAssets);
        },
        addActiveDropbarExtension: (extension) => () => {
          const index = this.storage.activeDropbarExtensions.indexOf(extension);
          if (index === -1) {
            this.storage.activeDropbarExtensions.push(extension);
          }
        },
        removeActiveDropbarExtension: (extension) => () => {
          const index = this.storage.activeDropbarExtensions.indexOf(extension);
          if (index !== -1) {
            this.storage.activeDropbarExtensions.splice(index, 1);
          }
        },
      };
    },
  });
};
