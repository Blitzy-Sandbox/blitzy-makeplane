/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin that detects file-backed editor nodes (images,
 * attachments, custom images) removed from the document and soft-deletes
 * the underlying asset via an injected handler — companion to
 * `TrackFileRestorationPlugin` in `./restore.ts`.
 *
 * Soft-deletion (vs hard-delete) is intentional: an undo (Ctrl+Z) can
 * re-insert the node, and the restore plugin observes the re-insertion to
 * un-soft-delete the asset on the server. A background reaper in
 * `apps/api/plane/bgtasks/file_asset_task.py` performs the eventual
 * hard-delete on assets that stay soft-deleted past the retention window.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
// constants
import { CORE_EDITOR_META } from "@/constants/meta";
// plane editor imports
import { NODE_FILE_MAP } from "@/plane-editor/constants/utility";
// types
import type { TFileHandler } from "@/types";
// local imports
import type { NodeFileMapType } from "../../../ce/constants/utility";
import type { TFileNode } from "./types";

/** PluginKey identifying the file-deletion tracking plugin instance. */
const DELETE_PLUGIN_KEY = new PluginKey("delete-utility");

/**
 * Track file-backed node deletion and soft-delete the underlying asset.
 *
 * Companion to `TrackFileRestorationPlugin` (`./restore.ts`) — establishes
 * the soft-delete half of the delete/restore protocol that lets undo-after-
 * delete restore BOTH the document node AND the server-side asset state.
 *
 * @param editor - TipTap editor instance used to read `editor.storage[nodeType]`
 *   and dispatch `editor.commands.updateAssetsList`.
 * @param deleteHandler - Async callback `(src: string) => Promise<void>`
 *   provided by the host application. Performs the server-side soft-delete
 *   (e.g., marks the asset as orphaned in S3 metadata so the cleanup task
 *   can hard-delete it later).
 *
 * Triggered by: `appendTransaction` on any transaction batch where at least
 * one transaction has `tr.docChanged === true` AND no transaction in the
 * batch carries the `CORE_EDITOR_META.SKIP_FILE_DELETION` meta flag.
 * Batches that fail either gate short-circuit and return null.
 *
 * State read:
 *   - `newState.doc` — walked via `descendants()` to build
 *     `newFileSources[nodeType]`, a per-node-type Set of `attrs.src` values
 *     currently in the document AFTER the change.
 *   - `oldState.doc` — walked via `descendants()` to find file-backed nodes
 *     whose `attrs.src` is NOT in `newFileSources[nodeType]`; these are the
 *     removed (or replaced) nodes.
 *   - `NODE_FILE_MAP[nodeType]` — registry of file-backed node types from
 *     `@/plane-editor/constants/utility` (mirrored from
 *     `ce/constants/utility.ts`, mapping IMAGE / CUSTOM_IMAGE →
 *     `{ fileSetName: "deletedImageSet" }`). Non-file-backed nodes are
 *     skipped.
 *
 * State write:
 *   - `editor.storage[nodeType][fileSetName].set(src, true)` — marks the
 *     source as soft-deleted in the per-extension file-set storage map. The
 *     `true` value is the soft-delete flag (read by `restore.ts` to know
 *     whether to invoke `restoreHandler` on later re-insertion).
 *   - `editor.commands.updateAssetsList({ idToRemove: node.attrs.id })` —
 *     removes the asset entry from the editor's tracked asset list so UI
 *     consumers (asset count badges, etc.) update.
 *   - `await deleteHandler(src)` — host-supplied callback that performs the
 *     server-side soft-delete.
 *
 * WHY soft-delete vs hard-delete:
 *   A node removed from the document (backspace, undo of insert, cut) does
 *   NOT immediately delete the underlying file asset on the server — undo
 *   (Ctrl+Z) can re-insert the node, and hard-deleting the asset on removal
 *   would leave the restored node pointing at a dead URL. Soft-deletion via
 *   the per-extension file-set storage map lets `restore.ts` detect the
 *   re-insertion and call `restoreHandler(src)` to un-soft-delete on the
 *   server. A background task in `apps/api/plane/bgtasks/file_asset_task.py`
 *   reaps assets that stay soft-deleted past the retention window — that is
 *   the only place the actual hard-delete happens.
 *
 * WHY the `SKIP_FILE_DELETION` meta gate:
 *   Commands that update file-node attrs without meaning to delete the
 *   underlying asset (e.g., image resize, alt-text edit) attach this meta
 *   flag to bypass the deletion path. Without the gate every attribute
 *   update on a file-backed node would falsely look like a removal (because
 *   ProseMirror replaces the node) and trigger a phantom delete. See
 *   `core/constants/meta.ts` for
 *   `CORE_EDITOR_META.SKIP_FILE_DELETION = "skipFileDeletion"`.
 *
 * Error isolation: each per-node delete is wrapped in try/catch that logs
 * `"Error deleting file via delete utility plugin:"`. A failed
 * `deleteHandler` call for one source does NOT abort cleanup for the
 * remaining removed nodes.
 *
 * Returns null from `appendTransaction` — deletion is a SIDE EFFECT (server
 * callback + editor.storage mutation), not part of the ProseMirror document
 * state, so no follow-up transaction is appended.
 */
export const TrackFileDeletionPlugin = (editor: Editor, deleteHandler: TFileHandler["delete"]): Plugin =>
  new Plugin({
    key: DELETE_PLUGIN_KEY,
    appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
      const newFileSources: {
        [nodeType: string]: Set<string> | undefined;
      } = {};
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta(CORE_EDITOR_META.SKIP_FILE_DELETION))) return null;

      newState.doc.descendants((node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
        if (nodeFileSetDetails) {
          if (newFileSources[nodeType]) {
            newFileSources[nodeType].add(node.attrs.src);
          } else {
            newFileSources[nodeType] = new Set([node.attrs.src]);
          }
        }
      });

      const removedFiles: TFileNode[] = [];

      // iterate through all the nodes in the old state
      oldState.doc.descendants((node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const isAValidNode = NODE_FILE_MAP[nodeType];
        // if the node doesn't match, then return as no point in checking
        if (!isAValidNode) return;
        // Check if the node has been deleted or replaced
        if (!newFileSources[nodeType]?.has(node.attrs.src)) {
          removedFiles.push(node as TFileNode);
        }
      });

      removedFiles.forEach(async (node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const src = node.attrs.src;
        const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
        if (!nodeFileSetDetails || !src) return;
        try {
          editor.storage[nodeType]?.[nodeFileSetDetails.fileSetName]?.set(src, true);
          // update assets list storage value
          editor.commands.updateAssetsList?.({
            idToRemove: node.attrs.id,
          });
          await deleteHandler(src);
        } catch (error) {
          console.error("Error deleting file via delete utility plugin:", error);
        }
      });

      return null;
    },
  });
