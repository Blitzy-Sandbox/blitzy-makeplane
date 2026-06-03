/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Fully-assembled code-block extension for the interactive Plane editor.
 *
 * Composes three layers into the editor's runtime code-block surface:
 *   1. `CodeBlockLowlight` (from `./code-block-lowlight`) — base TipTap
 *      node + lowlight syntax-highlighting ProseMirror plugin.
 *   2. `CodeBlockComponent` (from `./code-block-node-view`) — React node
 *      view providing the copy button and container chrome.
 *   3. Custom keyboard shortcuts: `Tab` inserts a literal `\t`; `ArrowUp`
 *      at the start of a leading code block inserts a paragraph above it;
 *      `ArrowDown` at the end of a code block moves to the next node or
 *      exits the code block.
 *
 * Pairs with `CustomCodeBlockExtensionWithoutProps` (from
 * `./without-props`) — the same composition without the React node view,
 * consumed by `core-without-props.ts` for non-interactive rendering
 * contexts (server-side HTML→Y.js conversion, PDF export).
 *
 * Syntax highlighting languages:
 *   - All `common`-bundled languages from `lowlight` v3.0.0.
 *   - Plus TypeScript (`ts`), explicitly registered via
 *     `highlight.js/lib/languages/typescript` because the `common` bundle
 *     ships JavaScript but not TypeScript.
 *
 * Default language for un-tagged code blocks: `"plaintext"`.
 *
 * Re-export path: `packages/editor/src/core/extensions/index.ts`
 * (folder barrel) → consumed by the editor's main composition factory at
 * `core/extensions/extensions.ts`.
 */

import { Selection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ts from "highlight.js/lib/languages/typescript";
import { common, createLowlight } from "lowlight";
// components
import { CodeBlockLowlight } from "./code-block-lowlight";
import { CodeBlockComponent } from "./code-block-node-view";

// Module-local lowlight instance: `common` bundle + explicit TypeScript registration
// (lowlight v3's `common` set ships JavaScript but omits TypeScript).
const lowlight = createLowlight(common);
lowlight.register("ts", ts);

/**
 * The Plane editor's interactive code-block extension.
 *
 * Extends `CodeBlockLowlight` (which itself extends the in-house `CodeBlock`
 * from `./code-block.ts`) with a React node view via `ReactNodeViewRenderer`
 * and three keyboard-shortcut overrides; then `.configure`'d with the local
 * lowlight registry and Plane-specific options.
 *
 * Composition pipeline:
 *   `CodeBlockLowlight` (base TipTap node + LowlightPlugin)
 *     ↓ `.extend({ addNodeView, addKeyboardShortcuts })`
 *     ↓ `.configure({ lowlight, defaultLanguage, exitOnTripleEnter, HTMLAttributes })`
 *
 * Exposes (cascaded from `CodeBlockLowlight` / `lowlight` v3.0.0):
 *   - Schema: `block` group, `text*` content, atomic `code: true`,
 *     `language` attribute (from `./code-block.ts`).
 *   - Commands: `setCodeBlock(attrs?)`, `toggleCodeBlock(attrs?)`
 *     (declared in `./code-block.ts` via `declare module "@tiptap/core"`).
 *   - Input rules: triple-backtick (` ``` `) and triple-tilde (`~~~`)
 *     fence triggers with an optional language tag.
 *   - Paste handler: preserves inline-code marks; extracts VS Code
 *     clipboard `vscode-editor-data` metadata for language attribution.
 *   - Syntax highlighting: `LowlightPlugin` decoration set driven by the
 *     module-local `lowlight` registry (common languages + TypeScript).
 *   - React node view via `ReactNodeViewRenderer(CodeBlockComponent)`:
 *     renders `<NodeViewWrapper>` containing a hover-revealed copy button
 *     and a `<pre><NodeViewContent as="code" /></pre>` content host.
 *   - Cascaded base keyboard shortcuts: `Mod-Alt-c` toggles the code
 *     block; `Backspace` at the start clears the node; per-language input
 *     rules and other defaults from `./code-block.ts`.
 *
 * Overrides (this file):
 *   - `addNodeView()`: returns `ReactNodeViewRenderer(CodeBlockComponent)`
 *     — replaces the default DOM-only rendering with the React node view
 *     so the copy-to-clipboard affordance and styled container can be
 *     authored as a React component (see `./code-block-node-view.tsx`).
 *   - `Tab`: inserts a literal tab character at the cursor when the cursor
 *     is inside a code block. WHY: ProseMirror's default `Tab` moves focus
 *     out of the editor; inside code, users expect Tab to indent.
 *   - `ArrowUp`: when the caret is at the start of the very first node in
 *     the document AND that node is a code block, inserts a fresh
 *     paragraph at position 0 and moves the selection to it. WHY: a
 *     document that begins with a code block has no caret target above
 *     it; this hotkey provides one on demand.
 *   - `ArrowDown`: when the caret is at the end of a code block, moves to
 *     the next sibling node via `Selection.near` if one exists, otherwise
 *     calls `editor.commands.exitCode()`. WHY: provides a more reliable
 *     exit-from-code-block UX than the base node's `exitCode()`-only path,
 *     which can't reach an existing sibling without a separate keypress.
 *   - `.configure({ exitOnTripleEnter: false })`: suppresses the
 *     upstream-cascaded triple-`Enter` exit. WHY: in Plane's editor UX,
 *     triple-`Enter` is reserved for paragraph-level operations; code
 *     blocks exit via `ArrowDown` or explicit toggle instead.
 *   - `.configure({ defaultLanguage: "plaintext" })`: fallback language
 *     forwarded to `LowlightPlugin` when a code block has no `language`
 *     attribute; lowlight's `highlightAuto` is invoked when the default
 *     isn't matched in the registry.
 *   - `.configure({ HTMLAttributes: { class: "" } })`: replaces any
 *     cascaded HTMLAttributes with an explicit empty `class` to prevent
 *     inadvertent class accumulation through the extension chain.
 *
 * Hides:
 *   - The upstream `@tiptap/extension-code-block-lowlight` and
 *     `@tiptap/extension-code-block` packages are NOT used; the node is
 *     re-implemented in `./code-block.ts` so the schema, parser, and paste
 *     handler can encode Plane-specific behavior (VS Code clipboard
 *     handoff, custom Backspace / Enter handling).
 *   - Beyond `highlight` / `highlightAuto` / `listLanguages`, the rest of
 *     the `lowlight` v3.0.0 API surface (`registerAlias`, internal theme
 *     hooks, etc.) is not exposed to consumers through this extension.
 *   - When `exitOnTripleEnter: false` is set, the base `CodeBlock`'s
 *     triple-`Enter` exit handler is suppressed (see Overrides).
 */
export const CustomCodeBlockExtension = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        try {
          const { state } = editor;
          const { selection } = state;
          const { $from, empty } = selection;

          if (!empty || $from.parent.type !== this.type) {
            return false;
          }

          // Use ProseMirror's insertText transaction to insert the tab character
          const tr = state.tr.insertText("\t", $from.pos, $from.pos);
          editor.view.dispatch(tr);

          return true;
        } catch (error) {
          console.error("Error handling Tab in CustomCodeBlockExtension:", error);
          return false;
        }
      },
      ArrowUp: ({ editor }) => {
        try {
          const { state } = editor;
          const { selection } = state;
          const { $from, empty } = selection;

          if (!empty || $from.parent.type !== this.type) {
            return false;
          }

          const isAtStart = $from.parentOffset === 0;

          if (!isAtStart) {
            return false;
          }

          // Check if codeBlock is the first node
          const isFirstNode = $from.depth === 1 && $from.index($from.depth - 1) === 0;

          if (isFirstNode) {
            // Insert a new paragraph at the start of the document and move the cursor to it
            return editor.commands.command(({ tr }) => {
              const node = editor.schema.nodes.paragraph.create();
              tr.insert(0, node);
              tr.setSelection(Selection.near(tr.doc.resolve(1)));
              return true;
            });
          }

          return false;
        } catch (error) {
          console.error("Error handling ArrowUp in CustomCodeBlockExtension:", error);
          return false;
        }
      },
      ArrowDown: ({ editor }) => {
        try {
          if (!this.options.exitOnArrowDown) {
            return false;
          }

          const { state } = editor;
          const { selection, doc } = state;
          const { $from, empty } = selection;

          if (!empty || $from.parent.type !== this.type) {
            return false;
          }

          const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;

          if (!isAtEnd) {
            return false;
          }

          const after = $from.after();

          if (after === undefined) {
            return false;
          }

          const nodeAfter = doc.nodeAt(after);

          if (nodeAfter) {
            return editor.commands.command(({ tr }) => {
              tr.setSelection(Selection.near(doc.resolve(after)));
              return true;
            });
          }

          return editor.commands.exitCode();
        } catch (error) {
          console.error("Error handling ArrowDown in CustomCodeBlockExtension:", error);
          return false;
        }
      },
    };
  },
}).configure({
  lowlight,
  defaultLanguage: "plaintext",
  exitOnTripleEnter: false,
  HTMLAttributes: {
    class: "",
  },
});
