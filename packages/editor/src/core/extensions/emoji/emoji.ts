/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane's core emoji Node extension for Tiptap/ProseMirror.
 *
 * Defines the inline `emoji` node from scratch via `@tiptap/core`'s
 * `Node.create<EmojiOptions, EmojiStorage>(...)`. The upstream
 * `@tiptap/extension-emoji` package is used as a data source (the emoji
 * dataset and shortcode↔unicode helpers) but its Node class is not used —
 * Plane reimplements the node so it can own the schema, attributes,
 * commands, input rules, paste rules, suggestion wiring, and the
 * normalization plugin that converts pasted/typed unicode emoji back into
 * structured emoji nodes. `./extension.ts` then `.extend(...).configure(...)`s
 * this Node into the form the editor bundle registers.
 */

import {
  combineTransactionSteps,
  escapeForRegEx,
  findChildrenInRange,
  getChangedRanges,
  InputRule,
  mergeAttributes,
  Node,
  nodeInputRule,
  PasteRule,
  removeDuplicates,
} from "@tiptap/core";
import type { EmojiStorage } from "@tiptap/extension-emoji";
import { emojis, emojiToShortcode, shortcodeToEmoji } from "@tiptap/extension-emoji";
import { Fragment } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";
import emojiRegex from "emoji-regex";
import { isEmojiSupported } from "is-emoji-supported";
// helpers
import { customFindSuggestionMatch } from "@/helpers/find-suggestion-match";

// Extended storage type to include our custom forceOpen flag
/**
 * Extends Tiptap's `EmojiStorage` with a `forceOpen` flag that lets external
 * callers (e.g., a toolbar button) open the suggestion popup with no query.
 * Read in `./suggestion.ts` and reset to `false` whenever the popup closes.
 */
export interface ExtendedEmojiStorage extends EmojiStorage {
  forceOpen: boolean;
}

/**
 * Locally re-declared shape of a single emoji record (mirrors the upstream
 * `@tiptap/extension-emoji` `EmojiItem`). The trailing index signature
 * `[key: string]: unknown` allows downstream consumers to attach extra
 * metadata without widening the upstream type.
 */
export type EmojiItem = {
  /**
   * A unique name of the emoji which will be stored as attribute
   */
  name: string;
  /**
   * The emoji unicode character
   */
  emoji?: string;
  /**
   * A list of unique shortcodes that are used by input rules to find the emoji
   */
  shortcodes: string[];
  /**
   * A list of tags that can help for searching emojis
   */
  tags: string[];
  /**
   * A name that can help to group emojis
   */
  group?: string;
  /**
   * A list of unique emoticons
   */
  emoticons?: string[];
  /**
   * The unicode version the emoji was introduced
   */
  version?: number;
  /**
   * A fallback image if the current system doesn't support the emoji or for custom emojis
   */
  fallbackImage?: string;
  /**
   * Store some custom data
   */
  [key: string]: unknown;
};

/**
 * Configuration options for the emoji Node — passed via `.configure(...)` in
 * `./extension.ts`. `emojis` is the curated dataset, `enableEmoticons` toggles
 * the `:)` → `🙂` input rule, `forceFallbackImages` is wired but unused
 * (the renderer hardcodes unicode-only output), and `suggestion` is the
 * Tiptap `SuggestionOptions` (minus `editor`) consumed by `addProseMirrorPlugins`.
 */
export type EmojiOptions = {
  HTMLAttributes: Record<string, unknown>;
  emojis: EmojiItem[];
  enableEmoticons: boolean;
  forceFallbackImages: boolean;
  suggestion: Omit<SuggestionOptions, "editor">;
};

/**
 * ProseMirror plugin key for the emoji suggestion plugin — exposed so that
 * other plugins or commands can read suggestion state via
 * `EmojiSuggestionPluginKey.getState(editorState)`.
 */
export const EmojiSuggestionPluginKey = new PluginKey("emojiSuggestion");

/**
 * Input rule pattern: matches `:shortcode:` at the caret position. Capture
 * group 1 is the shortcode (alphanumerics, `_`, `+`, `-`), looked up against
 * the configured emoji dataset before insertion.
 */
export const inputRegex = /:([a-zA-Z0-9_+-]+):$/;

/**
 * Paste rule pattern: global variant of {@link inputRegex} used by
 * `addPasteRules` to convert every `:shortcode:` in pasted text into an
 * emoji node when the shortcode resolves against the configured dataset.
 */
export const pasteRegex = /:([a-zA-Z0-9_+-]+):/g;

/**
 * Inline emoji node — Plane's reimplementation of an emoji Tiptap extension.
 *
 * Schema:
 *   - `name: "emoji"`, inline, group `inline`, `selectable: false`.
 *   - Single attribute `name` round-tripped to/from `data-name` on a
 *     `<span data-type="emoji">`.
 *
 * Options (see {@link EmojiOptions}):
 *   - Suggestion trigger `:` with plugin key {@link EmojiSuggestionPluginKey}.
 *   - `command`: inserts the emoji node plus a trailing space and carries
 *     forward stored marks; absorbs the next space character if one is
 *     already present (so users don't get a double space).
 *   - `allow`: rejects insertion when the parent node's content match cannot
 *     accept an `emoji` node — keeps the schema valid.
 *
 * Storage: includes Tiptap's `emojis` and `isSupported`, plus a `forceOpen`
 * flag (see {@link ExtendedEmojiStorage}) initialized to `false`. The
 * `supportMap` is precomputed once per Unicode version using
 * `is-emoji-supported`, so `isSupported(item)` is O(1).
 *
 * Rendering: HTML and text both emit the resolved unicode glyph (or the
 * `:shortcode:` literal fallback when the name cannot be resolved against the
 * configured dataset). `renderFallbackImage` is hardcoded `false` — no `<img>`
 * fallback is rendered, and `forceFallbackImages` option is intentionally
 * inert.
 *
 * Commands: `setEmoji(shortcode)` inserts the node when the shortcode
 * resolves, and carries forward stored marks from the new selection's left
 * edge.
 *
 * Input rules:
 *   - `:shortcode:` (see {@link inputRegex}) inserts an emoji node when the
 *     shortcode resolves.
 *   - When `enableEmoticons` is set, a dataset-built regex converts
 *     emoticon sequences (e.g., `:)`) into the corresponding emoji node after
 *     the user types a space.
 *
 * Paste rules: `:shortcode:` (see {@link pasteRegex}) globally; the rule sets
 * `updateSelection: false` so the cursor stays in place after a multi-emoji
 * paste.
 *
 * ProseMirror plugins:
 *   - Skipped on touch devices (`utility.isTouchDevice`) — touch UX is owned
 *     elsewhere.
 *   - `Suggestion` plugin wired with `customFindSuggestionMatch` and the
 *     merged `addOptions().suggestion` config.
 *   - `handleDoubleClickOn` plugin that selects the inline emoji on
 *     double-click — default ProseMirror behavior does not select
 *     non-selectable inline nodes.
 *   - `appendTransaction` plugin that scans changed ranges, converts any
 *     pasted/typed Unicode emoji (via `emoji-regex`) into emoji nodes, skips
 *     code-block contexts (checked twice — at the changed range's parent and
 *     at each individual insertion point — to handle whole-doc replacement
 *     paths), and preserves stored marks across the replacement.
 */
export const Emoji = Node.create<EmojiOptions, EmojiStorage>({
  name: "emoji",

  inline: true,

  group: "inline",

  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      // emojis: ,
      emojis: emojis,
      enableEmoticons: false,
      forceFallbackImages: false,
      suggestion: {
        char: ":",
        pluginKey: EmojiSuggestionPluginKey,
        command: ({ editor, range, props }) => {
          // increase range.to by one when the next node is of type "text"
          // and starts with a space character
          const nodeAfter = editor.view.state.selection.$to.nodeAfter;
          const overrideSpace = nodeAfter?.text?.startsWith(" ");

          if (overrideSpace) {
            range.to += 1;
          }

          editor
            .chain()
            .focus()
            .command(({ tr, state, dispatch }) => {
              if (!dispatch) return true;

              const { schema } = state;
              const emojiNode = schema.nodes[this.name].create(props);
              const spaceNode = schema.text(" ");

              const fragment = Fragment.from([emojiNode, spaceNode]);

              tr.replaceWith(range.from, range.to, fragment);

              const newPos = range.from + fragment.size;
              tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));

              tr.setStoredMarks(tr.doc.resolve(range.from).marks());

              return true;
            })
            .run();
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[this.name];
          const allow = !!$from.parent.type.contentMatch.matchType(type);

          return allow;
        },
      },
    };
  },

  addStorage() {
    const { emojis } = this.options;
    const supportMap: Record<number, boolean> = removeDuplicates(emojis.map((item) => item.version))
      .filter((version) => typeof version === "number")
      .reduce((versions, version) => {
        const emoji = emojis.find((item) => item.version === version && item.emoji);

        return {
          ...versions,
          [version]: emoji ? isEmojiSupported(emoji.emoji as string) : false,
        };
      }, {});

    return {
      emojis: this.options.emojis,
      isSupported: (emojiItem) => (emojiItem.version ? supportMap[emojiItem.version] : false),
      forceOpen: false,
    };
  },

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => element.dataset.name,
        renderHTML: (attributes) => ({
          "data-name": attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const emojiItem = shortcodeToEmoji(node.attrs.name, this.options.emojis);
    const attributes = mergeAttributes(HTMLAttributes, this.options.HTMLAttributes, { "data-type": this.name });

    if (!emojiItem) {
      return ["span", attributes, `:${node.attrs.name}:`];
    }

    const renderFallbackImage = false;

    return [
      "span",
      attributes,
      renderFallbackImage
        ? [
            "img",
            {
              src: emojiItem.fallbackImage,
              draggable: "false",
              loading: "lazy",
              align: "absmiddle",
            },
          ]
        : emojiItem.emoji || `:${emojiItem.shortcodes[0]}:`,
    ];
  },

  renderText({ node }) {
    const emojiItem = shortcodeToEmoji(node.attrs.name, this.options.emojis);

    return emojiItem?.emoji || `:${node.attrs.name}:`;
  },

  addCommands() {
    return {
      setEmoji:
        (shortcode) =>
        ({ chain }) => {
          const emojiItem = shortcodeToEmoji(shortcode, this.options.emojis);

          if (!emojiItem) {
            return false;
          }

          chain()
            .insertContent({
              type: this.name,
              attrs: {
                name: emojiItem.name,
              },
            })
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 1).marks());
              return true;
            })
            .run();

          return true;
        },
    };
  },

  addInputRules() {
    const inputRules: InputRule[] = [];

    inputRules.push(
      new InputRule({
        find: inputRegex,
        handler: ({ range, match, chain }) => {
          const name = match[1];

          if (!shortcodeToEmoji(name, this.options.emojis)) {
            return;
          }

          chain()
            .insertContentAt(range, {
              type: this.name,
              attrs: {
                name,
              },
            })
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 1).marks());
              return true;
            })
            .run();
        },
      })
    );

    if (this.options.enableEmoticons) {
      // get the list of supported emoticons
      const emoticons = this.options.emojis
        .map((item) => item.emoticons)
        .flat()
        .filter((item) => item) as string[];

      const emoticonRegex = new RegExp(`(?:^|\\s)(${emoticons.map((item) => escapeForRegEx(item)).join("|")}) $`);

      inputRules.push(
        nodeInputRule({
          find: emoticonRegex,
          type: this.type,
          getAttributes: (match) => {
            const emoji = this.options.emojis.find((item) => item.emoticons?.includes(match[1]));

            if (!emoji) {
              return;
            }

            return {
              name: emoji.name,
            };
          },
        })
      );
    }

    return inputRules;
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: pasteRegex,
        handler: ({ range, match, chain }) => {
          const name = match[1];

          if (!shortcodeToEmoji(name, this.options.emojis)) {
            return;
          }

          chain()
            .insertContentAt(
              range,
              {
                type: this.name,
                attrs: {
                  name,
                },
              },
              {
                updateSelection: false,
              }
            )
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 1).marks());
              return true;
            })
            .run();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const isTouchDevice = !!this.editor.storage.utility.isTouchDevice;
    if (isTouchDevice) {
      return [];
    }
    return [
      Suggestion({
        editor: this.editor,
        findSuggestionMatch: customFindSuggestionMatch,
        ...this.options.suggestion,
      }),

      new Plugin({
        key: new PluginKey("emoji"),
        props: {
          // double click to select emoji doesn’t work by default
          // that’s why we simulate this behavior
          handleDoubleClickOn: (view, pos, node) => {
            if (node.type !== this.type) {
              return false;
            }

            const from = pos;
            const to = from + node.nodeSize;

            this.editor.commands.setTextSelection({
              from,
              to,
            });

            return true;
          },
        },

        // replace text emojis with emoji node on any change
        appendTransaction: (transactions, oldState, newState) => {
          const docChanges =
            transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);

          if (!docChanges) {
            return;
          }

          const { tr } = newState;
          const transform = combineTransactionSteps(oldState.doc, transactions as Transaction[]);
          const changes = getChangedRanges(transform);

          changes.forEach(({ newRange }) => {
            // We don’t want to add emoji inline nodes within code blocks.
            // Because this would split the code block.

            // This only works if the range of changes is within a code node.
            // For all other cases (e.g. the whole document is set/pasted and the parent of the range is `doc`)
            // it doesn't and we have to double check later.
            if (newState.doc.resolve(newRange.from).parent.type.spec.code) {
              return;
            }

            const textNodes = findChildrenInRange(newState.doc, newRange, (node) => node.type.isText);

            textNodes.forEach(({ node, pos }) => {
              if (!node.text) {
                return;
              }

              const matches = [...node.text.matchAll(emojiRegex())];

              matches.forEach((match) => {
                if (match.index === undefined) {
                  return;
                }

                const emoji = match[0];
                const name = emojiToShortcode(emoji, this.options.emojis);

                if (!name) {
                  return;
                }

                const from = tr.mapping.map(pos + match.index);

                // Double check parent node is not a code block.
                if (newState.doc.resolve(from).parent.type.spec.code) {
                  return;
                }

                const to = from + emoji.length;
                const emojiNode = this.type.create({
                  name,
                });

                tr.replaceRangeWith(from, to, emojiNode);

                tr.setStoredMarks(newState.doc.resolve(from).marks());
              });
            });
          });

          if (!tr.steps.length) {
            return;
          }

          return tr;
        },
      }),
    ];
  },
});
