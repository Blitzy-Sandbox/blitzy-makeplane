/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin that closes the soft-delete loop for file-backed editor
 * nodes — companion to `TrackFileDeletionPlugin` in `./delete.ts`.
 *
 * Detects file-backed nodes (registered in `NODE_FILE_MAP` from
 * `@/plane-editor/constants/utility`) that were re-inserted after a prior
 * soft-delete (e.g., via undo) and invokes the host-supplied `restoreHandler`
 * to un-soft-delete the asset on the server, so the cleanup task no longer
 * reaps it.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
// plane imports
import { CORE_EXTENSIONS } from "@plane/utils";
// helpers
import { CORE_ASSETS_META_DATA_RECORD } from "@/helpers/assets";
// plane editor imports
import { NODE_FILE_MAP } from "@/plane-editor/constants/utility";
// types
import type { TFileHandler } from "@/types";
// local imports
import type { NodeFileMapType } from "../../../ce/constants/utility";
import type { TFileNode } from "./types";

/** PluginKey identifying the file-restoration tracking plugin instance. */
const RESTORE_PLUGIN_KEY = new PluginKey("restore-utility");

/**
 * Track file-backed node re-insertion and un-soft-delete the asset on the server.
 *
 * Companion to `TrackFileDeletionPlugin` (`./delete.ts`) — closes the
 * soft-delete loop so that undo-after-delete restores BOTH the document node
 * AND the server-side asset state (e.g., the orphan flag in S3 metadata that
 * the cleanup task uses to reap stale assets).
 *
 * @param editor - TipTap editor instance whose `storage` and `commands`
 *   surfaces are read and mutated by this plugin.
 * @param restoreHandler - Async callback `(src: string) => Promise<void>`
 *   that un-soft-deletes the asset on the server. The plugin awaits this
 *   call before clearing the local soft-delete flag, so a server failure
 *   leaves the local flag intact and allows a retry on the next transaction.
 *
 * Triggered by: `appendTransaction` on any transaction batch where
 * `tr.docChanged` is true on at least one transaction. Batches with no
 * document change short-circuit and return null.
 *
 * State read:
 *   - `oldState.doc` — walked once to build `oldFileSources[nodeType]`, a
 *     per-node-type Set of `attrs.src` values present BEFORE the change.
 *   - `newState.doc` — walked per transaction to find file-backed nodes
 *     whose `attrs.src` is NOT in `oldFileSources[nodeType]`, i.e., the
 *     newly-relevant (re-inserted or freshly-added) file references.
 *   - `NODE_FILE_MAP[nodeType]` — registry of file-backed node types from
 *     `@/plane-editor/constants/utility` (mirrored from
 *     `ce/constants/utility.ts`, mapping IMAGE / CUSTOM_IMAGE →
 *     `{ fileSetName: "deletedImageSet" }`). Non-file-backed nodes are
 *     skipped.
 *   - `CORE_ASSETS_META_DATA_RECORD[nodeType]?.(node.attrs)` — per-extension
 *     asset-metadata extractor; returns the asset-list entry derived from
 *     the node's attrs when the node is asset-bearing.
 *   - `editor.storage[nodeType]?.[fileSetName]` — per-extension file-set
 *     storage; `wasDeleted = extensionFileSetStorage?.get(src)` reports the
 *     prior soft-delete state for this `src`.
 *
 * State write:
 *   - `editor.commands.updateAssetsList?.({ asset: assetMetaData })` — adds
 *     the asset entry to the editor's tracked asset list when a non-empty
 *     metadata record is produced.
 *   - `extensionFileSetStorage?.set(src, false)` — unmarks the soft-delete
 *     flag. Applied in two cases:
 *       1. `wasDeleted === undefined` (first-insert initialization, see
 *          below).
 *       2. `wasDeleted === true` AND `restoreHandler(src)` resolved
 *          successfully (post-restore commit).
 *   - `await restoreHandler(src)` — host callback that performs the
 *     server-side restore (un-soft-delete).
 *
 * WHY skip `CORE_EXTENSIONS.CUSTOM_IMAGE` with non-http `src`:
 *   A `CUSTOM_IMAGE` node whose `node.attrs.src` does NOT start with
 *   `"http"` carries a PRIVATE BUCKET identifier — a UUID-like id the
 *   editor assigns to in-progress / uploaded-but-unresolved images, not a
 *   resolvable URL. Calling `restoreHandler` with such an identifier would
 *   hit the server with a non-URL argument and be meaningless. Restoration
 *   for private-bucket images is instead driven by the custom-image
 *   extension's failed-to-load path (when the image URL finally resolves
 *   and the load result is observed), NOT by this plugin. The early-return
 *   on line 64 prevents the false call.
 *
 * WHY the `wasDeleted === undefined` initialization branch:
 *   When a source has never been recorded in
 *   `editor.storage[nodeType][fileSetName]` (typical for the FIRST insert
 *   of an asset after editor mount), the plugin seeds it with
 *   `set(src, false)`. Without this seed, the delete/restore loop cannot
 *   bootstrap: `TrackFileDeletionPlugin` flips the flag to `true` on
 *   delete, and this plugin observes the `true` value on the subsequent
 *   restore. Skipping the seed would leave `get(src)` returning
 *   `undefined` forever and the prior-delete branch would never fire.
 *
 * Error isolation: each per-node restore is wrapped in try/catch that logs
 * `"Error restoring file via restore utility plugin:"`. A failed restore
 * does NOT abort the plugin or the surrounding transaction — the
 * soft-delete flag is left intact and the next docChange will re-attempt.
 *
 * Returns null from `appendTransaction` — restoration is a SIDE EFFECT
 * (server callback + editor.storage mutation), not part of the ProseMirror
 * document state, so no follow-up transaction is appended.
 */
export const TrackFileRestorationPlugin = (editor: Editor, restoreHandler: TFileHandler["restore"]): Plugin =>
  new Plugin({
    key: RESTORE_PLUGIN_KEY,
    appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const oldFileSources: {
        [key: string]: Set<string> | undefined;
      } = {};
      oldState.doc.descendants((node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
        if (nodeFileSetDetails) {
          if (oldFileSources[nodeType]) {
            oldFileSources[nodeType].add(node.attrs.src);
          } else {
            oldFileSources[nodeType] = new Set([node.attrs.src]);
          }
        }
      });

      transactions.forEach(() => {
        const addedFiles: TFileNode[] = [];

        newState.doc.descendants((node, pos) => {
          const nodeType = node.type.name as keyof NodeFileMapType;
          const isAValidNode = NODE_FILE_MAP[nodeType];
          // if the node doesn't match, then return as no point in checking
          if (!isAValidNode) return;
          if (pos < 0 || pos > newState.doc.content.size) return;
          if (oldFileSources[nodeType]?.has(node.attrs.src)) return;
          // update assets list storage value
          const assetMetaData = CORE_ASSETS_META_DATA_RECORD[nodeType]?.(node.attrs);
          if (assetMetaData) {
            editor.commands.updateAssetsList?.({
              asset: assetMetaData,
            });
          }
          // if the src is just a id (private bucket), then we don't need to handle restore from here but
          // only while it fails to load
          if (nodeType === CORE_EXTENSIONS.CUSTOM_IMAGE && !node.attrs.src?.startsWith("http")) return;
          addedFiles.push(node as TFileNode);
        });

        addedFiles.forEach(async (node) => {
          const nodeType = node.type.name as keyof NodeFileMapType;
          const src = node.attrs.src;
          const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
          if (!nodeFileSetDetails) return;
          const extensionFileSetStorage = editor.storage[nodeType]?.[nodeFileSetDetails.fileSetName];
          const wasDeleted = extensionFileSetStorage?.get(src);
          if (!nodeFileSetDetails || !src) return;
          if (wasDeleted === undefined) {
            extensionFileSetStorage?.set(src, false);
          } else if (wasDeleted === true) {
            try {
              await restoreHandler(src);
              extensionFileSetStorage?.set(src, false);
            } catch (error) {
              console.error("Error restoring file via restore utility plugin:", error);
            }
          }
        });
      });
      return null;
    },
  });
