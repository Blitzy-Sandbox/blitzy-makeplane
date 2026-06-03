/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Support layer for the table insert-handler plugin (`./plugin.ts`).
 *
 * Provides three concerns:
 *   1. Factory functions for the inline "+" buttons that overlay the right
 *      edge (column insert) and bottom edge (row insert) of every rendered
 *      `<table>`. Each button accepts BOTH a click (insert one column/row at
 *      the end) AND a press-and-drag gesture (continuous insert/remove driven
 *      by pointer distance from the press point).
 *   2. DOM-to-document mapping helpers — `findAllTables` and
 *      `getCurrentTableInfo` — that walk the editor DOM to resolve each
 *      rendered `<table>` back to its ProseMirror node and document position.
 *   3. Safe wrappers around the canonical ProseMirror table commands
 *      (`addColumn`, `removeColumn`, `addRow`, `removeRow`) with conservative
 *      guard rails: the remove helpers refuse to drop the last remaining
 *      row/column and refuse to drop a non-empty trailing row/column.
 *
 * Consumers: `./plugin.ts` (the `TableInsertPlugin` ProseMirror plugin that
 * mounts these buttons on every rendered table and tracks them in a
 * `Map<HTMLElement, TableInfo>`).
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { addColumn, removeColumn, addRow, removeRow, TableMap } from "@tiptap/pm/tables";
import type { TableRect } from "@tiptap/pm/tables";
// local imports
import { isCellEmpty } from "../../table/utilities/helpers";

const addSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path
  d="M8.5 7.49988V3.49988C8.5 3.22374 8.27614 2.99988 8 2.99988C7.72386 2.99988 7.5 3.22374 7.5 3.49988L7.5 7.49988L3.5 7.49988C3.22386 7.49988 3 7.72374 3 7.99988C3 8.27602 3.22386 8.49988 3.5 8.49988H7.5L7.5 12.4999C7.5 12.776 7.72386 12.9999 8 12.9999C8.27614 12.9999 8.5 12.776 8.5 12.4999L8.5 8.49988L12.5 8.49988C12.7761 8.49988 13 8.27602 13 7.99988C13 7.72374 12.7761 7.49988 12.5 7.49988L8.5 7.49988Z"
  fill="currentColor"
/>
</svg>`;

/**
 * Per-table tracking record for {@link TableInsertPlugin}'s
 * `Map<HTMLElement, TableInfo>`. Captures the rendered `<table>` element, the
 * corresponding ProseMirror node, its document start position, and cached
 * references to the affordance DOM nodes the plugin appended to that table.
 *
 * @property tableElement                - The rendered `<table>` DOM element.
 * @property tableNode                   - The ProseMirror node for this table.
 * @property tablePos                    - The table's start position in the document.
 * @property columnButtonElement         - The "+" column-insert button (set after mount).
 * @property rowButtonElement            - The "+" row-insert button (set after mount).
 * @property dragMarkerContainerElement  - The drop/drag marker container (set after mount).
 */
export type TableInfo = {
  tableElement: HTMLElement;
  tableNode: ProseMirrorNode;
  tablePos: number;
  columnButtonElement?: HTMLElement;
  rowButtonElement?: HTMLElement;
  dragMarkerContainerElement?: HTMLElement;
};

/**
 * Creates the "+" button affordance that lets the user insert a new column at
 * the END of the given table. The returned `HTMLElement` is owned by the
 * caller (the `TableInsertPlugin`), which appends it to the `<table>` element
 * and stores the reference on the `TableInfo.columnButtonElement` field.
 *
 * Interaction model — the button supports BOTH a click AND a drag gesture:
 *   - Click (no drag past `DRAG_THRESHOLD = 5px`): inserts one column via
 *     `insertColumnAfterLast(...)`.
 *   - Press-and-drag horizontally:
 *       * Rightward total distance ≥ `ACTION_THRESHOLD = 150px` from the last
 *         action point triggers `insertColumnAfterLast(...)` and resets the
 *         reference point so continued dragging keeps inserting.
 *       * Leftward total distance ≥ 150px from the last action point triggers
 *         `removeLastColumn(...)` and resets only if a column was actually
 *         removed (the guard rails in `removeLastColumn` may refuse).
 *   - Vertical pointer movement is ignored for the column button.
 *
 * Side-channel hygiene during a drag: the context menu and native text
 * selection are suppressed (`contextmenu` and `selectstart` listeners call
 * `preventDefault`) and `document.body.style.userSelect` is set to `none`
 * while `isDragging` is true.
 *
 * WHY a custom gesture (not HTML5 drag-and-drop): the native DnD API binds a
 * drag to a payload and disables click semantics, but this affordance must
 * accept a single click OR initiate a column action depending on pointer
 * distance — so the button rolls its own `mousedown`/`mousemove`/`mouseup`
 * state machine.
 *
 * @param editor    - The TipTap editor instance to dispatch transactions through.
 * @param tableInfo - The tracking record for the table this button operates on.
 * @returns The `<button>` element ready to be appended to the `<table>`.
 */
export const createColumnInsertButton = (editor: Editor, tableInfo: TableInfo): HTMLElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-column-insert-button";
  button.title = "Insert columns";
  button.ariaLabel = "Insert columns";

  const icon = document.createElement("span");
  icon.innerHTML = addSvg;
  button.appendChild(icon);

  let mouseDownX = 0;
  let isDragging = false;
  let dragStarted = false;
  let lastActionX = 0;
  const DRAG_THRESHOLD = 5; // pixels to start drag
  const ACTION_THRESHOLD = 150; // pixels total distance to trigger action

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button

    e.preventDefault();
    e.stopPropagation();

    mouseDownX = e.clientX;
    lastActionX = e.clientX;
    isDragging = false;
    dragStarted = false;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    const deltaX = e.clientX - mouseDownX;
    const distance = Math.abs(deltaX);

    // Start dragging if moved more than threshold
    if (!isDragging && distance > DRAG_THRESHOLD) {
      isDragging = true;
      dragStarted = true;

      // Visual feedback
      button.classList.add("dragging");
      document.body.style.userSelect = "none";
    }

    if (isDragging) {
      const totalDistance = Math.abs(e.clientX - lastActionX);

      // Only trigger action when total distance reaches threshold
      if (totalDistance >= ACTION_THRESHOLD) {
        // Determine direction based on current movement relative to last action point
        const directionFromLastAction = e.clientX - lastActionX;

        // Right direction - add columns
        if (directionFromLastAction > 0) {
          insertColumnAfterLast(editor, tableInfo);
          lastActionX = e.clientX; // Reset action point
        }
        // Left direction - delete empty columns
        else if (directionFromLastAction < 0) {
          const deleted = removeLastColumn(editor, tableInfo);
          if (deleted) {
            lastActionX = e.clientX; // Reset action point
          }
        }
      }
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    if (isDragging) {
      // Clean up drag state
      button.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    } else if (!dragStarted) {
      // Handle as click if no dragging occurred
      insertColumnAfterLast(editor, tableInfo);
    }

    isDragging = false;
    dragStarted = false;
  };

  button.addEventListener("mousedown", onMouseDown);

  // Prevent context menu and text selection
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("selectstart", (e) => e.preventDefault());

  return button;
};

/**
 * Creates the "+" button affordance that lets the user insert a new row at
 * the END of the given table. Symmetric to {@link createColumnInsertButton}
 * but tracks VERTICAL pointer movement.
 *
 * Interaction model:
 *   - Click (no drag past `DRAG_THRESHOLD = 5px`): inserts one row via
 *     `insertRowAfterLast(...)`.
 *   - Press-and-drag vertically:
 *       * Downward total distance ≥ `ACTION_THRESHOLD = 40px` from the last
 *         action point triggers `insertRowAfterLast(...)` and resets the
 *         reference point so continued dragging keeps inserting rows.
 *         (The 40 px threshold is intentionally smaller than the column
 *         button's 150 px because table rows are visually much shorter than
 *         columns are wide.)
 *       * Upward total distance ≥ 40px from the last action point triggers
 *         `removeLastRow(...)` and resets only if a row was actually removed.
 *   - Horizontal pointer movement is ignored for the row button.
 *
 * Side-channel hygiene during a drag: context menu and native text selection
 * are suppressed, matching the column button.
 *
 * @param editor    - The TipTap editor instance to dispatch transactions through.
 * @param tableInfo - The tracking record for the table this button operates on.
 * @returns The `<button>` element ready to be appended to the `<table>`.
 */
export const createRowInsertButton = (editor: Editor, tableInfo: TableInfo): HTMLElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-row-insert-button";
  button.title = "Insert rows";
  button.ariaLabel = "Insert rows";

  const icon = document.createElement("span");
  icon.innerHTML = addSvg;
  button.appendChild(icon);

  let mouseDownY = 0;
  let isDragging = false;
  let dragStarted = false;
  let lastActionY = 0;
  const DRAG_THRESHOLD = 5; // pixels to start drag
  const ACTION_THRESHOLD = 40; // pixels total distance to trigger action

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button

    e.preventDefault();
    e.stopPropagation();

    mouseDownY = e.clientY;
    lastActionY = e.clientY;
    isDragging = false;
    dragStarted = false;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    const deltaY = e.clientY - mouseDownY;
    const distance = Math.abs(deltaY);

    // Start dragging if moved more than threshold
    if (!isDragging && distance > DRAG_THRESHOLD) {
      isDragging = true;
      dragStarted = true;

      // Visual feedback
      button.classList.add("dragging");
      document.body.style.userSelect = "none";
    }

    if (isDragging) {
      const totalDistance = Math.abs(e.clientY - lastActionY);

      // Only trigger action when total distance reaches threshold
      if (totalDistance >= ACTION_THRESHOLD) {
        // Determine direction based on current movement relative to last action point
        const directionFromLastAction = e.clientY - lastActionY;

        // Down direction - add rows
        if (directionFromLastAction > 0) {
          insertRowAfterLast(editor, tableInfo);
          lastActionY = e.clientY; // Reset action point
        }
        // Up direction - delete empty rows
        else if (directionFromLastAction < 0) {
          const deleted = removeLastRow(editor, tableInfo);
          if (deleted) {
            lastActionY = e.clientY; // Reset action point
          }
        }
      }
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    if (isDragging) {
      // Clean up drag state
      button.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    } else if (!dragStarted) {
      // Handle as click if no dragging occurred
      insertRowAfterLast(editor, tableInfo);
    }

    isDragging = false;
    dragStarted = false;
  };

  button.addEventListener("mousedown", onMouseDown);

  // Prevent context menu and text selection
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("selectstart", (e) => e.preventDefault());

  return button;
};

/**
 * Scans the editor view DOM for `<table>` elements and resolves each one back
 * to its ProseMirror table node + document start position.
 *
 * Algorithm: query `view.dom.querySelectorAll("table")`, then for each found
 * `<table>` walk the document via `state.doc.descendants` to locate a node
 * whose `tableRole === "table"` whose DOM (resolved through
 * `view.domAtPos(...)`) is the same element. Iteration short-circuits once
 * the matching node is found.
 *
 * WHY DOM scanning rather than walking the whole document: most documents
 * contain few tables, so scanning the DOM is cheaper than running a full
 * descendant walk for every reconciliation pass, and the editor DOM is the
 * authoritative source of "which tables are currently rendered."
 *
 * @param editor - The TipTap editor instance to scan.
 * @returns One {@link TableInfo} per discovered `<table>`, with `tableElement`,
 *          `tableNode`, and `tablePos` populated. The button/marker fields
 *          are left undefined for the plugin to fill in.
 */
export const findAllTables = (editor: Editor): TableInfo[] => {
  const tables: TableInfo[] = [];
  const tableElements = editor.view.dom.querySelectorAll("table");

  tableElements.forEach((tableElement) => {
    // Find the table's ProseMirror position
    let tablePos = -1;
    let tableNode: ProseMirrorNode | null = null;

    // Walk through the document to find matching table nodes
    editor.state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole === "table") {
        const domAtPos = editor.view.domAtPos(pos + 1);
        let domTable = domAtPos.node;

        // Navigate to find the table element
        while (domTable && domTable.parentNode && domTable.nodeType !== Node.ELEMENT_NODE) {
          domTable = domTable.parentNode;
        }

        while (domTable && domTable.parentNode && (domTable as HTMLElement).tagName !== "TABLE") {
          domTable = domTable.parentNode;
        }

        if (domTable === tableElement) {
          tablePos = pos;
          tableNode = node;
          return false; // Stop iteration
        }
      }
    });

    if (tablePos !== -1 && tableNode) {
      tables.push({
        tableElement,
        tableNode,
        tablePos,
      });
    }
  });

  return tables;
};

/**
 * Refreshes a cached {@link TableInfo}'s `node` and `pos` by re-running
 * {@link findAllTables} and returning the entry that matches the same
 * `tableElement`. Falls back to the input record if the table is no longer
 * present in the DOM.
 *
 * WHY: the cached `node`/`pos` go stale after every document mutation; the
 * insert/remove helpers call this before each command so they operate on the
 * current ProseMirror state, not the snapshot captured when the button was
 * created.
 */
const getCurrentTableInfo = (editor: Editor, tableInfo: TableInfo): TableInfo => {
  // Refresh table info to get latest state
  const tables = findAllTables(editor);
  const updated = tables.find((t) => t.tableElement === tableInfo.tableElement);
  return updated || tableInfo;
};

// Column functions
/**
 * Inserts a new column at the end of the table by wrapping the canonical
 * ProseMirror `addColumn(...)` command. Builds the {@link TableMap} and a
 * full-table {@link TableRect}, calls `addColumn` with the last-column index,
 * and dispatches the resulting transaction through the editor view.
 *
 * Side effects: dispatches one ProseMirror transaction; performs no DOM
 * manipulation directly (the affordance buttons are re-positioned by the
 * plugin's `update` reconciliation on the next tick).
 */
const insertColumnAfterLast = (editor: Editor, tableInfo: TableInfo) => {
  const currentTableInfo = getCurrentTableInfo(editor, tableInfo);
  const { tableNode, tablePos } = currentTableInfo;
  const tableMapData = TableMap.get(tableNode);
  const lastColumnIndex = tableMapData.width;

  const tr = editor.state.tr;
  const rect: TableRect = {
    map: tableMapData,
    tableStart: tablePos,
    table: tableNode,
    top: 0,
    left: 0,
    bottom: tableMapData.height - 1,
    right: tableMapData.width - 1,
  };

  const newTr = addColumn(tr, rect, lastColumnIndex);
  editor.view.dispatch(newTr);
};

/**
 * Removes the LAST column of the table by wrapping the canonical ProseMirror
 * `removeColumn(...)` command. Returns whether the removal was actually
 * dispatched.
 *
 * Safety guards (both must pass before the transaction is dispatched):
 *   1. The table must have MORE than one column — a table must always retain
 *      at least one column.
 *   2. The last column must be EMPTY per `isColumnEmpty(...)` (every cell in
 *      the column passes `isCellEmpty` from the table helpers).
 *
 * WHY conservative: the drag-gesture from the "+" button is an
 * undo-unfriendly UX path (the user is mid-drag, not deliberately deleting),
 * so silently destroying populated content would be a hazard. Both guards
 * cause the function to return `false` without dispatching anything.
 *
 * @returns `true` if a column was removed, `false` if either guard refused.
 */
const removeLastColumn = (editor: Editor, tableInfo: TableInfo): boolean => {
  const currentTableInfo = getCurrentTableInfo(editor, tableInfo);
  const { tableNode, tablePos } = currentTableInfo;
  const tableMapData = TableMap.get(tableNode);

  // Don't delete if only one column left
  if (tableMapData.width <= 1) {
    return false;
  }

  const lastColumnIndex = tableMapData.width - 1;

  // Check if last column is empty
  if (!isColumnEmpty(currentTableInfo, lastColumnIndex)) {
    return false;
  }

  const tr = editor.state.tr;
  const rect = {
    map: tableMapData,
    tableStart: tablePos,
    table: tableNode,
    top: 0,
    left: 0,
    bottom: tableMapData.height - 1,
    right: tableMapData.width - 1,
  };

  removeColumn(tr, rect, lastColumnIndex);
  editor.view.dispatch(tr);
  return true;
};

const isColumnEmpty = (tableInfo: TableInfo, columnIndex: number): boolean => {
  const { tableNode } = tableInfo;
  const tableMapData = TableMap.get(tableNode);

  // Check each cell in the column
  for (let row = 0; row < tableMapData.height; row++) {
    const cellIndex = row * tableMapData.width + columnIndex;
    const cellPos = tableMapData.map[cellIndex];
    const cell = tableNode.nodeAt(cellPos);

    if (!isCellEmpty(cell)) {
      return false;
    }
  }
  return true;
};

// Row functions
/**
 * Inserts a new row at the end of the table by wrapping the canonical
 * ProseMirror `addRow(...)` command. Symmetric to
 * {@link insertColumnAfterLast} but operating on rows.
 *
 * Side effects: dispatches one ProseMirror transaction; performs no DOM
 * manipulation directly.
 */
const insertRowAfterLast = (editor: Editor, tableInfo: TableInfo) => {
  const currentTableInfo = getCurrentTableInfo(editor, tableInfo);
  const { tableNode, tablePos } = currentTableInfo;
  const tableMapData = TableMap.get(tableNode);
  const lastRowIndex = tableMapData.height;

  const tr = editor.state.tr;
  const rect: TableRect = {
    map: tableMapData,
    tableStart: tablePos,
    table: tableNode,
    top: 0,
    left: 0,
    bottom: tableMapData.height - 1,
    right: tableMapData.width - 1,
  };

  const newTr = addRow(tr, rect, lastRowIndex);
  editor.view.dispatch(newTr);
};

/**
 * Removes the LAST row of the table by wrapping the canonical ProseMirror
 * `removeRow(...)` command. Symmetric to {@link removeLastColumn} but
 * operating on rows.
 *
 * Safety guards (both must pass):
 *   1. The table must have MORE than one row.
 *   2. The last row must be EMPTY per `isRowEmpty(...)`.
 *
 * @returns `true` if a row was removed, `false` if either guard refused.
 */
const removeLastRow = (editor: Editor, tableInfo: TableInfo): boolean => {
  const currentTableInfo = getCurrentTableInfo(editor, tableInfo);
  const { tableNode, tablePos } = currentTableInfo;
  const tableMapData = TableMap.get(tableNode);

  // Don't delete if only one row left
  if (tableMapData.height <= 1) {
    return false;
  }

  const lastRowIndex = tableMapData.height - 1;

  // Check if last row is empty
  if (!isRowEmpty(currentTableInfo, lastRowIndex)) {
    return false;
  }

  const tr = editor.state.tr;
  const rect = {
    map: tableMapData,
    tableStart: tablePos,
    table: tableNode,
    top: 0,
    left: 0,
    bottom: tableMapData.height - 1,
    right: tableMapData.width - 1,
  };

  removeRow(tr, rect, lastRowIndex);
  editor.view.dispatch(tr);
  return true;
};

const isRowEmpty = (tableInfo: TableInfo, rowIndex: number): boolean => {
  const { tableNode } = tableInfo;
  const tableMapData = TableMap.get(tableNode);

  // Check each cell in the row
  for (let col = 0; col < tableMapData.width; col++) {
    const cellIndex = rowIndex * tableMapData.width + col;
    const cellPos = tableMapData.map[cellIndex];
    const cell = tableNode.nodeAt(cellPos);

    if (!isCellEmpty(cell)) {
      return false;
    }
  }
  return true;
};
