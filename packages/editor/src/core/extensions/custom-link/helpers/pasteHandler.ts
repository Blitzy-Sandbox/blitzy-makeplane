/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin factory for selection-aware paste-to-link inside `CustomLinkExtension`.
 *
 * This module is Plane's first-party replacement for `@tiptap/extension-link`'s built-in paste
 * handler. It is intentionally not the upstream implementation — kept under our control so the
 * link mark application can be tuned alongside the rest of `CustomLinkExtension` (autolink,
 * click-to-open, mark attributes) without forking the upstream package.
 *
 * Split into its own file so editor variants can compose paste-to-link independently from
 * autolink and click-to-open via the `linkOnPaste` boolean option in `CustomLinkExtension`
 * (see sibling `../extension.tsx` `addProseMirrorPlugins()`).
 */

import type { Editor } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { find } from "linkifyjs";

type PasteHandlerOptions = {
  editor: Editor;
  type: MarkType;
};

/**
 * Builds a ProseMirror plugin (key: `"handlePasteLink"`) that intercepts paste events via the
 * `handlePaste` prop and applies the link mark to the current text selection when the clipboard
 * payload is exactly one URL string.
 *
 * Concrete behavior: with the text "click here" selected, pasting `https://example.com` leaves
 * the visible text "click here" intact and only adds a link mark pointing to `https://example.com`
 * — the selection text is never replaced with the URL itself.
 *
 * Branch chain inside `handlePaste`:
 * 1. Empty selection → return `false` so ProseMirror's default paste runs and the sibling
 *    `markPasteRule` (registered in `../extension.tsx#addPasteRules`, near lines 204–234) detects
 *    URL substrings inside the just-inserted text.
 * 2. Selection present but pasted text is not exactly one complete URL (the equality check
 *    `item.value === textContent` fails) → return `false`; partial URLs, URLs embedded in
 *    surrounding text, and multi-line pastes intentionally do not relabel the selection.
 * 3. Selection present AND clipboard is exactly one URL → apply the link mark via
 *    `options.editor.commands.setMark(options.type, { href })` and return `true` to suppress
 *    ProseMirror's default paste handling.
 *
 * Pairs with `markPasteRule` in `../extension.tsx#addPasteRules`: this handler is the
 * selection-aware half (label an existing selection when pasting one URL); `markPasteRule` is
 * the substring-detection half (insert pasted text as-is and link any URL substrings when there
 * is no selection). Both must remain present for the full paste-to-link UX — lite-text editor
 * variants can disable only this half by passing `linkOnPaste: false` while keeping
 * `markPasteRule` active.
 *
 * @param options - Configuration for the plugin.
 * @param options.editor - The Tiptap `Editor` instance; passed in so the plugin can invoke
 *   `editor.commands.setMark` (an editor-level command) instead of dispatching a raw transaction.
 * @param options.type - The link `MarkType`, supplied as `this.type` by
 *   `CustomLinkExtension.addProseMirrorPlugins()` (resolves to the `"link"` mark per
 *   `packages/editor/src/core/constants/extension.ts`).
 * @returns A configured ProseMirror `Plugin` keyed `"handlePasteLink"`.
 */
export function pasteHandler(options: PasteHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey("handlePasteLink"),
    props: {
      handlePaste: (view, event, slice) => {
        const { state } = view;
        const { selection } = state;
        const { empty } = selection;

        if (empty) {
          return false;
        }

        let textContent = "";

        slice.content.forEach((node) => {
          textContent += node.textContent;
        });

        const link = find(textContent).find((item) => item.isLink && item.value === textContent);

        if (!textContent || !link) {
          return false;
        }

        options.editor.commands.setMark(options.type, {
          href: link.href,
        });

        return true;
      },
    },
  });
}
