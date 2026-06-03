/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Document-editor public API barrel.
 *
 * Re-exports the named symbols from the four sibling implementation files
 * so callers depend on this stable module boundary rather than on the
 * internal four-file layout:
 *
 * - `./collaborative-editor` — `CollaborativeDocumentEditorWithRef`, the
 *   real-time (Hocuspocus + Y.js) document editor entry point.
 * - `./editor` — `DocumentEditorWithRef`, the non-collaborative document
 *   editor entry point.
 * - `./loader` — `DocumentContentLoader`, the loading skeleton rendered by
 *   `PageRenderer` while editor content is hydrating.
 * - `./page-renderer` — `PageRenderer`, the shared rendering shell that
 *   composes the editor surface for both editor variants above.
 *
 * Of these four symbols, only `CollaborativeDocumentEditorWithRef` and
 * `DocumentEditorWithRef` propagate to the package's top-level public API:
 * the parent barrel at
 * `packages/editor/src/core/components/editors/index.ts` re-exports this
 * module via `export * from "./document"`, and the package entry point at
 * `packages/editor/src/index.ts` names those two symbols explicitly.
 * `DocumentContentLoader` and `PageRenderer` reach the package entry only
 * incidentally and are intended for intra-package use by the editor
 * variants themselves (`collaborative-editor.tsx`, `editor.tsx`, and
 * `page-renderer.tsx` import them through the parent barrel).
 *
 * The barrel exists so that any future renaming or restructuring inside
 * this folder remains source-compatible as long as the same named symbols
 * continue to be re-exported here.
 */

export * from "./collaborative-editor";
export * from "./editor";
export * from "./loader";
export * from "./page-renderer";
