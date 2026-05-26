/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only / "without props" variant of the code-block extension.
 *
 * Mirrors `./index.tsx` (`CustomCodeBlockExtension`) but OMITS the React
 * node view — only the schema, parse rules, lowlight syntax-highlight
 * plugin, and keyboard shortcuts are wired. Used by
 * `core/extensions/core-without-props.ts` to assemble the
 * `CoreEditorExtensionsWithoutProps` bundle consumed by non-interactive
 * rendering contexts:
 *   - `apps/live` server-side HTML → Y.js binary backfill
 *     (see `apps/live/src/extensions/database.ts`)
 *   - PDF export pipeline (see `apps/live/src/services/pdf-export/`)
 *   - Any other context requiring a TipTap editor instance without React
 *     tree mounting overhead
 *
 * Same `lowlight` v3.0.0 `common` language bundle + explicit TypeScript
 * registration as the interactive variant. Same `defaultLanguage:
 * "plaintext"` fallback. Note that the interactive variant's
 * `HTMLAttributes: { class: "" }` configuration is intentionally NOT
 * applied here — it only matters for inline class accumulation in styled
 * client DOM, which is irrelevant when no DOM is being rendered.
 *
 * Without-props pattern note: this is the canonical example of the
 * pattern used across other feature extensions
 * (`callout/extension-config.ts`, `custom-image/extension-config.ts`,
 * `mentions/extension-config.ts`, `work-item-embed/extension-config.ts`).
 * Every `*WithoutProps` variant produces the same SCHEMA as its
 * interactive counterpart so server-side conversion produces ProseMirror
 * documents structurally identical to client-rendered ones — a hard
 * requirement for Y.js binary state to round-trip across the client and
 * server boundary in `apps/live`.
 */

import { Selection } from "@tiptap/pm/state";
import ts from "highlight.js/lib/languages/typescript";
import { common, createLowlight } from "lowlight";
// components
import { CodeBlockLowlight } from "./code-block-lowlight";

const lowlight = createLowlight(common);
lowlight.register("ts", ts);

/**
 * Schema-only counterpart of `CustomCodeBlockExtension` (`./index.tsx`).
 *
 * Composition:
 *   `CodeBlockLowlight`
 *     ↓ `.extend({ addKeyboardShortcuts })` — same Tab/ArrowUp/ArrowDown
 *       handlers as the interactive variant (try/catch error handling and
 *       Selection-based cursor management byte-identical)
 *     ↓ `.configure({ lowlight, defaultLanguage: "plaintext",
 *       exitOnTripleEnter: false })`
 *
 * Differences from `CustomCodeBlockExtension`:
 *   - Omits `addNodeView()` → no React node view; ProseMirror's default
 *     `<pre><code>...</code></pre>` DOM rendering applies instead of the
 *     React `CodeBlockComponent` (no copy button, no `<NodeViewWrapper>`
 *     chrome).
 *   - Omits `HTMLAttributes: { class: "" }` from `.configure()` →
 *     upstream-cascaded HTMLAttributes (default `{}`) is used.
 *   - Identical schema, commands, input rules, paste handler, and
 *     keyboard handlers.
 *
 * Exposes / Overrides / Hides (same triplet as `CustomCodeBlockExtension`
 * MINUS the React layer):
 *   - Exposes: all `CodeBlockLowlight` + `CodeBlock` + `lowlight` v3.0.0
 *     behavior — schema (`block` group, `text*` content, `code: true`
 *     atomic, `language` attribute), commands (`setCodeBlock`,
 *     `toggleCodeBlock`), input rules (` ``` ` and `~~~`), the VS Code
 *     paste handler, and the syntax-highlight decoration set powered by
 *     the `common` language bundle plus explicit TypeScript registration.
 *   - Overrides: `Tab` / `ArrowUp` / `ArrowDown` keyboard shortcuts,
 *     `exitOnTripleEnter: false`, `defaultLanguage: "plaintext"`.
 *   - Hides: the React node view (emits plain `<pre><code>` DOM); the
 *     interactive variant's empty `HTMLAttributes.class` configuration
 *     (no effect on the schema — only matters for client-side class
 *     accumulation prevention).
 *
 * WHY a separate variant exists: React node views need a React tree to
 * render into. Server-side / Node-side contexts (HTML→Y.js conversion in
 * `apps/live/src/extensions/database.ts`, PDF export rendering) don't
 * mount React. Omitting the React layer while preserving the schema lets
 * these contexts produce ProseMirror documents structurally identical to
 * interactive sessions — essential so Y.js binary state generated from
 * server-side HTML conversion matches what an interactive client would
 * produce.
 *
 * WHY the keyboard shortcuts are preserved identically: the handlers
 * affect document structure (e.g., `ArrowUp` can insert a paragraph above
 * the first node). Automation that dispatches synthetic key events during
 * server-side content generation must produce the same document tree as
 * user interaction, so the shortcut behavior must match the interactive
 * variant exactly.
 *
 * Consumed by `core/extensions/core-without-props.ts` via the
 * `CoreEditorExtensionsWithoutProps` array.
 */
export const CustomCodeBlockExtensionWithoutProps = CodeBlockLowlight.extend({
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
});
