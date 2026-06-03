/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `TableView` — the custom ProseMirror `NodeView` mounted by the
 * `Table` extension's `addNodeView()` hook (see `./table.ts`).
 *
 * Paints the table with an explicit `<colgroup>` of `<col>` elements, a
 * `<tbody>` content mount point, and a scrollable wrapper `<div>` with the
 * `editor-full-width-block horizontal-scrollbar scrollbar-sm` class chain.
 * Synchronizes `<col>` widths with the node's underlying `colwidth`
 * attributes via `updateColumnsOnResize` from `@tiptap/pm/tables` on every
 * update, and opts out of ProseMirror's DOM reconciliation via
 * `ignoreMutation()` so external DOM mutations (drag-handle widget
 * insertion, insert-handler buttons, decorations from the selection
 * outline plugin) don't trigger a node re-render.
 *
 * Implementation note: despite the `.tsx` extension, this is NOT a React
 * component — it is a vanilla class that implements `NodeView` from
 * `@tiptap/pm/view`. The `h` helper from `jsx-dom-cjs` constructs plain
 * `HTMLElement`s (NOT React virtual DOM), letting the file use JSX-like
 * syntax for terse DOM construction while staying outside the React
 * reconciler. The drag-handle widgets and insert affordances rendered by
 * the plugins in `../plugins/` ARE React components, but they're injected
 * as ProseMirror decorations alongside this NodeView, not inside it.
 */

import type { Editor, NodeViewProps } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { TableMap, updateColumnsOnResize } from "@tiptap/pm/tables";
import type { Decoration, NodeView } from "@tiptap/pm/view";
import { h } from "jsx-dom-cjs";

/**
 * Custom `NodeView` for the editor's `Table` node.
 *
 * WHY a custom NodeView (vs upstream's vanilla `<table>` rendering):
 *   ProseMirror's table editing plugin (`@tiptap/pm/tables`) expects
 *   explicit column widths via `<colgroup>` to enable predictable layout
 *   when cells are edited. Without a `<colgroup>`, cell widths flex with
 *   content and the column drag-handle pixel math in
 *   `../plugins/drag-handles/column/` becomes unreliable. This NodeView
 *   takes ownership of the table DOM and runs
 *   `updateColumnsOnResize(node, colgroup, table, cellMinWidth)` on every
 *   `update()` so `<col>` widths track the node's `colwidth` attributes.
 *
 * WHY `ignoreMutation()` returns `true`:
 *   Plugins under `../plugins/` (drag-handles, insert-handlers,
 *   drag-state, selection-outline) attach DOM decorations to the table
 *   wrapper. Returning `true` from `ignoreMutation` tells ProseMirror NOT
 *   to treat those decoration mutations as document edits, preventing
 *   spurious node re-renders that would tear down the plugin decorations.
 *
 * DOM structure produced:
 *   ```
 *   <div class="table-wrapper editor-full-width-block horizontal-scrollbar scrollbar-sm">
 *     <table>
 *       <colgroup>
 *         <col />  <!-- one per column, widths set by updateColumnsOnResize -->
 *         ...
 *       </colgroup>
 *       <tbody>
 *         <!-- ProseMirror populates this with row nodes; contentDOM points here -->
 *       </tbody>
 *     </table>
 *   </div>
 *   ```
 *
 * Lifecycle:
 *   - constructor: snapshot `node` / `decorations` / `editor` / `getPos`,
 *     compute `TableMap.get(node)`, build the wrapper DOM, render columns
 *   - `update(node, decorations)`: bail if `node.type` changed (let
 *     ProseMirror tear down and rebuild); otherwise snapshot the new
 *     node / decorations, recompute the `TableMap`, re-render columns
 *   - `render()`: if the `<col>` count no longer matches `map.width`
 *     (columns were added or removed), replace the `<colgroup>` children;
 *     then call `updateColumnsOnResize` to push the node's per-cell
 *     `colwidth` attribute values onto each `<col>`'s `style.width`
 *   - `ignoreMutation()`: always `true` — see above
 */
export class TableView implements NodeView {
  node: ProseMirrorNode;
  cellMinWidth: number;
  decorations: readonly Decoration[];
  editor: Editor;
  getPos: NodeViewProps["getPos"];
  hoveredCell: ResolvedPos | null = null;
  map: TableMap;
  root: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  tbody: HTMLElement;
  controls?: HTMLElement;

  /**
   * Outer mount point for ProseMirror. The wrapper `<div>` provides the
   * horizontal scroll container so wide tables don't break the editor
   * layout.
   */
  get dom() {
    return this.root;
  }

  /**
   * Inner mount point where ProseMirror writes the table's row nodes.
   * Returning `this.tbody` tells ProseMirror to render rows inside
   * `<tbody>`, leaving `<colgroup>` (a sibling of `<tbody>`) under
   * NodeView control.
   */
  get contentDOM() {
    return this.tbody;
  }

  /**
   * Build the wrapper DOM and seed it with empty `<col>` elements (one
   * per column from the initial `TableMap`). The first `render()` call
   * at the end of the constructor pushes the node's `colwidth` attribute
   * values onto the `<col>` styles via `updateColumnsOnResize`.
   */
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    decorations: readonly Decoration[],
    editor: Editor,
    getPos: NodeViewProps["getPos"]
  ) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.decorations = decorations;
    this.editor = editor;
    this.getPos = getPos;
    this.hoveredCell = null;
    this.map = TableMap.get(node);

    this.colgroup = h(
      "colgroup",
      null,
      Array.from({ length: this.map.width }, () => 1).map(() => h("col"))
    );
    this.tbody = h("tbody");
    this.table = h("table", null, this.colgroup, this.tbody);

    this.root = h(
      "div",
      {
        className: "table-wrapper editor-full-width-block horizontal-scrollbar scrollbar-sm",
      },
      this.table
    );

    this.render();
  }

  /**
   * ProseMirror's per-transaction update hook. Returns `true` to keep this
   * NodeView mounted, or `false` to ask ProseMirror to tear it down and
   * build a fresh one.
   *
   * Tear-down trigger: a `node.type` mismatch (the node was replaced with
   * a different type entirely). All other changes — content, attributes,
   * cell additions/removals — are absorbed in place by snapshotting the
   * new node, refreshing the `TableMap`, and calling `render()` to
   * reconcile the `<colgroup>` count and widths.
   */
  update(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.decorations = [...decorations];
    this.map = TableMap.get(this.node);

    this.render();

    return true;
  }

  /**
   * Reconcile the `<colgroup>` with the current `TableMap.width` and
   * push each cell's `colwidth` attribute onto the matching `<col>`'s
   * inline width via `updateColumnsOnResize` from `@tiptap/pm/tables`.
   *
   * The `colwidth` arrays live on the `TableCell`/`TableHeader` nodes
   * (default `[DEFAULT_COLUMN_WIDTH]` per `../table-cell.ts` and
   * `../table-header.ts`), and `updateColumnsOnResize` handles the
   * column-spanning logic when a cell's `colspan > 1`.
   */
  render() {
    if (this.colgroup.children.length !== this.map.width) {
      const cols = Array.from({ length: this.map.width }, () => 1).map(() => h("col"));
      this.colgroup.replaceChildren(...cols);
    }

    updateColumnsOnResize(this.node, this.colgroup, this.table, this.cellMinWidth);
  }

  /**
   * Tell ProseMirror to ignore all DOM mutations inside this NodeView so
   * decoration plugins (drag-handles, insert-handlers, drag-state,
   * selection-outline under `../plugins/`) can mutate the wrapper DOM
   * without triggering a node re-render.
   */
  ignoreMutation() {
    return true;
  }
}
