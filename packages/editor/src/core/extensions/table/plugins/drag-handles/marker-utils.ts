/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * DOM-facing marker management layer for table drag feedback. Owns the three canonical
 * CSS class constants, the marker thickness constant, and the lookup / show / hide /
 * geometry helpers used by every column and row drag-handle flow.
 *
 * Cross-plugin DOM contract:
 *   - `insert-handlers/plugin.ts` OWNS the markers' DOM existence — its
 *     `createMarkerContainer` mounts three child marker elements whose `className`
 *     attributes are stamped with the class constants exported below (see
 *     insert-handlers/plugin.ts `createDropMarker` / `createColDragMarker` /
 *     `createRowDragMarker`).
 *   - This module OWNS marker visibility and geometry — drag-handle code looks the
 *     mounted markers up via `getDropMarker` / `getColDragMarker` / `getRowDragMarker`
 *     and calls the `update*` / `hide*` helpers below to move and show/hide them as the
 *     pointer moves.
 *
 * Consumers (cross-axis + cross-plugin):
 *   - `column/drag-handle.tsx` and `row/drag-handle.tsx` — call the lookup / show / hide /
 *     position helpers during an active drag.
 *   - `column/utils.ts` and `row/utils.ts` — construct the optional `pseudoColumn` /
 *     `pseudoRow` preview nodes that drag-handle.tsx then feeds into
 *     `updateColDragMarker` / `updateRowDragMarker`.
 *
 * Plugin ownership inside `table/plugins/` (foundational reference table):
 *   | Plugin                          | Visual element owned                                          |
 *   | ------------------------------- | ------------------------------------------------------------- |
 *   | `drag-state.ts`                 | `content-hidden` decorations on cells during drag             |
 *   | `insert-handlers/plugin.ts`     | "+" buttons on row/column edges and the drag marker container |
 *   | `drag-handles/column/plugin.ts` | column drag-handle widget at top of each column               |
 *   | `drag-handles/row/plugin.ts`    | row drag-handle widget at left of each row                    |
 *   | `selection-outline/plugin.ts`   | `selectedCell-border-*` decorations on cell perimeter         |
 *
 * No DOM state is held in this module: every function is a pure pass-through over an
 * `HTMLElement` reference the caller has already located. That keeps the marker layer
 * stateless and trivially testable.
 */

/**
 * CSS class names that form the shared DOM-layer contract between
 * `insert-handlers/plugin.ts` (which stamps them onto the marker container's children via
 * `createDropMarker` / `createColDragMarker` / `createRowDragMarker`) and the drag-handle
 * code in this folder (which looks them up via the matching `get*` helpers below).
 *
 *   - `DROP_MARKER_CLASS` — a thin vertical or horizontal line shown at the prospective
 *     drop position during a drag.
 *   - `COL_DRAG_MARKER_CLASS` — a column-shaped marker container that hosts the optional
 *     pseudo-column drag preview (a clone of the selected column's cells, used when one
 *     column is selected).
 *   - `ROW_DRAG_MARKER_CLASS` — a row-shaped marker container that hosts the optional
 *     pseudo-row drag preview (a clone of the selected row's cells, used when one row is
 *     selected).
 */
export const DROP_MARKER_CLASS = "table-drop-marker";
export const COL_DRAG_MARKER_CLASS = "table-col-drag-marker";
export const ROW_DRAG_MARKER_CLASS = "table-row-drag-marker";

/**
 * Pixel thickness of the drop-indicator line. The rendered thickness is governed by the
 * stylesheet; this constant exists so callers that need to reason about the value
 * programmatically (e.g. centering the marker on a column boundary) have a single source
 * of truth.
 */
export const DROP_MARKER_THICKNESS = 2;

/**
 * Finds the drop-marker DOM node within a table's marker container by class.
 *
 * Search scope is descendants of `tableElement`. Returns `null` when the markers were
 * never mounted (e.g. before `insert-handlers/plugin.ts` initialised this table).
 *
 * @param tableElement - the table-host element whose descendants are searched.
 * @returns the matching marker element, or `null` if it has not been mounted yet.
 */
export const getDropMarker = (tableElement: HTMLElement): HTMLElement | null =>
  tableElement.querySelector(`.${DROP_MARKER_CLASS}`);

/**
 * Idempotently hides the drop marker by adding the `hidden` class only when it is not
 * already present.
 *
 * Idempotency is required because drag-handle code dispatches `mousemove` events at full
 * pointer cadence (60+ per second on modern hardware); a no-op when already hidden avoids
 * unnecessary class-list mutation on every pointer tick.
 *
 * @param element - the drop-marker element to hide.
 */
export const hideDropMarker = (element: HTMLElement): void => {
  if (!element.classList.contains("hidden")) {
    element.classList.add("hidden");
  }
};

/**
 * Positions the column drop marker as a full-height vertical line at the prospective drop
 * column boundary and reveals it by removing the `hidden` class. `left` and `width` are
 * in pixels, relative to the table's marker container coordinate space.
 *
 * Side effects: writes `style.height`, `style.width`, `style.top`, `style.left` directly,
 * and removes the `hidden` class.
 *
 * @param params.element - the column drop-marker element to position and reveal.
 * @param params.left - x offset of the marker within the marker container, in pixels.
 * @param params.width - rendered width of the marker line, in pixels.
 */
export const updateColDropMarker = ({
  element,
  left,
  width,
}: {
  element: HTMLElement;
  left: number;
  width: number;
}) => {
  element.style.height = "100%";
  element.style.width = `${width}px`;
  element.style.top = "0";
  element.style.left = `${left}px`;
  element.classList.remove("hidden");
};

/**
 * Positions the row drop marker as a full-width horizontal line at the prospective drop
 * row boundary and reveals it by removing the `hidden` class. `top` and `height` are in
 * pixels, relative to the table's marker container coordinate space.
 *
 * Side effects: writes `style.width`, `style.height`, `style.left`, `style.top` directly,
 * and removes the `hidden` class.
 *
 * @param params.element - the row drop-marker element to position and reveal.
 * @param params.top - y offset of the marker within the marker container, in pixels.
 * @param params.height - rendered height of the marker line, in pixels.
 */
export const updateRowDropMarker = ({
  element,
  top,
  height,
}: {
  element: HTMLElement;
  top: number;
  height: number;
}) => {
  element.style.width = "100%";
  element.style.height = `${height}px`;
  element.style.left = "0";
  element.style.top = `${top}px`;
  element.classList.remove("hidden");
};

/**
 * Finds the column drag-marker DOM node within a table's marker container by class.
 *
 * @param tableElement - the table-host element whose descendants are searched.
 * @returns the matching marker element, or `null` if it has not been mounted yet.
 */
export const getColDragMarker = (tableElement: HTMLElement): HTMLElement | null =>
  tableElement.querySelector(`.${COL_DRAG_MARKER_CLASS}`);

/**
 * Finds the row drag-marker DOM node within a table's marker container by class.
 *
 * @param tableElement - the table-host element whose descendants are searched.
 * @returns the matching marker element, or `null` if it has not been mounted yet.
 */
export const getRowDragMarker = (tableElement: HTMLElement): HTMLElement | null =>
  tableElement.querySelector(`.${ROW_DRAG_MARKER_CLASS}`);

/**
 * Idempotently hides the drag marker by adding the `hidden` class only when it is not
 * already present.
 *
 * Structurally identical to `hideDropMarker` but kept as a separate symbol so call sites
 * explicitly name the marker type they are hiding (drop marker vs. drag marker).
 * Idempotency is required for the same reason as `hideDropMarker` — the mouse-move event
 * cadence forbids per-pixel class-list churn.
 *
 * @param element - the drag-marker element to hide.
 */
export const hideDragMarker = (element: HTMLElement): void => {
  if (!element.classList.contains("hidden")) {
    element.classList.add("hidden");
  }
};

/**
 * Positions the column drag marker at the dragged column's geometry and, when
 * `pseudoColumn` is provided, replaces its content with a deep clone of that preview node.
 *
 * The drag preview has two visual variants:
 *   - `pseudoColumn` supplied — a column-shaped clone of the originally selected cells,
 *     constructed by `column/utils.ts`. Used when the user is dragging a single column.
 *   - `pseudoColumn` omitted — just the thin coloured marker bar. Used when the user is
 *     dragging multiple selected columns, where a single clone would be misleading.
 *
 * Side effects: writes `style.left` and `style.width`; removes the `hidden` class; when
 * `pseudoColumn` is supplied, clears the marker's existing children and appends a deep
 * clone of the preview.
 *
 * @param params.element - the column drag-marker element to position and (optionally) refill.
 * @param params.left - x offset of the marker within the marker container, in pixels.
 * @param params.width - rendered width of the marker, in pixels.
 * @param params.pseudoColumn - optional column-shaped preview node to clone into the marker.
 */
export const updateColDragMarker = ({
  element,
  left,
  width,
  pseudoColumn,
}: {
  element: HTMLElement;
  left: number;
  width: number;
  pseudoColumn: HTMLElement | undefined;
}) => {
  element.style.left = `${left}px`;
  element.style.width = `${width}px`;
  element.classList.remove("hidden");
  if (pseudoColumn) {
    /// clear existing content
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    // clone and append the pseudo column
    element.appendChild(pseudoColumn.cloneNode(true));
  }
};

/**
 * Positions the row drag marker at the dragged row's geometry and, when `pseudoRow` is
 * provided, replaces its content with a deep clone of that preview node.
 *
 * The drag preview has two visual variants:
 *   - `pseudoRow` supplied — a row-shaped clone of the originally selected cells,
 *     constructed by `row/utils.ts`. Used when the user is dragging a single row.
 *   - `pseudoRow` omitted — just the thin coloured marker bar. Used when the user is
 *     dragging multiple selected rows, where a single clone would be misleading.
 *
 * Side effects: writes `style.top` and `style.height`; removes the `hidden` class; when
 * `pseudoRow` is supplied, clears the marker's existing children and appends a deep
 * clone of the preview.
 *
 * @param params.element - the row drag-marker element to position and (optionally) refill.
 * @param params.top - y offset of the marker within the marker container, in pixels.
 * @param params.height - rendered height of the marker, in pixels.
 * @param params.pseudoRow - optional row-shaped preview node to clone into the marker.
 */
export const updateRowDragMarker = ({
  element,
  top,
  height,
  pseudoRow,
}: {
  element: HTMLElement;
  top: number;
  height: number;
  pseudoRow: HTMLElement | undefined;
}) => {
  element.style.top = `${top}px`;
  element.style.height = `${height}px`;
  element.classList.remove("hidden");
  if (pseudoRow) {
    /// clear existing content
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    // clone and append the pseudo row
    element.appendChild(pseudoRow.cloneNode(true));
  }
};
