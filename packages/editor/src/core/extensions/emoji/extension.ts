/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane emoji extension — public-facing entry point used by the editor bundle.
 *
 * Composes the project's base {@link Emoji} node (defined in `./emoji.ts`) with
 * the runtime configuration this codebase requires: markdown serialization that
 * prefers the unicode glyph over a shortcode, the curated GitHub emoji dataset
 * with `fallbackImage` stripped to avoid CDN calls, the React-rendered
 * `:`-prefixed suggestion popup ({@link emojiSuggestion}), and emoticon input
 * rules. Registered against {@link CORE_EXTENSIONS.EMOJI} when wired into an
 * editor's extensions array.
 */

// local imports
import { gitHubEmojis, shortcodeToEmoji } from "@tiptap/extension-emoji";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Emoji } from "./emoji";
import { emojiSuggestion } from "./suggestion";

/**
 * Configured emoji extension exported to the editor bundle.
 *
 * Built by calling `Emoji.extend(...).configure(...)` on the project's local
 * {@link Emoji} node so that markdown serialization, the dataset, the
 * suggestion configuration, and emoticon support are bound in one place.
 *
 * Exposes (from `@tiptap/extension-emoji`):
 *   - The curated `gitHubEmojis` dataset (after filtering out entries without a
 *     unicode glyph and stripping `fallbackImage` to avoid CDN image fetches).
 *   - The `shortcodeToEmoji` lookup used to resolve `:name:` tokens at
 *     markdown-serialize time.
 *
 * Overrides (vs. `@tiptap/extension-emoji`'s upstream `Emoji` node):
 *   - Replaces the upstream node class entirely with `./emoji.ts`'s
 *     `Node.create(...)` definition so the schema, commands (`setEmoji`),
 *     input rules, paste rules, double-click selection plugin, and document
 *     normalization plugin are all owned in-tree.
 *   - Adds an `addStorage` `markdown.serialize` hook that emits the unicode
 *     glyph when resolvable and falls back to `:shortcode:` plain text
 *     otherwise — required by the ProseMirror-Markdown round trip used by
 *     `@plane/editor`.
 *
 * Hides (intentionally not exposed):
 *   - The `fallbackImage` field on each emoji item is dropped during
 *     `.configure({ emojis: ... })`, so no Twemoji/GitHub CDN `<img>` fallback
 *     is ever rendered — emoji are unicode-only inline glyphs.
 *   - Upstream's default suggestion UI; this extension binds the project's
 *     React dropdown via {@link emojiSuggestion} instead.
 *
 * Registered against {@link CORE_EXTENSIONS.EMOJI}.
 */
export const EmojiExtension = Emoji.extend({
  addStorage() {
    const extensionOptions = this.options;

    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const emojiItem = shortcodeToEmoji(node.attrs.name, extensionOptions.emojis);
          if (emojiItem?.emoji) {
            state.write(emojiItem?.emoji);
          } else {
            state.write(`:${node.attrs.name}:`);
          }
        },
      },
    };
  },
}).configure({
  // Filter out emojis without emoji value and remove fallbackImage property to prevent CDN calls

  emojis: gitHubEmojis.filter((item) => item.emoji).map(({ fallbackImage, ...emoji }) => emoji),
  suggestion: emojiSuggestion,
  enableEmoticons: true,
});
