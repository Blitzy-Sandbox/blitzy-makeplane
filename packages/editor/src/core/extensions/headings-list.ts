/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Headings-list extension: maintains a live inventory of every heading in
 * the editor document.
 *
 * On every transaction, walks `newState.doc`, collects each heading's
 * level, text, and per-level sequence number, and writes the resulting
 * `IMarking[]` to `editor.storage[CORE_EXTENSIONS.HEADINGS_LIST].headings`.
 * The storage is surfaced to downstream UI via `EditorRefApi.getHeadings()`
 * and `onHeadingChange()` (see `core/helpers/editor-ref.ts`), which the
 * page-summary / table-of-contents components read to render an outline.
 *
 * This is a from-scratch TipTap `Extension` (not a wrapper around an
 * upstream extension); it has no exposed/overridden/hidden upstream
 * behavior surface.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import type { IMarking } from "@/types";

/**
 * Storage slot maintained by `HeadingListExtension` on
 * `editor.storage[CORE_EXTENSIONS.HEADINGS_LIST]`.
 *
 * Holds the current document's heading inventory as an `IMarking[]`,
 * recomputed on every transaction.
 */
export type HeadingExtensionStorage = {
  headings: IMarking[];
};

declare module "@tiptap/core" {
  interface Storage {
    [CORE_EXTENSIONS.HEADINGS_LIST]: HeadingExtensionStorage;
  }
}

/**
 * Maintains a live, transaction-driven inventory of document headings for
 * the table-of-contents UI.
 *
 * State write:
 *   Registers a ProseMirror plugin whose `appendTransaction` descends
 *   `newState.doc`, identifies nodes with `type.name === "heading"`,
 *   reads `node.attrs.level` + `node.textContent`, and assembles an
 *   `IMarking[]` of `{ type, level, text, sequence }`. The array is then
 *   assigned to `this.storage.headings`, replacing the previous value.
 *   Depends on the schema providing a `heading` node with a numeric
 *   `level` attribute (supplied by `@tiptap/starter-kit`'s heading).
 *
 * Per-level sequence numbering:
 *   H1, H2, H3 each maintain an independent counter so the outline UI can
 *   render hierarchical numbering (H1 → H1.1 → H1.1.1) rather than a
 *   single global sequence. Headings deeper than level 3 are deliberately
 *   folded into the H3 counter because the outline UI only renders three
 *   levels.
 *
 * Side effect:
 *   After writing storage, calls `this.editor.emit("update", { editor,
 *   transaction })` so consumers reading the heading inventory wake on
 *   schema-only or selection-only transactions that would not otherwise
 *   trigger a render. The emit is synchronous and fires AFTER the storage
 *   assignment, so listeners observe the freshly-computed value.
 *
 * Consumers:
 *   - `core/helpers/editor-ref.ts` — surfaces the storage via
 *     `EditorRefApi.getHeadings()` and `onHeadingChange()`
 *   - Downstream outline / page-summary UI rendered by `@plane/editor`
 *     consumers (e.g. the page-summary content browser in `apps/web`)
 *
 * Convenience accessor:
 *   `getHeadings()` returns the current `storage.headings` array;
 *   equivalent to reading `editor.storage[CORE_EXTENSIONS.HEADINGS_LIST]
 *   .headings` directly.
 */
export const HeadingListExtension = Extension.create<unknown, HeadingExtensionStorage>({
  name: CORE_EXTENSIONS.HEADINGS_LIST,

  addStorage() {
    return {
      headings: [] as IMarking[],
    };
  },

  addProseMirrorPlugins() {
    const plugin = new Plugin({
      key: new PluginKey("heading-list"),
      appendTransaction: (_, __, newState) => {
        const headings: IMarking[] = [];
        let h1Sequence = 0;
        let h2Sequence = 0;
        let h3Sequence = 0;

        newState.doc.descendants((node) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            const text = node.textContent;

            headings.push({
              type: "heading",
              level: level,
              text: text,
              sequence: level === 1 ? ++h1Sequence : level === 2 ? ++h2Sequence : ++h3Sequence,
            });
          }
        });

        this.storage.headings = headings;

        this.editor.emit("update", {
          editor: this.editor,
          transaction: newState.tr,
        });

        return null;
      },
    });

    return [plugin];
  },

  getHeadings() {
    return this.storage.headings;
  },
});
