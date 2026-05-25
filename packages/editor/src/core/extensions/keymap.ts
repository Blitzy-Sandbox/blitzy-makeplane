/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom keyboard mappings and list-merging plugin for the Plane editor.
 *
 * Exports `CustomKeymap`, a from-scratch TipTap `Extension` that orchestrates
 * the editor's custom keyboard shortcuts and a transaction-level ProseMirror
 * plugin that merges adjacent sibling lists.
 *
 * Provides:
 *   - The `selectTextWithinNodeBoundaries` command (collapses selection to
 *     the active block's boundaries; used by the `Mod-a` keymap)
 *   - A ProseMirror plugin (`ordered-list-merging`) that auto-joins adjacent
 *     same-type list nodes (`orderedList`, `bulletList`, `taskList`) after
 *     every transaction
 *   - A `Mod-a` keyboard shortcut with two-press select-all behavior
 *     (first press: current block scope; second press: full document)
 *
 * Consumers: registered alongside other core extensions when building the
 * editor configuration in `packages/editor/src/core/extensions/*`.
 */

import { Extension } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    customKeymap: {
      /**
       * Select text between node boundaries
       */
      selectTextWithinNodeBoundaries: () => ReturnType;
    };
  }
}

/**
 * Walks the supplied transactions' position mappings and returns a flat array
 * of `[from, to, from, to, ...]` pairs spanning every changed range.
 *
 * Used by `autoJoin` to limit the scan for joinable list boundaries to
 * positions actually affected by the recent edit, avoiding a full-document
 * traversal.
 *
 * @param transactions - Read-only list of ProseMirror transactions whose
 *   mapping steps describe the document edits to scan.
 * @returns Flat array of paired positions; consume via index strides of 2.
 */
function collectRanges(transactions: readonly Transaction[]): Array<number> {
  const ranges: Array<number> = [];
  for (const tr of transactions) {
    for (let i = 0; i < tr.mapping.maps.length; i++) {
      const map = tr.mapping.maps[i];
      map.forEach((_s, _e, from, to) => ranges.push(from, to));
    }
  }
  return ranges;
}

/**
 * Identifies adjacent same-type sibling nodes within the supplied ranges and
 * joins them into a single node.
 *
 * Joinable points are computed by walking each range's shared-depth parent,
 * looking for consecutive children with matching types in `nodeTypes`, and
 * collecting the boundary positions. Joins are applied in reverse order so
 * later mutations do not invalidate earlier positions. `canJoin` from
 * `@tiptap/pm/transform` guards against joins that would violate the schema
 * (e.g., differing list attributes).
 *
 * @param ranges - Flat `[from, to, ...]` pairs from `collectRanges` to scan.
 * @param newTr - The transaction to mutate with join steps when applicable.
 * @param nodeTypes - Node types that are eligible to be merged when adjacent
 *   (e.g., `orderedList`, `bulletList`, `taskList`).
 * @returns `true` when at least one join occurred so the caller can dispatch
 *   `newTr`; `false` when nothing was merged.
 */
function autoJoin(ranges: Array<number>, newTr: Transaction, nodeTypes: NodeType[]) {
  const doc = newTr.doc;
  // Figure out which joinable points exist inside those ranges,
  // by checking all node boundaries in their parent nodes.
  const joinable: number[] = [];
  for (let i = 0; i < ranges.length; i += 2) {
    const from = ranges[i],
      to = ranges[i + 1];
    if (from >= doc.content.size) continue;
    const $from = doc.resolve(from),
      depth = $from.sharedDepth(to),
      parent = $from.node(depth);
    for (let index = $from.indexAfter(depth), pos = $from.after(depth + 1); pos <= to; ++index) {
      const after = parent.maybeChild(index);
      if (!after) break;
      if (index && joinable.indexOf(pos) == -1) {
        const before = parent.child(index - 1);
        if (before.type == after.type && nodeTypes.includes(before.type)) joinable.push(pos);
      }
      pos += after.nodeSize;
    }
  }

  let joined = false;

  // Join the joinable points (reverse order to keep positions stable)
  joinable.sort((a, b) => a - b);
  for (let i = joinable.length - 1; i >= 0; i--) {
    if (canJoin(doc, joinable[i])) {
      newTr.join(joinable[i]);
      joined = true;
    }
  }

  return joined;
}

/**
 * Custom keymap extension wiring `Mod-a` select-all progression and a
 * list-merging post-transaction plugin.
 *
 * Adds command: `selectTextWithinNodeBoundaries` — collapses the current
 * selection to the active block's boundaries (`$from.start()` to `$to.end()`).
 * Used internally by the `Mod-a` shortcut and exposed for downstream toolbar
 * or menu code via the `customKeymap` Commands interface.
 *
 * Registers ProseMirror plugin: `ordered-list-merging` — via
 * `appendTransaction`, auto-joins adjacent same-type sibling lists
 * (`orderedList`, `taskList`, `bulletList`) into a single node after every
 * transaction. The plugin returns the mutated transaction when at least one
 * join occurred so ProseMirror applies it atomically.
 *
 * Registers keyboard shortcut: `Mod-a` (Ctrl/Cmd-A) — two-press select-all:
 *   - First press: selects text within the active block's boundaries
 *     (detected when the selection does not already span the full block)
 *   - Second press: selects the entire document via `commands.selectAll()`
 *
 * WHY the list-merging plugin: ProseMirror does not auto-join sibling lists
 * after edits (e.g., deleting a separator paragraph between two bullet
 * lists). Without merging, two visually-contiguous lists remain structurally
 * separate, breaking drag-handle UX, list reordering, and Markdown
 * serialization. `appendTransaction` runs once per round of dispatched
 * transactions, making this normalization efficient on batched edits.
 *
 * WHY the two-press `Mod-a`: when editing a paragraph in a long document,
 * users typically want "select this paragraph" — not "select the whole
 * document". The two-press progression mirrors IDE-style scope expansion
 * (single press = current scope; second press = wider scope).
 */
export const CustomKeymap = Extension.create({
  name: "customKeymap",

  addCommands() {
    return {
      selectTextWithinNodeBoundaries:
        () =>
        ({ editor, commands }) => {
          const { state } = editor;
          const { tr } = state;
          const startNodePos = tr.selection.$from.start();
          const endNodePos = tr.selection.$to.end();
          return commands.setTextSelection({
            from: startNodePos,
            to: endNodePos,
          });
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("ordered-list-merging"),
        appendTransaction(transactions, oldState, newState) {
          const newTr = newState.tr;

          const joinableNodes = [
            newState.schema.nodes[CORE_EXTENSIONS.ORDERED_LIST],
            newState.schema.nodes[CORE_EXTENSIONS.TASK_LIST],
            newState.schema.nodes[CORE_EXTENSIONS.BULLET_LIST],
          ];

          const ranges = collectRanges(transactions);
          if (ranges.length && autoJoin(ranges, newTr, joinableNodes)) {
            return newTr;
          }
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { state } = editor;
        const { tr } = state;
        const startSelectionPos = tr.selection.from;
        const endSelectionPos = tr.selection.to;
        const startNodePos = tr.selection.$from.start();
        const endNodePos = tr.selection.$to.end();
        const isCurrentTextSelectionNotExtendedToNodeBoundaries =
          startSelectionPos > startNodePos || endSelectionPos < endNodePos;

        if (isCurrentTextSelectionNotExtendedToNodeBoundaries) {
          // First press: select text within node boundaries
          editor.chain().selectTextWithinNodeBoundaries().run();
          return true;
        } else {
          editor.commands.selectAll();
          return true;
        }
      },
    };
  },
});
