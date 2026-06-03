/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin factory that detects URLs as the user types and applies
 * the link mark to detected URL substrings.
 *
 * This is Plane's first-party replacement for `@tiptap/extension-link`'s
 * built-in autolink behavior — it is intentionally NOT the upstream
 * implementation. Owning the plugin lets us tune the URL boundary heuristic,
 * the code-mark exclusion, and the recursion-guard contract for our own
 * editor surfaces.
 *
 * The autolink logic lives in its own file so editor variants (e.g. the
 * lite-text comment-input editor) can compose it independently of click and
 * paste handling via the `autolink` boolean option on `CustomLinkExtension`
 * (see sibling `../extension.tsx`'s `addProseMirrorPlugins()`).
 */

import type { NodeWithPos } from "@tiptap/core";
import { combineTransactionSteps, findChildrenInRange, getChangedRanges, getMarksBetween } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { find } from "linkifyjs";

type AutolinkOptions = {
  type: MarkType;
  validate?: (url: string) => boolean;
};

/**
 * Build the autolink ProseMirror plugin.
 *
 * Runs on the `appendTransaction` hook after each batch of dispatched
 * transactions that actually changed the document (the plugin bails when
 * `oldState.doc.eq(newState.doc)`), so it is a no-op for selection-only
 * transactions.
 *
 * Work is bounded to the changed ranges via `combineTransactionSteps` +
 * `getChangedRanges` rather than scanning the whole document — this keeps
 * the plugin cheap on large documents.
 *
 * Recursion guard: if any transaction in the batch carries
 * `tr.setMeta("preventAutolink", true)`, the plugin returns early. That meta
 * is stamped by `setLink` / `toggleLink` / `unsetLink` in `../extension.tsx`,
 * preventing the link commands' own mark mutations from re-entering this
 * scan and stacking marks recursively.
 *
 * Boundary heuristic: the helper extracts the last non-empty word BEFORE
 * trailing whitespace in the affected text block. Typing
 * `https://example.com ` (note the trailing space) triggers autolink; typing
 * `https://example.com` without a trailing space does NOT — this avoids
 * autolinking partially-typed URLs while the user is still typing the host.
 *
 * Per-candidate filter chain:
 *  1. `link.isLink` — `linkifyjs.find` also returns mentions and emails;
 *     only `isLink` entries are accepted.
 *  2. Linkify offsets are translated to absolute ProseMirror positions
 *     (`from = lastWordAndBlockOffset + link.start + 1`); the `+1` reflects
 *     ProseMirror's 1-indexed position model relative to text content.
 *  3. Ranges that overlap the `code` mark are skipped via
 *     `newState.doc.rangeHasMark(from, to, schema.marks.code)` — code spans
 *     hold URLs as literal text (e.g. docs about a URL) and must not autolink.
 *  4. The caller-supplied `options.validate(url)` runs last; the default
 *     injected by `CustomLinkExtension` is
 *     `(url) => isValidHttpUrl(url).isValid`, so non-HTTP(S) URLs are rejected.
 *  5. Ranges already covered by an existing link mark
 *     (`getMarksBetween` check) are skipped so duplicate marks are not stacked.
 *
 * Return contract: returns the mutated transaction (`tr`) only when at least
 * one mark was added (`tr.steps.length > 0`); returns `undefined` for no-op
 * batches, which is the ProseMirror convention for "no append needed" and
 * lets ProseMirror skip dispatch overhead.
 *
 * @param options - Autolink configuration.
 * @param options.type - The link `MarkType`. `CustomLinkExtension.addProseMirrorPlugins()`
 *   passes `this.type`, which resolves to the `"link"` mark per
 *   `packages/editor/src/core/constants/extension.ts`.
 * @param options.validate - Optional URL validator. `CustomLinkExtension`
 *   injects `(url) => isValidHttpUrl(url).isValid` by default.
 * @returns A configured ProseMirror Plugin with key `"autolink"`.
 */
export function autolink(options: AutolinkOptions): Plugin {
  return new Plugin({
    key: new PluginKey("autolink"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanges = transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);
      const preventAutolink = transactions.some((transaction) => transaction.getMeta("preventAutolink"));

      if (!docChanges || preventAutolink) {
        return;
      }

      const { tr } = newState;
      const transform = combineTransactionSteps(oldState.doc, [...transactions]);
      const changes = getChangedRanges(transform);

      changes.forEach(({ newRange }) => {
        // Now let’s see if we can add new links.
        const nodesInChangedRanges = findChildrenInRange(newState.doc, newRange, (node) => node.isTextblock);

        let textBlock: NodeWithPos | undefined;
        let textBeforeWhitespace: string | undefined;

        if (nodesInChangedRanges.length > 1) {
          // Grab the first node within the changed ranges (ex. the first of two paragraphs when hitting enter).
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            textBlock.pos + textBlock.node.nodeSize,
            undefined,
            " "
          );
        } else if (
          nodesInChangedRanges.length &&
          // We want to make sure to include the block separator argument to treat hard breaks like spaces.
          newState.doc.textBetween(newRange.from, newRange.to, " ", " ").endsWith(" ")
        ) {
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(textBlock.pos, newRange.to, undefined, " ");
        }

        if (textBlock && textBeforeWhitespace) {
          const wordsBeforeWhitespace = textBeforeWhitespace.split(" ").filter((s) => s !== "");

          if (wordsBeforeWhitespace.length <= 0) {
            return false;
          }

          const lastWordBeforeSpace = wordsBeforeWhitespace[wordsBeforeWhitespace.length - 1];
          const lastWordAndBlockOffset = textBlock.pos + textBeforeWhitespace.lastIndexOf(lastWordBeforeSpace);

          if (!lastWordBeforeSpace) {
            return false;
          }

          find(lastWordBeforeSpace)
            .filter((link) => link.isLink)
            // Calculate link position.
            .map((link) => ({
              ...link,
              from: lastWordAndBlockOffset + link.start + 1,
              to: lastWordAndBlockOffset + link.end + 1,
            }))
            // ignore link inside code mark
            .filter((link) => {
              if (!newState.schema.marks.code) {
                return true;
              }

              return !newState.doc.rangeHasMark(link.from, link.to, newState.schema.marks.code);
            })
            // validate link
            .filter((link) => {
              if (options.validate) {
                return options.validate(link.value);
              }
              return true;
            })
            // Add link mark.
            .forEach((link) => {
              if (getMarksBetween(link.from, link.to, newState.doc).some((item) => item.mark.type === options.type)) {
                return;
              }

              tr.addMark(
                link.from,
                link.to,
                options.type.create({
                  href: link.href,
                })
              );
            });
        }
      });

      if (!tr.steps.length) {
        return;
      }

      return tr;
    },
  });
}
