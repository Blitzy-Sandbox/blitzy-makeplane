/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Orchestration entry point for the file-plugin subsystem. Exports
 * `FilePlugins`, which the editor setup calls to assemble the file-lifecycle
 * plugins (`TrackFileDeletionPlugin` from `./delete`,
 * `TrackFileRestorationPlugin` from `./restore`) into a stable, ordered
 * plugin set for editor registration.
 */

import type { Editor } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
// types
import type { TFileHandler } from "@/types";
// local imports
import { TrackFileDeletionPlugin } from "./delete";
import { TrackFileRestorationPlugin } from "./restore";

/** Arguments accepted by `FilePlugins`. */
type TArgs = {
  editor: Editor;
  fileHandler: TFileHandler;
  isEditable: boolean;
};

/**
 * Compose the file-lifecycle plugin set for an editor instance.
 *
 * @param args - `{ editor, fileHandler, isEditable }` configuration.
 * @returns Array of ProseMirror plugins to register with the editor.
 *
 * Conditionally includes `TrackFileDeletionPlugin` (from `./delete`) when
 * BOTH:
 *   - The editor is editable (`isEditable === true`) — read-only views never
 *     delete file nodes, so the plugin is omitted to save runtime cycles.
 *   - The host provides a `fileHandler.delete` callback. Hosts that only
 *     offer restoration (e.g., archive view) opt out by omitting `delete`
 *     from the handler.
 *
 * `TrackFileRestorationPlugin` (from `./restore`) is ALWAYS included so that
 * re-inserted assets (e.g., from a collaborative peer) get un-soft-deleted
 * server-side even on read-only views.
 *
 * Consumed by the editor setup in `core/extensions/` via
 * `addProseMirrorPlugins()`. Plugin order in the returned array matters only
 * insofar as ProseMirror plugins run in registration order — delete runs
 * before restore in the same transaction batch.
 */
export const FilePlugins = (args: TArgs): Plugin[] => {
  const { editor, fileHandler, isEditable } = args;

  return [
    ...(isEditable && "delete" in fileHandler ? [TrackFileDeletionPlugin(editor, fileHandler.delete)] : []),
    TrackFileRestorationPlugin(editor, fileHandler.restore),
  ];
};
