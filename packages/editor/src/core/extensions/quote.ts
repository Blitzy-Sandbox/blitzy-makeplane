/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Blockquote extension with custom Enter-key handling.
 *
 * Pressing Enter on an empty line inside a blockquote lifts the cursor out
 * of the blockquote rather than creating a nested paragraph.
 */

import Blockquote from "@tiptap/extension-blockquote";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Plane editor blockquote extension.
 *
 * Exposes:
 *   - Upstream `@tiptap/extension-blockquote` node schema (a `<blockquote>`
 *     block element wrapping inline content), commands (`setBlockquote`,
 *     `toggleBlockquote`, `unsetBlockquote`), and the `> ` input rule that
 *     converts a `> ` prefix at line start into a blockquote.
 *
 * Overrides:
 *   - `Enter` keyboard shortcut: on a collapsed selection inside a
 *     blockquote, splits the block and lifts the cursor out of the
 *     blockquote into a new paragraph (instead of creating a nested
 *     paragraph inside the blockquote). The override checks the cursor's
 *     grandparent (`$head.node(-1)`); if it is a blockquote node and the
 *     selection is collapsed (`$from.pos === $to.pos`), it runs
 *     `splitBlock().lift(this.name)` — `this.name` resolves to
 *     `CORE_EXTENSIONS.BLOCKQUOTE` because TipTap's `Node.extend` preserves
 *     the parent's node name unless explicitly overridden.
 *
 * Hides:
 *   - The upstream "Enter creates nested paragraph inside the blockquote"
 *     behavior is no longer reachable from a collapsed cursor position.
 *
 * WHY: pressing Enter inside a blockquote is the user's signal "I'm done
 * quoting"; the override removes the need to press Enter twice and then
 * manually lift. The try/catch guards against `$head.node(-1)` throwing at
 * the document boundary by returning `false` so the default Enter handler
 * runs.
 */
export const CustomQuoteExtension = Blockquote.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        try {
          const { $from, $to, $head } = this.editor.state.selection;
          const parent = $head.node(-1);

          if (!parent) return false;

          if (parent.type.name !== CORE_EXTENSIONS.BLOCKQUOTE) {
            return false;
          }
          if ($from.pos !== $to.pos) return false;
          // if ($head.parentOffset < $head.parent.content.size) return false;

          // this.editor.commands.insertContentAt(parent.ne);
          this.editor.chain().splitBlock().lift(this.name).run();

          return true;
        } catch (error) {
          console.error("Error handling Enter in blockquote:", error);
          return false;
        }
      },
    };
  },
});
