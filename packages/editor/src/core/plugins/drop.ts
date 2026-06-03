/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * File drag-drop and clipboard-paste handlers for the editor surface.
 *
 * Exports the `DropHandlerPlugin` ProseMirror plugin (which intercepts native
 * browser drop/paste events) and the `insertFilesSafely` helper (which
 * dispatches accepted files into the editor as image or attachment nodes via
 * `editor.commands.insertImageComponent`).
 *
 * Incoming files are filtered against `ACCEPTED_IMAGE_MIME_TYPES` and
 * `ACCEPTED_ATTACHMENT_MIME_TYPES` from `@/constants/config` before insertion.
 * File-backed node lifecycle AFTER insertion — deletion tracking, restoration
 * on undo, asset-list synchronization — is owned by the sibling `./file/`
 * subfolder (`FilePlugins`, `TrackFileDeletionPlugin`,
 * `TrackFileRestorationPlugin`), not by this module.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// constants
import { ACCEPTED_ATTACHMENT_MIME_TYPES, ACCEPTED_IMAGE_MIME_TYPES } from "@/constants/config";
// types
import type { TEditorCommands, TExtensions } from "@/types";

/** Arguments accepted by `DropHandlerPlugin`: the TipTap `editor` instance plus the active extension gates. */
type Props = {
  disabledExtensions?: TExtensions[];
  flaggedExtensions?: TExtensions[];
  editor: Editor;
};

/**
 * ProseMirror plugin that intercepts external file drop and clipboard file
 * paste on the editor view and routes accepted file types into the editor as
 * image or attachment nodes.
 *
 * State read:
 *   - `editor.isEditable` (skip handling on read-only views).
 *   - `event.clipboardData.files` / `event.dataTransfer.files` (the native
 *     file payload).
 *   - `view.state.selection.from` for the paste insertion point.
 *   - `view.posAtCoords({ left: event.clientX, top: event.clientY })` to
 *     derive a drop insertion position from the drop event coordinates.
 *
 * State write:
 *   - The plugin does NOT mutate `EditorState` directly. It delegates safe
 *     insertion to `insertFilesSafely`, which in turn dispatches
 *     `editor.commands.insertImageComponent` for image files.
 *
 * DOM side effects:
 *   - Registers ProseMirror `handlePaste` / `handleDrop` props on the
 *     editor view.
 *   - Calls `event.preventDefault()` on accepted file payloads to suppress
 *     native browser behavior (for example, the browser navigating to the
 *     dropped image URL).
 *   - Returns `true` to ProseMirror only when the plugin claims the event;
 *     returns `false` to fall through to default handling (e.g., text paste).
 *
 * WHY MIME-type filtering: only files whose `type` appears in
 * `ACCEPTED_IMAGE_MIME_TYPES` or `ACCEPTED_ATTACHMENT_MIME_TYPES` are
 * forwarded to `insertFilesSafely`. Unmatched files (for example,
 * `application/x-7z-compressed`) are silently dropped so the editor never
 * inserts a node it cannot render or persist.
 *
 * WHY `handleDrop` checks `!moved`: ProseMirror sets the fourth `moved`
 * parameter to `true` when a node is being re-positioned via an internal
 * editor drag (handled elsewhere by the drag-handle plugin). This plugin
 * claims only EXTERNAL file drops (`moved === false`), so internal
 * block-reordering drags fall through to the default handler.
 */
export const DropHandlerPlugin = (props: Props): Plugin => {
  const { disabledExtensions, flaggedExtensions, editor } = props;

  return new Plugin({
    key: new PluginKey("drop-handler-plugin"),
    props: {
      handlePaste: (view, event) => {
        if (
          editor.isEditable &&
          event.clipboardData &&
          event.clipboardData.files &&
          event.clipboardData.files.length > 0
        ) {
          event.preventDefault();
          const files = Array.from(event.clipboardData.files);
          const acceptedFiles = files.filter(
            (f) => ACCEPTED_IMAGE_MIME_TYPES.includes(f.type) || ACCEPTED_ATTACHMENT_MIME_TYPES.includes(f.type)
          );

          if (acceptedFiles.length) {
            const pos = view.state.selection.from;
            insertFilesSafely({
              disabledExtensions,
              flaggedExtensions,
              editor,
              files: acceptedFiles,
              initialPos: pos,
              event: "drop",
            });
          }
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (
          editor.isEditable &&
          !moved &&
          event.dataTransfer &&
          event.dataTransfer.files &&
          event.dataTransfer.files.length > 0
        ) {
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          const acceptedFiles = files.filter(
            (f) => ACCEPTED_IMAGE_MIME_TYPES.includes(f.type) || ACCEPTED_ATTACHMENT_MIME_TYPES.includes(f.type)
          );

          if (acceptedFiles.length) {
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            if (coordinates) {
              const pos = coordinates.pos;
              insertFilesSafely({
                disabledExtensions,
                editor,
                files: acceptedFiles,
                initialPos: pos,
                event: "drop",
              });
            }
            return true;
          }
        }
        return false;
      },
    },
  });
};

/** Arguments accepted by `insertFilesSafely`; `event` distinguishes programmatic inserts (`"insert"`) from drag-drop / paste origin (`"drop"`). */
type InsertFilesSafelyArgs = {
  disabledExtensions?: TExtensions[];
  flaggedExtensions?: TExtensions[];
  editor: Editor;
  event: "insert" | "drop";
  files: File[];
  initialPos: number;
  type?: Extract<TEditorCommands, "attachment" | "image">;
};

/**
 * Insert an array of files into the editor as image or attachment nodes.
 *
 * Iterates `files`, classifying each by MIME type (or by the optional
 * `type` override) and dispatching `editor.commands.insertImageComponent`
 * for images. The `event` discriminant (`"insert"` vs. `"drop"`) is
 * forwarded to the command so downstream upload/attribution code can
 * distinguish programmatic inserts from drag-drop / paste origin.
 *
 * Image insertion is skipped when `"image"` appears in `disabledExtensions`,
 * which lets consumer surfaces (e.g., lite text editors) opt out of image
 * support without rejecting the file upstream.
 *
 * WHY position clamping: before each dispatch the loop computes
 * `docSize = editor.state.doc.content.size` and sets
 * `pos = Math.min(pos, docSize)`. The clamp guards against a stale
 * `initialPos` that was computed BEFORE other handlers shrank the document
 * — dispatching past the document end would throw a ProseMirror invariant
 * error. After each successful insert `pos` is advanced by 1 so consecutive
 * files are not stacked at the same coordinate.
 */
export const insertFilesSafely = async (args: InsertFilesSafelyArgs) => {
  const { disabledExtensions, editor, event, files, initialPos, type } = args;
  let pos = initialPos;

  for (const file of files) {
    // safe insertion
    const docSize = editor.state.doc.content.size;
    pos = Math.min(pos, docSize);

    let fileType: "image" | "attachment" | null = null;

    try {
      if (type) {
        if (["image", "attachment"].includes(type)) fileType = type;
        else throw new Error("Wrong file type passed");
      } else {
        if (ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)) fileType = "image";
        else if (ACCEPTED_ATTACHMENT_MIME_TYPES.includes(file.type)) fileType = "attachment";
      }
      // insert file depending on the type at the current position
      if (fileType === "image" && !disabledExtensions?.includes("image")) {
        editor.commands.insertImageComponent({
          file,
          pos,
          event,
        });
      } else if (fileType === "attachment") {
        // INTENT UNCLEAR: the attachment branch is empty even though attachment files are accepted by the MIME filter; investigate intended insertion command.
      }
    } catch (error) {
      console.error(`Error while ${event}ing file:`, error);
    }

    // Move to the next position
    pos += 1;
  }
};
