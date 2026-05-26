/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom inline-code TipTap `Mark` for Plane editors, powering backtick code spans.
 *
 * Replaces `@tiptap/starter-kit`'s built-in inline `code` mark (disabled via `code: false` in
 * `starter-kit.ts`) so Plane can apply its own design-system styling and so the
 * `prosemirror-codemark` plugin composed in `utility.ts` can attach cursor ergonomics to the
 * same schema mark.
 *
 * The schema name (`CORE_EXTENSIONS.CODE_INLINE`) deliberately resolves to the literal `"code"`
 * so documents authored against upstream starter-kit's code mark continue to parse identically.
 */

import { Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

type InlineCodeOptions = {
  HTMLAttributes: Record<string, unknown>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CODE_INLINE]: {
      /**
       * Set a code mark
       */
      setCode: () => ReturnType;
      /**
       * Toggle inline code
       */
      toggleCode: () => ReturnType;
      /**
       * Unset a code mark
       */
      unsetCode: () => ReturnType;
    };
  }
}

export const inputRegex = /(?:^|\s)((?:`)((?:[^`]+))(?:`))$/;
const pasteRegex = /(?:^|\s)((?:`)((?:[^`]+))(?:`))/g;

/**
 * The custom inline-code TipTap `Mark` powering backtick code spans in Plane editors.
 *
 * Mark name: `CORE_EXTENSIONS.CODE_INLINE` — resolves to the string `"code"` so the schema name
 * matches upstream `@tiptap/starter-kit`, preserving cross-compatibility for documents authored
 * against the upstream code mark.
 *
 * Schema: inline mark with no attributes; declares `code: true` (clipboard/plugin semantics
 * treat the run as code) and `exitable: true` (cursor may leave the mark at a node boundary);
 * `excludes: "_"` prevents any other mark (bold, italic, color, …) from overlapping an inline
 * code span.
 *
 * Commands (registered by `addCommands`):
 * - `setCode()` — apply the `code` mark to the current selection.
 * - `toggleCode()` — toggle the `code` mark on the current selection.
 * - `unsetCode()` — remove the `code` mark from the current selection.
 *
 * Keyboard shortcut: `Mod-e` invokes `toggleCode()`, mirroring upstream starter-kit convention.
 *
 * Input rule: when the user types a backtick-wrapped fragment terminated by a closing backtick
 * (`inputRegex`), the wrapped text is converted to an inline code mark.
 *
 * Paste rule: every backtick-wrapped fragment in pasted text (`pasteRegex`, applied globally)
 * is converted to an inline code mark.
 *
 * Exposes (upstream surface preserved):
 * - Schema name `"code"` so documents containing upstream starter-kit code marks parse without
 *   migration.
 * - Standard inline mark commands (`setCode` / `toggleCode` / `unsetCode`) under the names
 *   upstream uses.
 * - `Mod-e` keyboard shortcut matching upstream convention.
 *
 * Overrides (upstream behavior replaced):
 * - Replaces `@tiptap/starter-kit`'s default `code` mark (disabled at
 *   `packages/editor/src/core/extensions/starter-kit.ts` via `code: false`) so Plane can:
 *   - Apply its own design-system class string on the rendered `<code>` tag.
 *   - Set `spellcheck="false"` by default on rendered code spans.
 *   - Integrate with the `prosemirror-codemark` plugin wired in `utility.ts`
 *     (`codemark({ markType: this.editor.schema.marks.code })`) for cursor ergonomics around
 *     code-span boundaries.
 *
 * Hides: none — the replacement re-exposes the same command surface, shortcut, and schema name
 * as upstream; the styling and `codemark` integration captured under Overrides are the only
 * intentional differences.
 *
 * Composition order: registered in `packages/editor/src/core/extensions/extensions.ts` after
 * `StarterKit` (which carries `code: false`) and before `UtilityExtension`, so the `code` mark
 * is present in the schema by the time `utility.ts`'s `codemark()` plugin reads
 * `schema.marks.code`.
 */
export const CustomCodeInlineExtension = Mark.create<InlineCodeOptions>({
  name: CORE_EXTENSIONS.CODE_INLINE,

  addOptions() {
    return {
      HTMLAttributes: {
        class:
          "rounded-sm bg-layer-3 px-[6px] py-[1.5px] font-code font-medium text-(--extended-color-orange-600) border-[0.5px] border-subtle",
        spellcheck: "false",
      },
    };
  },

  excludes: "_",

  code: true,

  exitable: true,

  parseHTML() {
    return [{ tag: "code" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["code", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCode:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleCode:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetCode:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-e": () => this.editor.commands.toggleCode(),
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: inputRegex,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegex,
        type: this.type,
      }),
    ];
  },
});
