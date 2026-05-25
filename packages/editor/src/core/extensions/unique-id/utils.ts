/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * View-level backfill utility for the Plane unique-ID extension.
 *
 * Walks the current editor document, locates block nodes whose configured
 * ID attribute is `null`, and stamps a fresh ID on each in a single
 * transaction. Used by `./extension.ts` on `onCreate` and by `./plugin.ts`
 * once the Hocuspocus collaboration provider emits `synced`.
 *
 * Why a separate imperative helper exists:
 *   - The plugin's `appendTransaction` hook only sees nodes touched by a
 *     transaction. Legacy documents loaded from storage (or freshly synced
 *     from the Hocuspocus provider in apps/live) need an explicit sweep to
 *     stamp IDs on every pre-existing block.
 *   - The dispatched transaction is marked `addToHistory: false` and
 *     `uniqueIdOnlyChange: true` so that this migration sweep does not
 *     pollute undo history and is recognizable downstream as an ID-only
 *     update (see `packages/editor/src/core/hooks/use-editor.ts`, where
 *     `isMigrationUpdate` is read from this meta flag).
 *
 * Collaborative-safety note:
 *   This helper is invoked locally on each client. When called after the
 *   Y.js provider is synced, every connected client converges to the same
 *   document state via the CRDT; clients that share an `id`-less node will
 *   each stamp an ID locally, but because the Y.js merge is structural (it
 *   reconciles the underlying Y.Doc, not the rendered ProseMirror state),
 *   the dispatched ProseMirror transaction is local-only and the resulting
 *   IDs participate in normal CRDT convergence with no cross-client
 *   collision protection beyond UUID v4 uniqueness.
 */

import { findChildren } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
// types
import type { UniqueIDOptions } from "./extension";

/**
 * Stamp unique IDs onto every block node currently missing one.
 *
 * Behavior:
 *   1. Exits early when the document is effectively empty (`doc.content.size <= 2`)
 *      — i.e., contains only the default empty paragraph. This avoids stamping
 *      an ID onto a placeholder that the user has not yet typed into.
 *   2. Uses `findChildren` from `@tiptap/core` to locate every node whose
 *      `node.type.name` is in `options.types` (block-level node allow-list)
 *      AND whose existing ID attribute is exactly `null`.
 *   3. For each match, generates a new ID via `options.generateUniqueID`
 *      (default: UUID v4) and applies it through `setNodeMarkup`, preserving
 *      all other attributes.
 *   4. Marks the dispatched transaction with:
 *        - `addToHistory: false` — keeps the migration sweep out of undo.
 *        - `uniqueIdOnlyChange: true` — flag consumed by `use-editor.ts`
 *          to distinguish a migration update from a real user edit
 *          (see `packages/editor/src/core/hooks/use-editor.ts` line ~93).
 *
 * Triggers (callers):
 *   - `./extension.ts` `onCreate()` — initial backfill on editor mount when
 *     either no collaboration provider is configured or the provider is
 *     already synced.
 *   - `./plugin.ts` `view().synced` callback — runs once after the
 *     Hocuspocus provider signals `synced` for collaborative documents.
 *
 * Why this is the legacy-document migration path:
 *   Documents authored before this extension existed have no `id` attribute
 *   on their block nodes. The first time such a document is opened in an
 *   editor that includes `UniqueID`, this helper sweeps the document and
 *   stamps IDs. Subsequent edits flow through the plugin's
 *   `appendTransaction` hook; only the initial sweep is performed here.
 *
 * Collaboration semantics:
 *   When invoked from the plugin's `synced` callback, the editor's Y.Doc
 *   is already populated with the authoritative server state delivered by
 *   the Hocuspocus server in `apps/live`. The dispatched transaction is
 *   bound to the local ProseMirror view; structural changes propagate
 *   through the y-prosemirror binding into the Y.Doc and are persisted by
 *   `apps/live/src/extensions/database.ts` on its standard debounced cycle.
 *   Because UUID v4 is statistically unique, simultaneous backfills on two
 *   clients will not collide.
 *
 * @param view    The ProseMirror `EditorView` whose document is swept.
 * @param options The same `UniqueIDOptions` passed to the parent extension,
 *                providing `types` (managed node names), `attributeName`
 *                (the ID attribute, defaulting to `"id"`), and
 *                `generateUniqueID` (the ID factory).
 * @returns void  This helper either dispatches one transaction or returns
 *                without dispatching when the document is effectively empty.
 */
export const createIdsForView = (view: EditorView, options: UniqueIDOptions) => {
  const { state } = view;
  const { tr, doc } = state;
  const { types, attributeName, generateUniqueID } = options;

  // size > 2 means more than just the default empty paragraph
  const hasContent = doc.content.size > 2;
  if (!hasContent) {
    return;
  }

  const nodesWithoutId = findChildren(
    doc,
    (node) => types.includes(node.type.name) && node.attrs[attributeName] === null
  );

  nodesWithoutId.forEach(({ node, pos }) => {
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      [attributeName]: generateUniqueID({ node, pos }),
    });
  });

  tr.setMeta("addToHistory", false);
  tr.setMeta("uniqueIdOnlyChange", true);

  view.dispatch(tr);
};
