/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Base TipTap node extension for fenced code blocks.
 *
 * This file is the FIRST-PARTY reimplementation of TipTap's code-block
 * node. Plane intentionally does NOT depend on
 * `@tiptap/extension-code-block` (see the commented-out import in
 * `./code-block-lowlight.ts` line 7 documenting the deliberate
 * replacement). Owning this base lets Plane add behavior that the
 * upstream extension does not provide:
 *
 *   1. A clipboard paste handler that detects VS Code's
 *      `vscode-editor-data` JSON payload (set on copy from VS Code) and
 *      extracts the original source-file's `mode` (language) so a code
 *      block pasted from VS Code arrives pre-tagged with its language.
 *      The same plugin also handles paste inside an inline code mark
 *      (wraps the pasted text in `schema.marks.code`).
 *   2. A Backspace-at-start handler that clears an empty code block
 *      back to the default block (paragraph) via `clearNodes()` rather
 *      than just deleting one character.
 *   3. A configurable triple-Enter exit (`exitOnTripleEnter`) and a
 *      configurable arrow-down exit (`exitOnArrowDown`) — when the
 *      cursor is at the last position of a code block, ArrowDown or
 *      three consecutive Enter presses on an empty line lifts the
 *      cursor into a new paragraph after the block.
 *   4. Backtick (` ``` `) AND tilde (` ~~~ `) input rules with an
 *      optional trailing language identifier (e.g., ` ```typescript `).
 *
 * Composed downstream by `./code-block-lowlight.ts`, which extends this
 * node with the `LowlightPlugin` for syntax highlighting decorations,
 * and again by `./index.tsx` (`CustomCodeBlockExtension`) which adds a
 * React node view, Tab/ArrowUp shortcuts, and applies the production
 * `.configure({ defaultLanguage: "plaintext", exitOnTripleEnter: false,
 * HTMLAttributes: { class: "" } })` overrides.
 *
 * Schema name: `CORE_EXTENSIONS.CODE_BLOCK` (= `"codeBlock"`, see
 * `packages/editor/src/core/constants/extension.ts`).
 */

import { mergeAttributes, Node, textblockTypeInputRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Configuration options for the {@link CodeBlock} node extension.
 *
 * Fields (per-field JSDoc below carries the canonical descriptions; the
 * notes here only flag cross-field semantics and downstream overrides):
 *   - `languageClassPrefix`: matches the conventional Markdown /
 *     highlight.js convention so the rendered `<code class="language-X">`
 *     markup is directly consumable by syntax highlighters without
 *     remapping.
 *   - `exitOnTripleEnter`: default `true` at the base extension;
 *     overridden to `false` by `./index.tsx`'s `.configure(...)` call
 *     (Plane reserves triple-Enter for paragraph operations elsewhere).
 *   - `exitOnArrowDown`: default `true` at both the base and the
 *     composed extension.
 *   - `HTMLAttributes`: default `{}`; overridden to `{ class: "" }` by
 *     `./index.tsx`'s `.configure(...)` to clear any inherited classes.
 *
 * Note: the related `defaultLanguage` option lives on the extended
 * `CodeBlockLowlightOptions` (see `./code-block-lowlight.ts`), not on
 * this base type.
 */
export type CodeBlockOptions = {
  /**
   * Adds a prefix to language classes that are applied to code tags.
   * Defaults to `'language-'`.
   */
  languageClassPrefix: string;
  /**
   * Define whether the node should be exited on triple enter.
   * Defaults to `true`.
   */
  exitOnTripleEnter: boolean;
  /**
   * Define whether the node should be exited on arrow down if there is no node after it.
   * Defaults to `true`.
   */
  exitOnArrowDown: boolean;
  /**
   * Custom HTML attributes that should be added to the rendered HTML tag.
   */
  HTMLAttributes: Record<string, unknown>;
};

/**
 * Augments TipTap's `Commands` interface with the two commands exposed
 * by this extension under the `CORE_EXTENSIONS.CODE_BLOCK` namespace:
 *
 *   - `setCodeBlock(attributes?)`: converts the current block to a
 *     `codeBlock` node. Idempotent — no-op if already a `codeBlock`.
 *   - `toggleCodeBlock(attributes?)`: toggles between `codeBlock` and
 *     `paragraph`. Calls `commands.toggleNode(this.name,
 *     CORE_EXTENSIONS.PARAGRAPH, attributes)` under the hood.
 *
 * Both commands accept optional attributes (currently only `language`)
 * that are written to the resulting node's `language` attr.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CODE_BLOCK]: {
      /**
       * Set a code block
       */
      setCodeBlock: (attributes?: { language: string }) => ReturnType;
      /**
       * Toggle a code block
       */
      toggleCodeBlock: (attributes?: { language: string }) => ReturnType;
    };
  }
}

/**
 * Backtick fenced-code input rule pattern: ` ``` ` optionally followed by
 * a language identifier and terminated by whitespace or newline.
 *
 * Capture group 1: the language string (e.g., `typescript`, `python`).
 * Examples:
 *   - ` ``` ` (no language) → matches
 *   - ` ```typescript ` → matches, captures `"typescript"`
 *   - ` ``` js` (with space before js) → does NOT match (language must
 *     be directly adjacent to the closing backticks)
 *
 * Consumed by `addInputRules()` below via `textblockTypeInputRule`.
 */
export const backtickInputRegex = /^```([a-z]+)?[\s\n]$/;
/**
 * Tilde fenced-code input rule pattern: ` ~~~ ` optionally followed by
 * a language identifier. Alternative to {@link backtickInputRegex};
 * supports the less-common but valid CommonMark tilde-fenced
 * code-block syntax.
 *
 * Capture group 1: the language string. Consumed by `addInputRules()`
 * below via `textblockTypeInputRule`.
 */
export const tildeInputRegex = /^~~~([a-z]+)?[\s\n]$/;

/**
 * The base ProseMirror `codeBlock` node.
 *
 * Schema contract:
 *   - `name`: `CORE_EXTENSIONS.CODE_BLOCK` (= `"codeBlock"`)
 *   - `group`: `"block"`
 *   - `content`: `"text*"` — accepts only inline text nodes; no other
 *     blocks or inline marks may appear inside
 *   - `marks`: `""` — explicitly empty; marks are NOT permitted inside
 *     a code block (no bold, italic, link, etc. — code is treated as
 *     plain text). ProseMirror's default would allow all marks; the
 *     explicit empty string disallows them.
 *   - `code`: `true` — ProseMirror's schema-level flag denoting that
 *     this is a code-content block (affects paste handling, cursor
 *     behavior, and serialization)
 *   - `defining`: `true` — ProseMirror's flag preventing siblings of
 *     this node from being merged across its boundaries during paste
 *
 * Attributes:
 *   - `language`: parsed from the inner `<code>` element's class
 *     attribute via {@link CodeBlockOptions.languageClassPrefix}.
 *     `parseHTML` strips the prefix (e.g., `language-typescript` →
 *     `typescript`); the attribute is declared `rendered: false`, so
 *     the language is reapplied manually by `renderHTML` (on the
 *     inner `<code>` element's `class`) rather than auto-emitted on
 *     the outer `<pre>`.
 *
 * Parsing:
 *   - `parseHTML`: matches `<pre>` tags with `preserveWhitespace: "full"`
 *     so leading/trailing whitespace inside the code block is preserved
 *     on import — critical for whitespace-sensitive languages like
 *     Python, YAML, and Makefile.
 *
 * Rendering:
 *   - `renderHTML`: emits
 *     `<pre {...HTMLAttributes}><code class="language-{lang}">…</code></pre>`.
 *     The outer `<pre>`'s attributes are derived from
 *     `mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)`
 *     so per-instance overrides take precedence over option defaults.
 *
 * Commands (see the module augmentation above):
 *   - `setCodeBlock(attributes?)`: sets the current block to `codeBlock`
 *   - `toggleCodeBlock(attributes?)`: toggles between `codeBlock` and
 *     `paragraph`
 *
 * Input rules (Markdown-style fence triggers, see
 * {@link backtickInputRegex} and {@link tildeInputRegex}):
 *   - Triple backtick + optional language + space/newline → new code block
 *   - Triple tilde + optional language + space/newline → new code block
 *
 * Keyboard shortcuts:
 *   - `Mod-Alt-c`: toggle code block (Mod = Cmd on macOS, Ctrl elsewhere)
 *   - `Backspace` at the start / inside an empty code block: clear the
 *     node (lifts back to the default block, i.e. paragraph)
 *   - `Enter` three consecutive times on an empty last line: exit to a
 *     new paragraph (if `exitOnTripleEnter`)
 *   - `ArrowDown` at the very last position with no node after: exits
 *     the code via `exitCode()` (if `exitOnArrowDown`)
 *
 * ProseMirror plugin (`codeBlockVSCodeHandlerCustom`):
 *   - `handlePaste` covers two cases:
 *       a) Editor is currently inside an inline code mark
 *          (`CORE_EXTENSIONS.CODE_INLINE`) → replaces the current
 *          selection with the pasted plain text wrapped in
 *          `schema.marks.code`.
 *       b) Clipboard contains the `vscode-editor-data` JSON payload
 *          (set by VS Code on copy) → parses the payload's `mode`
 *          field as the code language and inserts the pasted text as
 *          a new code block pre-tagged with that language. Without
 *          this handler, a VS Code paste would arrive as a plain
 *          paragraph with no language tag.
 *     Paste while already inside a code block is left to ProseMirror's
 *     default behavior.
 */
export const CodeBlock = Node.create<CodeBlockOptions>({
  name: CORE_EXTENSIONS.CODE_BLOCK,

  /** Default options for the extension; overridden by `.configure({...})` in composed wrappers (`./index.tsx`). */
  addOptions() {
    return {
      languageClassPrefix: "language-",
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      HTMLAttributes: {},
    };
  },
  content: "text*",

  marks: "",

  group: "block",

  code: true,

  defining: true,

  /**
   * Declares the `language` attribute with HTML round-tripping logic.
   * `parseHTML` extracts the language token from the inner `<code>`
   * element's class (stripping `languageClassPrefix`). `rendered: false`
   * suppresses the default attribute emission so the language is
   * reapplied manually by `renderHTML` on the inner `<code>` element.
   */
  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element) => {
          const { languageClassPrefix } = this.options;
          const classNames = [...(element.firstElementChild?.classList || [])];
          const languages = classNames
            .filter((className) => className.startsWith(languageClassPrefix))
            .map((className) => className.replace(languageClassPrefix, ""));
          const language = languages[0];

          if (!language) {
            return null;
          }

          return language;
        },
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      [
        "code",
        {
          class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null,
        },
        0,
      ],
    ];
  },

  /** Exposes `setCodeBlock` and `toggleCodeBlock`. See module-level docs for command contract. */
  addCommands() {
    return {
      setCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, attributes),
      toggleCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, CORE_EXTENSIONS.PARAGRAPH, attributes),
    };
  },

  /**
   * Keyboard shortcuts and exit behaviors. Backspace-at-start (clears
   * the empty code block back to a paragraph), Enter triple-press exit
   * (if `exitOnTripleEnter`), and ArrowDown at end exit (if
   * `exitOnArrowDown`) are first-party additions not present in
   * upstream `@tiptap/extension-code-block`.
   */
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),

      // Backspace at start of (or inside an empty) code block clears the node back to a paragraph.
      Backspace: () => {
        try {
          const { empty, $anchor } = this.editor.state.selection;
          const isAtStart = $anchor.pos === 1;

          if (!empty || $anchor.parent.type.name !== this.name) {
            return false;
          }

          if (isAtStart || !$anchor.parent.textContent.length) {
            return this.editor.commands.clearNodes();
          }

          return false;
        } catch (error) {
          console.error("Error handling Backspace in code block:", error);
          return false;
        }
      },

      // Triple-Enter on an empty last line exits the code block (if exitOnTripleEnter).
      Enter: ({ editor }) => {
        try {
          if (!this.options.exitOnTripleEnter) {
            return false;
          }

          const { state } = editor;
          const { selection } = state;
          const { $from, empty } = selection;

          if (!empty || $from.parent.type !== this.type) {
            return false;
          }

          const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
          const endsWithDoubleNewline = $from.parent.textContent.endsWith("\n\n");

          if (!isAtEnd || !endsWithDoubleNewline) {
            return false;
          }

          return editor
            .chain()
            .command(({ tr }) => {
              tr.delete($from.pos - 2, $from.pos);

              return true;
            })
            .exitCode()
            .run();
        } catch (error) {
          console.error("Error handling Enter in code block:", error);
          return false;
        }
      },

      // ArrowDown at the very last position with no node after exits the code block (if exitOnArrowDown).
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
            return false;
          }

          return editor.commands.exitCode();
        } catch (error) {
          console.error("Error handling ArrowDown in code block:", error);
          return false;
        }
      },
    };
  },

  /** Backtick and tilde fenced-code input rules. See {@link backtickInputRegex} and {@link tildeInputRegex}. */
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: backtickInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1],
        }),
      }),
      textblockTypeInputRule({
        find: tildeInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1],
        }),
      }),
    ];
  },
  /**
   * VS Code clipboard paste handler (and inline-code paste handler).
   * When the editor is inside an inline `code` mark, replaces the
   * selection with the pasted plain text wrapped in `schema.marks.code`.
   * Otherwise, when the clipboard contains the `vscode-editor-data` JSON
   * payload (set by VS Code on copy), parses its `mode` field as the
   * code language and inserts the pasted text as a pre-tagged code
   * block. Without this plugin a paste from VS Code would arrive as a
   * plain paragraph with no language tag.
   */
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("codeBlockVSCodeHandlerCustom"),
        props: {
          handlePaste: (view, event) => {
            try {
              if (!event.clipboardData) {
                return false;
              }

              if (this.editor.isActive(this.type.name)) {
                return false;
              }

              if (this.editor.isActive(CORE_EXTENSIONS.CODE_INLINE)) {
                // Check if it's an inline code block
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");

                if (!text) {
                  console.error("Pasted text is empty.");
                  return false;
                }

                const { tr } = view.state;
                const { $from, $to } = tr.selection;

                if ($from.pos > $to.pos) {
                  console.error("Invalid selection range.");
                  return false;
                }

                const docSize = tr.doc.content.size;
                if ($from.pos < 0 || $to.pos > docSize) {
                  console.error("Selection range is out of document bounds.");
                  return false;
                }

                // Extend the current selection to replace it with the pasted text
                // wrapped in an inline code mark
                const codeMark = view.state.schema.marks.code.create();
                tr.replaceWith($from.pos, $to.pos, view.state.schema.text(text, [codeMark]));
                view.dispatch(tr);
                return true;
              }

              event.preventDefault();
              const text = event.clipboardData.getData("text/plain");
              const vscode = event.clipboardData.getData("vscode-editor-data");
              const vscodeData = vscode ? JSON.parse(vscode) : undefined;
              const language = vscodeData?.mode;

              if (vscodeData && language) {
                const { tr } = view.state;
                const { $from } = tr.selection;

                // Check if the current line is empty
                const isCurrentLineEmpty = !$from.parent.textContent.trim();

                let insertPos;

                if (isCurrentLineEmpty) {
                  // If the current line is empty, use the current position
                  insertPos = $from.pos - 1;
                } else {
                  // If the current line is not empty, insert below the current block node
                  insertPos = $from.end($from.depth) + 1;
                }

                // Ensure insertPos is within document bounds
                if (insertPos < 0 || insertPos > tr.doc.content.size) {
                  console.error("Invalid insert position.");
                  return false;
                }

                // Create a new code block node with the pasted content
                const textNode = view.state.schema.text(text.replace(/\r\n?/g, "\n"));
                const codeBlock = this.type.create({ language }, textNode);
                if (insertPos <= tr.doc.content.size) {
                  tr.insert(insertPos, codeBlock);
                  view.dispatch(tr);
                  return true;
                }

                return false;
              } else {
                // TODO: complicated paste logic, to be handled later
                return false;
              }
            } catch (error) {
              console.error("Error handling paste in CodeBlock extension:", error);
              return false;
            }
          },
        },
      }),
    ];
  },
});
