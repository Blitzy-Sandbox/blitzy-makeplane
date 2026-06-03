/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime, React-aware variant of the callout TipTap extension.
 *
 * Layers three concerns on top of the schema-only `CustomCalloutExtensionConfig`
 * exported from `./extension-config`:
 * 1. The `insertCallout` command, which seeds new callout attributes from the
 *    user's last-used logo and background stored in `localStorage` so that
 *    stamping multiple callouts in a row does not force the user to re-pick.
 * 2. Keyboard shortcuts for Backspace boundary exit and Arrow-key paragraph
 *    escape, so the cursor is never trapped inside (or above/below) a callout.
 * 3. A React `NodeView` that mounts `CustomCalloutBlock`, so the in-editor
 *    rendering can host the interactive logo and background-color pickers.
 *
 * First-party origin: callout is a Plane-authored TipTap node — not a wrapper
 * around an upstream `@tiptap/extension-*` package — so the
 * "exposes / overrides / hides" triplet used elsewhere to describe TipTap
 * wrappers does not apply here.
 *
 * Consumer: `packages/editor/src/core/extensions/extensions.ts` registers this
 * extension in the editor's `CORE_EXTENSIONS.CALLOUT` slot. The schema-only
 * sibling `CustomCalloutExtensionConfig` is used by SSR and PDF-export pipelines
 * (see `core-without-props.ts`) because those contexts cannot evaluate React
 * `NodeView`s.
 */

import { findParentNodeClosestToPos, ReactNodeViewRenderer } from "@tiptap/react";
import type { Predicate } from "@tiptap/react";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
// local imports
import { CustomCalloutBlock } from "./block";
import type { CustomCalloutNodeViewProps } from "./block";
import { CustomCalloutExtensionConfig } from "./extension-config";
import type { CustomCalloutExtensionOptions, CustomCalloutExtensionStorage } from "./types";
import { getStoredBackgroundColor, getStoredLogo } from "./utils";

/**
 * Runtime callout extension produced by
 * `CustomCalloutExtensionConfig.extend<...>(...)`. Inherits the full node
 * schema (block group, `block+` content, parseHTML, renderHTML, and the
 * markdown serializer) from the config and layers on the interactive behavior
 * described below — no schema fields are changed.
 *
 * `selectable: true` and `draggable: true` mark the callout as a first-class
 * draggable block, mirroring the drag-handle plugin treatment of other
 * top-level blocks in the editor.
 *
 * Commands (`addCommands`):
 * - `insertCallout()` — inserts a fresh callout seeded with the user's
 *   last-used logo and background color, read from `localStorage` via
 *   `getStoredLogo()` and `getStoredBackgroundColor()`. The seeded content is
 *   a single empty `CORE_EXTENSIONS.PARAGRAPH` so the new block is immediately
 *   focusable and writable. Persisting the last choice across insertions
 *   removes the friction of re-picking when a user is stamping a series of
 *   callouts.
 *
 * Keyboard shortcuts (`addKeyboardShortcuts`):
 * - `Backspace` — when the cursor is empty and sits at the very first text
 *   position inside a non-trivial callout (content size > 2), the selection
 *   is moved one position before the callout. This preserves cursor-escape
 *   semantics without destroying the callout's existing inner content; an
 *   empty / nearly-empty callout falls through to TipTap's default Backspace
 *   so the user can still delete the block.
 * - `ArrowDown` / `ArrowUp` — delegate to
 *   `insertEmptyParagraphAtNodeBoundaries`, guaranteeing a reachable paragraph
 *   before and after a callout that sits at the top or bottom of the document
 *   (otherwise the caret would be trapped at a document boundary).
 * - The `catch` block around `findParentNodeClosestToPos` is defensive: it
 *   absorbs traversal errors observed during rapid keyboard input and falls
 *   back to TipTap's default Backspace by returning `false`.
 *
 * NodeView (`addNodeView`): mounts `CustomCalloutBlock` via
 * `ReactNodeViewRenderer` so the in-editor rendering can host the interactive
 * logo and background-color pickers, which cannot be expressed by the
 * schema-only variant used in SSR and PDF-export contexts.
 *
 * Side effects on insertion: reads `localStorage`. This is SSR-safe because
 * both `getStoredLogo` and `getStoredBackgroundColor` gate on
 * `typeof window !== "undefined"`.
 */
export const CustomCalloutExtension = CustomCalloutExtensionConfig.extend<
  CustomCalloutExtensionOptions,
  CustomCalloutExtensionStorage
>({
  selectable: true,
  draggable: true,

  addCommands() {
    return {
      insertCallout:
        () =>
        ({ commands }) => {
          // get stored logo values and background color from the local storage
          const storedLogoValues = getStoredLogo();
          const storedBackgroundValue = getStoredBackgroundColor();

          return commands.insertContent({
            type: this.name,
            content: [
              {
                type: CORE_EXTENSIONS.PARAGRAPH,
              },
            ],
            attrs: {
              ...storedLogoValues,
              "data-background": storedBackgroundValue,
            },
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        try {
          const isParentNodeCallout: Predicate = (node) => node.type === this.type;
          const parentNodeDetails = findParentNodeClosestToPos($from, isParentNodeCallout);
          // Check if selection is empty and at the beginning of the callout
          if (empty && parentNodeDetails) {
            const isCursorAtCalloutBeginning = $from.pos === parentNodeDetails.start + 1;
            if (parentNodeDetails.node.content.size > 2 && isCursorAtCalloutBeginning) {
              editor.commands.setTextSelection(parentNodeDetails.pos - 1);
              return true;
            }
          }
        } catch (error) {
          console.error("Error in performing backspace action on callout", error);
        }
        return false; // Allow the default behavior if conditions are not met
      },
      ArrowDown: insertEmptyParagraphAtNodeBoundaries("down", this.name),
      ArrowUp: insertEmptyParagraphAtNodeBoundaries("up", this.name),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => (
      <CustomCalloutBlock {...props} node={props.node as CustomCalloutNodeViewProps["node"]} />
    ));
  },
});
