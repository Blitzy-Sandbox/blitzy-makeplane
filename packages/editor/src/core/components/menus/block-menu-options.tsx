/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Node-specific menu options consumed by the `BlockMenu` component (see `./block-menu.tsx`);
 * currently scoped to table behavior only.
 *
 * The exported {@link getNodeOptions} factory is spread into `BlockMenu`'s `MENU_ITEMS`
 * composition after the fixed delete/duplicate actions, so that node-context-sensitive rows
 * appear conditionally based on the current selection.
 *
 * TipTap framing: this module overrides the default `@tiptap/extension-table` column-width
 * behavior by recomputing widths from the editor container's `--editor-content-width` CSS
 * variable rather than from manual resize gestures. It does NOT register a new TipTap
 * extension — it dispatches direct ProseMirror transactions against the existing table
 * extension's nodes.
 *
 * Contributor note: additional node-specific options should be added here in
 * {@link getNodeOptions}, NOT to the fixed-actions array in `block-menu.tsx`, to preserve
 * the separation between fixed (delete / duplicate) actions and node-context-sensitive ones.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import type { Editor } from "@tiptap/react";
import { MoveHorizontal } from "lucide-react";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import type { BlockMenuOption } from "./block-menu";

/**
 * Identifies whether the current selection's first content child is a TipTap table node
 * (`CORE_EXTENSIONS.TABLE`) and returns its node + document position, or null when no table
 * is in selection.
 *
 * Centralizing the lookup avoids divergent table-detection logic across helpers — every
 * subsequent table-mutation helper in this module depends on this to know whether to
 * short-circuit.
 *
 * @param editor The TipTap {@link Editor} whose current selection is inspected.
 * @returns `{ tableNode, tablePos }` when the first selected node is a table; otherwise
 *   `{ tableNode: null, tablePos: -1 }`. See the inline TypeScript annotation for the
 *   precise return shape (`ProseMirrorNode | null` for the node).
 */
const findSelectedTable = (editor: Editor): { tableNode: ProseMirrorNode | null; tablePos: number } => {
  const { state } = editor;
  const selectedNode = state.selection.content().content.firstChild;

  if (selectedNode?.type.name === CORE_EXTENSIONS.TABLE) {
    return {
      tableNode: selectedNode,
      tablePos: state.selection.from,
    };
  }

  return { tableNode: null, tablePos: -1 };
};

/**
 * Rewrites every cell's `colwidth` attribute in the currently-selected table so the table
 * fills the editor's available content width — the `--editor-content-width` CSS variable on
 * the `.editor-container` ancestor.
 *
 * TipTap behavior: overrides the default `@tiptap/extension-table` column-width persistence
 * (which retains widths set by manual resize gestures). After this command runs, every cell
 * receives an equal width computed as `Math.floor(contentWidth / map.width)`.
 *
 * Side effects: dispatches a single ProseMirror transaction (`view.dispatch(tr)`) that calls
 * `setNodeMarkup` on every cell. Merged cells — whose `cellPos` appears multiple times in
 * `TableMap.map` (once per spanned col×row) — are tracked via the `updatedCells` Set so the
 * same cell position is not rewritten twice within the same transaction.
 *
 * Error handling: any failure (missing `.editor-container` ancestor, malformed CSS variable,
 * invalid selection, ProseMirror transaction failure) is caught and logged via
 * `console.error`. The envelope intentionally swallows the exception so a malformed editor
 * environment cannot crash the block menu — the user sees no effect, not a stack trace.
 *
 * Implementation notes (WHY):
 * - Width is read from the CSS variable rather than from any DOM `clientWidth` measurement,
 *   because `--editor-content-width` is the source of truth that the editor's display config
 *   (e.g. `wideLayout`) writes to; reading from CSS keeps the helper responsive to that
 *   configuration without separate prop or hook wiring.
 * - Merged cells set `colwidth: Array(colspan).fill(equalWidth)` because
 *   `@tiptap/extension-table` serializes `colwidth` as an array of per-spanned-column widths
 *   — a `colspan=2` cell expects `[width, width]`, not a single value.
 *
 * @param editor The TipTap {@link Editor} whose currently-selected table is resized in place.
 */
const setTableToFullWidth = (editor: Editor): void => {
  try {
    const { state, view } = editor;

    // Find the selected table
    const { tableNode, tablePos } = findSelectedTable(editor);
    if (!tableNode) return;

    // Get content width from CSS variable
    const editorContainer = view.dom.closest(".editor-container");
    if (!editorContainer) return;

    const contentWidthVar = getComputedStyle(editorContainer).getPropertyValue("--editor-content-width").trim();
    if (!contentWidthVar) return;

    const contentWidth = parseInt(contentWidthVar);
    if (isNaN(contentWidth) || contentWidth <= 0) return;

    // Calculate equal width for each column
    const map = TableMap.get(tableNode);
    const equalWidth = Math.floor(contentWidth / map.width);

    // Update all cell widths
    const tr = state.tr;
    const tableStart = tablePos + 1;
    const updatedCells = new Set<number>();

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const cellIndex = row * map.width + col;
        const cellPos = map.map[cellIndex];

        // Skip if cell already updated (for merged cells)
        if (updatedCells.has(cellPos)) continue;

        const cell = state.doc.nodeAt(tableStart + cellPos);
        if (!cell) continue;

        // Handle colspan for merged cells
        const colspan = cell.attrs.colspan || 1;
        tr.setNodeMarkup(tableStart + cellPos, null, {
          ...cell.attrs,
          colwidth: Array(colspan).fill(equalWidth),
        });

        updatedCells.add(cellPos);
      }
    }

    view.dispatch(tr);
  } catch (error) {
    console.error("Error setting table to full width:", error);
  }
};

/**
 * Returns the {@link BlockMenuOption} array of node-specific actions for the current
 * selection (empty when no node-specific options apply).
 *
 * Currently exposes only the "Fit to width" action, which is gated by
 * `editor.isActive(CORE_EXTENSIONS.TABLE)` so the row is hidden outside of table selections.
 *
 * Behavior note (WHY): `BlockMenu` reads `isDisabled` to filter the row out of the rendered
 * menu rather than rendering it as a disabled button, so non-applicable node-specific
 * options never appear in the user-visible menu.
 *
 * @param editor The TipTap {@link Editor} whose active node determines which options apply.
 * @returns A {@link BlockMenuOption} array; see `./block-menu.tsx` for the type definition.
 */
export const getNodeOptions = (editor: Editor): BlockMenuOption[] => [
  {
    icon: MoveHorizontal,
    key: "table-full-width",
    label: "Fit to width",
    isDisabled: !editor.isActive(CORE_EXTENSIONS.TABLE),
    onClick: () => setTableToFullWidth(editor),
  },
];
