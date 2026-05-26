/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the `@plane/editor` editor component layer.
 *
 * Re-exports the four canonical editor variants — document (standard +
 * collaborative), lite-text, and rich-text — along with the shared composition
 * primitives `EditorContainer`, `EditorContentWrapper`, and `EditorWrapper`.
 *
 * The package-level `packages/editor/src/index.ts` re-exports
 * `CollaborativeDocumentEditorWithRef`, `DocumentEditorWithRef`,
 * `LiteTextEditorWithRef`, and `RichTextEditorWithRef` through this module,
 * making it the stable public boundary for every editor surface in the package.
 *
 * `@plane/editor` is treated as first-party code that wraps TipTap; this
 * barrel is the single entry point through which all wrapped TipTap behavior
 * is exposed to downstream consumers.
 */

export * from "./document";
export * from "./lite-text";
export * from "./rich-text";
export * from "./editor-container";
export * from "./editor-content";
export * from "./editor-wrapper";
