/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Transaction-meta vocabulary for the Plane editor.
 *
 * Each enum value is a stable string key passed to ProseMirror's
 * `Transaction#setMeta` / `Transaction#getMeta` so that command callers
 * and plugins can signal special-case intent that overrides default
 * editor behavior (file-asset cleanup, undo-history tracking, etc.).
 *
 * The enum is centralized — rather than scattering literal strings across
 * writers and readers — because every consumer must agree on the *exact*
 * key. The string values are arbitrary; what matters is that the writer
 * (e.g. an editor command setting the meta) and the reader (e.g. a plugin
 * inspecting transactions in `appendTransaction`) reference the same
 * identifier. Renaming a value here without updating every call site would
 * silently break the bypass it represents.
 */
export enum CORE_EDITOR_META {
  /**
   * Marks a transaction whose clearing/replacement should **not** trigger
   * the editor's automatic file-asset deletion side effect. Used by
   * content-swap flows (e.g. `core/hooks/use-title-editor.ts` clearing the
   * title on every render, `core/helpers/editor-ref.ts#clearContent`)
   * where the content is being repopulated rather than truly deleted; the
   * asset-cleanup plugin in `core/plugins/file/delete.ts` reads this meta
   * and short-circuits when set.
   */
  SKIP_FILE_DELETION = "skipFileDeletion",
  /**
   * Marks a deletion as explicit so the file-asset cleanup plugin in
   * `core/plugins/file/delete.ts` knows to garbage-collect referenced
   * uploads — distinguishing real deletes from incidental selection-replace
   * operations. Set in tandem with `SKIP_FILE_DELETION` by
   * `core/hooks/use-title-editor.ts` and `core/helpers/editor-ref.ts` to
   * declare the caller's intent unambiguously.
   */
  INTENTIONAL_DELETION = "intentionalDeletion",
  /**
   * Lets a transaction author override the default undo-history behavior
   * for an internal/programmatic mutation. Currently set to `false` by
   * `core/extensions/table/plugins/drag-handles/utils.ts` so the bookkeeping
   * transactions that maintain drag-handle decorations do not appear as
   * undoable steps in the user-visible history stack.
   */
  ADD_TO_HISTORY = "addToHistory",
}
