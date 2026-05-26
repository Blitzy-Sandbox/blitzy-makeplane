/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compile-time type contract for file-backed editor nodes (images,
 * attachments, and custom images). Provides the intersection between a
 * ProseMirror node and the `attrs.src` / `attrs.id` shape that the deletion
 * (`./delete.ts`) and restoration (`./restore.ts`) plugins narrow against
 * when iterating document descendants in `appendTransaction`.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * A file-backed ProseMirror node whose `attrs` carry the asset source and
 * the editor-unique asset identifier.
 *
 * - `attrs.src`: either the resolved asset URL (HTTP[S]) or, for in-progress
 *   uploads on `CUSTOM_IMAGE` nodes, a private bucket id (UUID-like, NOT
 *   beginning with `"http"`). See `./restore.ts` for the
 *   `!startsWith("http")` skip branch that excludes these unresolved sources
 *   from the server-side `restoreHandler` callback.
 * - `attrs.id`: the editor-unique asset identifier passed to
 *   `editor.commands.updateAssetsList({ idToRemove: ... })` on delete (and
 *   to the additive form on restore) so the editor's tracked asset list
 *   stays in sync with document contents.
 *
 * Pure type alias — zero runtime/bundle cost; the underlying ProseMirror
 * symbol is brought in via `import type` only.
 */
export type TFileNode = ProseMirrorNode & {
  attrs: {
    src: string;
    id: string;
  };
};
