/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Legacy public-image recovery helper for the editor's `onCreate` hook.
 *
 * Older Plane content predates the asset-management API and references images by direct HTTP URL (no managed asset id). This helper walks the document, identifies those external-source image nodes, and invokes a per-source restore callback to duplicate them into the managed asset bucket so the images survive future workspace migrations and apiserver auth changes.
 */

import type { Editor } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import type { TFileHandler } from "@/types";

/**
 * Walks the document, collects unique HTTP image sources from `image` / `imageComponent` nodes, and invokes `restoreImageFn` once per unique source to re-ingest them through the managed asset bucket.
 *
 * Legacy hack: do not remove this `onCreate` hook. Older public images render directly from their HTTP source without going through the apiserver, so a deleted source produces no error feedback in the editor — duplicating them into managed storage is the only way to make legacy content survive workspace migrations and apiserver auth changes.
 *
 * @param editor - TipTap editor instance whose document is walked via `state.doc.descendants`.
 * @param restoreImageFn - File-handler `restore` callback; invoked once per unique HTTP source. Errors are caught and logged so a single failure does not block other restorations.
 */
export const restorePublicImages = (editor: Editor, restoreImageFn: TFileHandler["restore"]) => {
  const imageSources = new Set<string>();
  editor.state.doc.descendants((node) => {
    if ([CORE_EXTENSIONS.IMAGE, CORE_EXTENSIONS.CUSTOM_IMAGE].includes(node.type.name as CORE_EXTENSIONS)) {
      if (!node.attrs.src?.startsWith("http")) return;

      imageSources.add(node.attrs.src);
    }
  });

  imageSources.forEach(async (src) => {
    try {
      await restoreImageFn(src);
    } catch (error) {
      console.error("Error restoring image: ", error);
    }
  });
};
