/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom horizontal-rule node for the Plane editor.
 *
 * Defines a ProseMirror block node rendered as
 * `<div data-type="horizontalRule"><div /></div>` with a styled inner
 * element, plus a `setHorizontalRule` command and markdown input rules
 * for the `---`, `—-`, `___ `, and `*** ` shortcuts.
 *
 * First-party note: this module does NOT depend on
 * `@tiptap/extension-horizontal-rule`. The node is defined from scratch
 * via `@tiptap/core`'s `Node.create<>()` so the rendered DOM can be a
 * styled `<div>` matching the design-system spacing, rather than the
 * bare upstream `<hr>` tag — and so `parseHTML` can accept both
 * representations for legacy / pasted content round-tripping. See the
 * JSDoc directly above `CustomHorizontalRule` for the full
 * cursor-placement, schema, and input-rule semantics.
 */

import { isNodeSelection, mergeAttributes, Node, nodeInputRule } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

type HorizontalRuleOptions = {
  HTMLAttributes: Record<string, unknown>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.HORIZONTAL_RULE]: {
      /**
       * Add a horizontal rule
       */
      setHorizontalRule: () => ReturnType;
    };
  }
}

/**
 * Custom ProseMirror horizontal-rule `Node` for the Plane editor.
 *
 * First-party code (not a wrapper): Plane intentionally does NOT extend
 * `@tiptap/extension-horizontal-rule`. Owning the node definition lets
 * the rendered DOM be a styled
 * `<div data-type="horizontalRule"><div /></div>` carrying design-system
 * spacing (default class `"py-4 border-strong-1"`), rather than the bare
 * `<hr>` element the upstream extension produces.
 *
 * Schema:
 *   - `name`: `CORE_EXTENSIONS.HORIZONTAL_RULE` (`"horizontalRule"`)
 *   - `group`: `"block"`
 *   - No inline content (atom-like block).
 *
 * `parseHTML` accepts both `<div data-type="horizontalRule">` (the
 * wrapper-rendered form) AND the standard `<hr>` tag so legacy stored
 * HTML and content pasted from external sources round-trip into the
 * editor as horizontal-rule nodes. `renderHTML` always emits the
 * `<div data-type="horizontalRule"><div /></div>` form with options
 * `HTMLAttributes` merged onto the outer element.
 *
 * `setHorizontalRule` command — cursor-placement WHY:
 *   - When the cursor sits at offset `0` of its parent block, the
 *     position-range from `originFrom.pos - 1` to `originTo.pos` is
 *     replaced by the HR. This collapses an empty leading paragraph
 *     into the HR so typing `---` at the start of an empty line does
 *     not leave a stray empty paragraph above the rule.
 *   - On a node selection, the HR is inserted at `originTo.pos` so it
 *     lands immediately after the selected node.
 *   - Otherwise the default `insertContent` runs, splitting the current
 *     block and inserting the HR at the caret.
 *   - After insertion, a chained command repositions the selection so
 *     the user can keep typing: caret moves into the next textblock if
 *     one exists, the next block node is selected as a `NodeSelection`
 *     if it is non-textblock, or a freshly-created default block is
 *     inserted at end-of-document and the caret placed inside it.
 *     Without this step the selection would be left on the HR itself,
 *     which is not a usable typing target.
 *
 * Input rule: a single `nodeInputRule` matches
 * `^(?:---|—-|___\s|\*\*\*\s)$`, covering CommonMark's three HR
 * conventions (`---`, `___`, `***`) plus `—-` to handle keyboard
 * auto-correct that converts `--` to an em-dash before the user
 * completes the third character.
 */
export const CustomHorizontalRule = Node.create<HorizontalRuleOptions>({
  name: CORE_EXTENSIONS.HORIZONTAL_RULE,
  group: "block",

  addOptions() {
    return {
      HTMLAttributes: {
        class: "py-4 border-strong-1",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
      },
      { tag: "hr" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name,
      }),
      ["div", {}],
    ];
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ chain, state }) => {
          const { selection } = state;
          const { $from: $originFrom, $to: $originTo } = selection;

          const currentChain = chain();

          if ($originFrom.parentOffset === 0) {
            currentChain.insertContentAt(
              {
                from: Math.max($originFrom.pos - 1, 0),
                to: $originTo.pos,
              },
              {
                type: this.name,
              }
            );
          } else if (isNodeSelection(selection)) {
            currentChain.insertContentAt($originTo.pos, {
              type: this.name,
            });
          } else {
            currentChain.insertContent({ type: this.name });
          }

          return (
            currentChain
              // set cursor after horizontal rule
              .command(({ tr, dispatch }) => {
                if (dispatch) {
                  const { $to } = tr.selection;
                  const posAfter = $to.end();

                  if ($to.nodeAfter) {
                    if ($to.nodeAfter.isTextblock) {
                      tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
                    } else if ($to.nodeAfter.isBlock) {
                      tr.setSelection(NodeSelection.create(tr.doc, $to.pos));
                    } else {
                      tr.setSelection(TextSelection.create(tr.doc, $to.pos));
                    }
                  } else {
                    // add node after horizontal rule if it’s the end of the document
                    const node = $to.parent.type.contentMatch.defaultType?.create();

                    if (node) {
                      tr.insert(posAfter, node);
                      tr.setSelection(TextSelection.create(tr.doc, posAfter + 1));
                    }
                  }

                  tr.scrollIntoView();
                }

                return true;
              })
              .run()
          );
        },
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        type: this.type,
      }),
    ];
  },
});
