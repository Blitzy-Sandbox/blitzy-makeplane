/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Drag-preview construction and drag-time cell-visibility helpers shared by both
 * axes of the table drag-handle subsystem.
 *
 * Cross-axis consumers (this is why the helpers live in the SHARED parent folder
 * rather than being duplicated into each axis subfolder):
 *   - `column/drag-handle.tsx` — calls `showCellContent` to clear the drag visual.
 *   - `column/utils.ts` — assembles the column drag preview via
 *     `constructDragPreviewTable` + `cloneTableCell`, then hides source cells via
 *     `getSelectedCellPositions` + `hideCellContent`.
 *   - `row/drag-handle.tsx` — calls `showCellContent` to clear the drag visual.
 *   - `row/utils.ts` — symmetrical row counterpart of `column/utils.ts`.
 *
 * Relationship to the sibling `drag-state.ts` plugin: the `hideCellContent` /
 * `showCellContent` pair in this file are THIN wrappers over the plugin's meta
 * channel — each builds a transaction, writes the hidden-cell positions via
 * `updateTransactionMeta` (which `tr.setMeta`s the `TableDragStatePlugin` key),
 * stamps `CORE_EDITOR_META.ADD_TO_HISTORY = false`, and dispatches. The actual
 * `Decoration.node` lifecycle that paints cells with class `content-hidden`
 * lives in `drag-state.ts`, not here.
 *
 * Undo-clean contract: every transaction this module dispatches sets
 * `ADD_TO_HISTORY = false`. The drag preview is purely visual; if its show/hide
 * transitions entered undo history, an undo after a drag would step backward
 * through visual intermediate states before reaching the real document-level
 * change — confusing UX.
 */

import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
// constants
import { CORE_EDITOR_META } from "@/constants/meta";
// extensions
import { getSelectedRect, isCellSelection } from "@/extensions/table/table/utilities/helpers";
import type { TableNodeLocation } from "@/extensions/table/table/utilities/helpers";
// local imports
import { updateTransactionMeta } from "../drag-state";

/**
 * Creates a detached `<table><tbody>` DOM wrapper used as the host for drag-preview
 * cells.
 *
 * Detached: the returned elements are NOT appended to `document.body` or any editor
 * surface — `column/utils.ts` and `row/utils.ts` mount them at drag start. Styling
 * pins the wrapper to the `table-drag-preview` + `bg-surface-1` classes and sets
 * `opacity: 0.9` inline so the preview reads as a translucent ghost over the real
 * table.
 *
 * @returns Both fresh HTML elements: the outer `<table>` and the empty `<tbody>`
 * ready to receive cloned cells.
 */
export const constructDragPreviewTable = (): {
  tableElement: HTMLTableElement;
  tableBodyElement: HTMLTableSectionElement;
} => {
  const tableElement = document.createElement("table");
  tableElement.classList.add("table-drag-preview");
  tableElement.classList.add("bg-surface-1");
  tableElement.style.opacity = "0.9";
  const tableBodyElement = document.createElement("tbody");
  tableElement.appendChild(tableBodyElement);

  return { tableElement, tableBodyElement };
};

/**
 * Deep-clones a table-cell DOM node for placement inside a drag preview.
 *
 * Two non-obvious behaviors the caller relies on:
 *   - Forces `visibility: visible !important` because the original cell may already
 *     carry the `content-hidden` class (applied by `TableDragStatePlugin` in
 *     `../drag-state.ts`); without the override the preview would render empty.
 *   - Strips every `.ProseMirror-widget` descendant (drag-handle widget, insert "+"
 *     buttons, placeholder widgets) so the preview shows CONTENT only, not editor
 *     chrome.
 *
 * @param cellElement Source table-cell node to clone.
 * @returns The cloned cell, ready to append into the drag-preview `<tbody>`.
 */
export const cloneTableCell = (
  cellElement: HTMLElement
): {
  clonedCellElement: HTMLElement;
} => {
  const clonedCellElement = cellElement.cloneNode(true) as HTMLElement;
  clonedCellElement.style.setProperty("visibility", "visible", "important");

  const widgetElement = clonedCellElement.querySelectorAll(".ProseMirror-widget");
  widgetElement.forEach((widget) => widget.remove());

  return { clonedCellElement };
};

/**
 * Translates a `CellSelection` into an array of absolute document positions, one per
 * selected cell.
 *
 * Pipeline: `isCellSelection` type-guard (returns `[]` for non-cell selections) →
 * `getSelectedRect` for the selection bounding box → `TableMap.cellsInRect(...)`
 * for cell positions RELATIVE to the table → offset each by `table.start` to lift
 * them into ABSOLUTE document positions consumable by `tr.doc.nodeAt(...)`.
 *
 * Consumers: `column/utils.ts` and `row/utils.ts` feed the returned positions
 * directly into `hideCellContent` when constructing a drag preview.
 *
 * @param selection Current editor selection; must be a `CellSelection` to produce a
 * non-empty result.
 * @param table Table location resolved by `findTable` — supplies `start` for the
 * relative-to-absolute offset and `node` for `TableMap.get`.
 * @returns Absolute document positions of every selected cell, or `[]` if
 * `selection` is not a `CellSelection`.
 */
export const getSelectedCellPositions = (selection: Selection, table: TableNodeLocation): number[] => {
  if (!isCellSelection(selection)) return [];

  const tableMap = TableMap.get(table.node);
  const selectedRect = getSelectedRect(selection, tableMap);
  const cellsInSelection = tableMap.cellsInRect(selectedRect);

  // Convert relative positions to absolute document positions
  return cellsInSelection.map((cellPos) => table.start + cellPos);
};

/**
 * Dispatches a local transaction that marks `cellPositions` as visually hidden via
 * the sibling `TableDragStatePlugin` (`../drag-state.ts`).
 *
 * Thin wrapper: writes the hidden positions into the plugin's meta channel through
 * `updateTransactionMeta(tr, cellPositions)`, sets
 * `CORE_EDITOR_META.ADD_TO_HISTORY` to `false`, then dispatches. The actual
 * `content-hidden` `Decoration.node` set is built in the plugin's `state.apply`,
 * not here.
 *
 * Undo-clean: the `ADD_TO_HISTORY = false` flag keeps the show/hide transitions out
 * of undo history — undoing a drag must reach the real document change directly,
 * not step through the preview's intermediate visual states.
 *
 * @param editor Editor whose `view.state.tr` is built on and dispatched against.
 * @param cellPositions Absolute document positions of cells to hide (from
 * `getSelectedCellPositions`).
 */
export const hideCellContent = (editor: Editor, cellPositions: number[]): void => {
  const tr = editor.view.state.tr;
  updateTransactionMeta(tr, cellPositions);
  tr.setMeta(CORE_EDITOR_META.ADD_TO_HISTORY, false);
  editor.view.dispatch(tr);
};

/**
 * Inverse of `hideCellContent` — dispatches a local transaction that clears every
 * cell-content decoration set by the prior `hideCellContent` call.
 *
 * Implementation: passes `null` to `updateTransactionMeta`, which causes the
 * sibling `TableDragStatePlugin` to reset its decoration set to
 * `DecorationSet.empty` on the next apply. Same `ADD_TO_HISTORY = false`
 * constraint as `hideCellContent` — the show/hide pair must be invisible to undo
 * history.
 *
 * @param editor Editor whose `view.state.tr` is built on and dispatched against.
 */
export const showCellContent = (editor: Editor): void => {
  const tr = editor.view.state.tr;
  updateTransactionMeta(tr, null);
  tr.setMeta(CORE_EDITOR_META.ADD_TO_HISTORY, false);
  editor.view.dispatch(tr);
};
