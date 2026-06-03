/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared ProseMirror plugin that coordinates which table cells are visually
 * hidden during a drag operation.
 *
 * Consumed by BOTH the column drag-handle plugin and the row drag-handle plugin
 * to suppress source-cell content while a drag preview is rendered. Cell hiding
 * is implemented via `Decoration.node` with the `content-hidden` CSS class
 * rather than document mutations so the editor's undo history stays clean — the
 * preview is purely visual and undoing a drag should not step backward through
 * its intermediate visual states.
 *
 * Visual element ownership in this subtree: this plugin owns NO directly visible
 * UI. Insert-handler plugin owns the "+" buttons; column/row drag-handle plugins
 * own the handle widgets; selection-outline plugin owns the cell perimeter.
 */

import type { Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const TABLE_DRAG_STATE_PLUGIN_KEY = new PluginKey("tableDragState");

/**
 * Sets the table drag-state plugin's meta on the given transaction.
 *
 * Drag-handle code calls this with an array of table-cell document positions to
 * mark them as hidden, or with `null` / `[]` to clear all hidden decorations at
 * drag end. Mutates `tr.meta` only — no DOM or document changes.
 *
 * @param tr Transaction that will carry the meta into the plugin's `state.apply`.
 * @param hiddenCellPositions Document positions of cells to hide, or `null` to clear.
 */
export const updateTransactionMeta = (tr: Transaction, hiddenCellPositions: number[] | null) => {
  tr.setMeta(TABLE_DRAG_STATE_PLUGIN_KEY, hiddenCellPositions);
};

/**
 * Plugin to manage table drag state using decorations.
 *
 * This allows hiding cell content during drag operations without modifying the
 * document; decorations are local to each user and not persisted or shared.
 *
 * State lifecycle:
 *   - `init`: starts with `DecorationSet.empty`.
 *   - `apply`: reads transaction meta — `undefined` preserves+maps existing
 *     decorations; `null`/empty clears them; an array of positions rebuilds
 *     node decorations with class `content-hidden` for each resolvable cell.
 *   - `props.decorations`: exposes the current set to the editor view.
 */
export const TableDragStatePlugin = new Plugin({
  key: TABLE_DRAG_STATE_PLUGIN_KEY,
  state: {
    init() {
      return DecorationSet.empty;
    },
    apply(tr, oldState) {
      // Get metadata about which cells to hide
      const hiddenCellPositions = tr.getMeta(TABLE_DRAG_STATE_PLUGIN_KEY) as number[] | null;

      if (hiddenCellPositions === undefined) {
        // No change, map decorations through the transaction
        return oldState.map(tr.mapping, tr.doc);
      }

      if (hiddenCellPositions === null || !Array.isArray(hiddenCellPositions) || hiddenCellPositions.length === 0) {
        // Clear all decorations
        return DecorationSet.empty;
      }

      // Create decorations for hidden cells
      const decorations: Decoration[] = [];
      hiddenCellPositions.forEach((pos) => {
        if (typeof pos !== "number") return;
        const node = tr.doc.nodeAt(pos);
        if (node) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "content-hidden",
            })
          );
        }
      });

      return DecorationSet.create(tr.doc, decorations);
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
