/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin wrapper for the table extension's insert-affordances subsystem.
 *
 * Owns the inline "+" buttons rendered on the right/bottom edges of every
 * `<table>` and the drop/drag marker container used by the table drag-handle
 * plugins for visual feedback. Reconciles those DOM-level controls against the
 * currently rendered tables on every document-changing transaction.
 *
 * Plugin ownership of table-related visual elements:
 *   - `drag-state.ts` (sibling)              — `content-hidden` cell decorations during drag
 *   - `insert-handlers/plugin.ts` (this)     — "+" buttons + drag/drop marker container
 *   - `drag-handles/column/plugin.ts`        — column drag-handle widget at the top of each column
 *   - `drag-handles/row/plugin.ts`           — row drag-handle widget at the left of each row
 *   - `selection-outline/plugin.ts`          — `selectedCell-border-*` perimeter decorations
 *
 * WHY DOM-scanning instead of ProseMirror decorations: these controls track UI
 * state (which `<table>` elements are currently rendered and need affordances),
 * not document state, so the editor DOM — not the document tree — is the
 * authoritative source. The plugin therefore walks `view.dom` per transaction
 * via `findAllTables(editor)` and keeps a `Map<HTMLElement, TableInfo>` of
 * currently-affordance'd tables.
 */

import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// local imports
import { COL_DRAG_MARKER_CLASS, DROP_MARKER_CLASS, ROW_DRAG_MARKER_CLASS } from "../drag-handles/marker-utils";
import type { TableInfo } from "./utils";
import { createColumnInsertButton, createRowInsertButton, findAllTables } from "./utils";

/**
 * Stable identifier for the table insert-affordance plugin. Used by ProseMirror
 * to register and retrieve this plugin's state from the editor view.
 */
const TABLE_INSERT_PLUGIN_KEY = new PluginKey("table-insert");

/**
 * Creates the ProseMirror plugin that manages the lifecycle of the inline "+"
 * row/column insert buttons and the drag/drop marker container for every
 * rendered table.
 *
 * Tracking:
 *   - Holds a `Map<HTMLElement, TableInfo>` keyed by each rendered `<table>` element.
 *   - Each entry stores references to the button DOM nodes and marker container
 *     so they can be removed in lockstep with their parent table.
 *
 * Reconciliation:
 *   - `updateAllTables` is invoked on every transaction that changes the
 *     document (selection-only transactions are skipped — see `view().update`).
 *   - When `!editor.isEditable`, all tracked affordances are torn down so that
 *     read-only documents render no UI controls.
 *   - Otherwise, tables newly present in the DOM get controls created and
 *     stale tracked entries whose `<table>` no longer exists are cleaned up.
 *
 * Initial mount: the first reconciliation pass is deferred via `setTimeout(0)`
 * so it runs after the editor view DOM is mounted; otherwise `view.dom` would
 * be empty on the first invocation and no tables would be discovered.
 *
 * @param editor - The TipTap editor instance the plugin attaches to.
 * @returns A ProseMirror `Plugin` keyed by {@link TABLE_INSERT_PLUGIN_KEY}.
 */
export const TableInsertPlugin = (editor: Editor): Plugin => {
  const tableMap = new Map<HTMLElement, TableInfo>();

  /**
   * Initializes affordances for a newly discovered table: creates any missing
   * column button, row button, and drag marker container; appends each to the
   * `<table>` element; and records the populated `TableInfo` in `tableMap`.
   */
  const setupTable = (tableInfo: TableInfo) => {
    const { tableElement } = tableInfo;

    // Create and add column button if it doesn't exist
    if (!tableInfo.columnButtonElement) {
      const columnButton = createColumnInsertButton(editor, tableInfo);
      tableElement.appendChild(columnButton);
      tableInfo.columnButtonElement = columnButton;
    }

    // Create and add row button if it doesn't exist
    if (!tableInfo.rowButtonElement) {
      const rowButton = createRowInsertButton(editor, tableInfo);
      tableElement.appendChild(rowButton);
      tableInfo.rowButtonElement = rowButton;
    }

    // Create and add drag marker if it doesn't exist
    if (!tableInfo.dragMarkerContainerElement) {
      const dragMarker = createMarkerContainer();
      tableElement.appendChild(dragMarker);
      tableInfo.dragMarkerContainerElement = dragMarker;
    }

    tableMap.set(tableElement, tableInfo);
  };

  /**
   * Removes all tracked DOM affordances for the given table element and
   * deletes its entry from `tableMap`. Called when the table is no longer
   * rendered, the editor becomes non-editable, or the plugin is destroyed.
   */
  const cleanupTable = (tableElement: HTMLElement) => {
    const tableInfo = tableMap.get(tableElement);
    tableInfo?.columnButtonElement?.remove();
    tableInfo?.rowButtonElement?.remove();
    tableInfo?.dragMarkerContainerElement?.remove();
    tableMap.delete(tableElement);
  };

  /**
   * Reconciles tracked tables against the currently rendered DOM:
   * tears down every entry when the editor is non-editable; otherwise removes
   * entries whose `<table>` has been unmounted and sets up newly mounted tables.
   */
  const updateAllTables = () => {
    if (!editor.isEditable) {
      // Clean up all tables if editor is not editable
      tableMap.forEach((_, tableElement) => {
        cleanupTable(tableElement);
      });
      return;
    }

    const currentTables = findAllTables(editor);
    const currentTableElements = new Set(currentTables.map((t) => t.tableElement));

    // Remove buttons from tables that no longer exist
    tableMap.forEach((_, tableElement) => {
      if (!currentTableElements.has(tableElement)) {
        cleanupTable(tableElement);
      }
    });

    // Add buttons to new tables
    currentTables.forEach((tableInfo) => {
      if (!tableMap.has(tableInfo.tableElement)) {
        setupTable(tableInfo);
      }
    });
  };

  return new Plugin({
    key: TABLE_INSERT_PLUGIN_KEY,

    /**
     * Wires reconciliation into the editor view lifecycle. The first run is
     * deferred via `setTimeout(0)` so the editor DOM exists before the scan.
     */
    view() {
      setTimeout(updateAllTables, 0);

      return {
        /**
         * Re-reconciles affordances only when the document actually changed
         * (`prevState.doc.eq(view.state.doc)` is false). Selection-only
         * transactions are intentionally skipped to avoid wasted DOM work.
         */
        update(view, prevState) {
          // Update when document changes
          if (!prevState.doc.eq(view.state.doc)) {
            updateAllTables();
          }
        },
        /**
         * Removes affordances for every tracked table and clears the tracking
         * map. Called by ProseMirror when the plugin is being destroyed.
         */
        destroy() {
          // Clean up all tables
          tableMap.forEach((_, tableElement) => {
            cleanupTable(tableElement);
          });
          tableMap.clear();
        },
      };
    },
  });
};

/**
 * Builds the non-editable container that holds the three drag/drop markers
 * used by the table drag-handle plugins for visual feedback.
 *
 * Cross-plugin contract: the container's children carry the CSS classes
 * `DROP_MARKER_CLASS`, `COL_DRAG_MARKER_CLASS`, and `ROW_DRAG_MARKER_CLASS`
 * (defined in `../drag-handles/marker-utils`). The column and row drag-handle
 * plugins look up these markers via selectors built from the same constants
 * (see `getDropMarker`, `getColDragMarker`, `getRowDragMarker` in
 * `marker-utils.ts`) — keeping the class names in sync across plugins is what
 * lets this folder OWN the marker DOM while the drag-handle folders READ it.
 *
 * WHY non-editable: the container is decorative and must not accept focus,
 * receive caret placement, or interfere with text selection — `contentEditable
 * = "false"` ensures ProseMirror treats it as an inert overlay.
 */
const createMarkerContainer = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = "table-drag-marker-container";
  el.contentEditable = "false";
  el.appendChild(createDropMarker());
  el.appendChild(createColDragMarker());
  el.appendChild(createRowDragMarker());
  return el;
};

const createDropMarker = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = DROP_MARKER_CLASS;
  return el;
};

const createColDragMarker = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = `${COL_DRAG_MARKER_CLASS} hidden`;

  return el;
};

const createRowDragMarker = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = `${ROW_DRAG_MARKER_CLASS} hidden`;

  return el;
};
