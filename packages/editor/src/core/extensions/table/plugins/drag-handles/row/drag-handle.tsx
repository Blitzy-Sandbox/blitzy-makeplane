/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Visible row-handle button at the LEFT of each table row — opens the row
 * actions menu OR initiates drag-to-reorder on mouse-down.
 *
 * Mounted by `./plugin.ts`, which wraps this component in a `ReactRenderer`
 * and attaches one widget per row via a ProseMirror `Decoration.widget`.
 *
 * Symmetric Y-axis counterpart to `../column/drag-handle.tsx` — substitute
 * `top`/`height` here for `left`/`width` in the column file. The axes live in
 * separate subfolders so the axis-specific math is visible at a glance; do
 * NOT merge them "for DRY" — the symmetric split keeps the row-vs-column
 * logic review tractable.
 */

import {
  autoUpdate,
  flip,
  FloatingOverlay,
  FloatingPortal,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import type { Editor } from "@tiptap/core";
import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
// plane imports
import { cn } from "@plane/utils";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import {
  findTable,
  getTableHeightPx,
  getTableWidthPx,
  isCellSelection,
  selectRow,
} from "@/extensions/table/table/utilities/helpers";
// local imports
import { moveSelectedRows } from "../actions";
import {
  DROP_MARKER_THICKNESS,
  getDropMarker,
  getRowDragMarker,
  hideDragMarker,
  hideDropMarker,
  updateRowDragMarker,
  updateRowDropMarker,
} from "../marker-utils";
import { showCellContent } from "../utils";
import { RowOptionsDropdown } from "./dropdown";
import { calculateRowDropIndex, constructRowDragPreview, getTableRowNodesInfo } from "./utils";

/**
 * Props for the row drag-handle component.
 *
 * Passed by `./plugin.ts` when mounting the React renderer per row.
 *
 * @property editor Tiptap `Editor` instance — used to dispatch transactions,
 *   resolve the current table from selection, and register/unregister the
 *   active-dropbar flag while the row menu is open.
 * @property row Zero-based row index this handle controls — used to select the
 *   row on mousedown and to identify the dragged row for drop-index
 *   calculation during `mousemove`.
 */
export type RowDragHandleProps = {
  editor: Editor;
  row: number;
};

/**
 * Visible row drag-handle button anchored at the LEFT of each table row.
 *
 * Two responsibilities:
 *   1. Open the `RowOptionsDropdown` floating panel for row-level commands
 *      (insert above/below, duplicate, toggle header row, set row color,
 *      clear contents, delete).
 *   2. Initiate row drag-to-reorder on mouse-down.
 *
 * Accessibility / positioning: uses `@floating-ui/react` (`useFloating` with
 * `placement: "bottom-start"`, `flip` middleware with fallbacks `top-start`,
 * `bottom-start`, `top-end`, `bottom-end`, `shift({ padding: 8 })`, and
 * `autoUpdate`) for live-positioned panel placement; `useClick` / `useDismiss`
 * / `useRole` + `useInteractions` for ARIA-correct toggle behavior;
 * `FloatingPortal` + `FloatingOverlay({ lockScroll: true })` to render above
 * the editor and block background scroll. A document-level `keydown` listener
 * installed while open closes the panel on any key press (Escape and friends)
 * via `context.onOpenChange(false)`.
 *
 * Drag lifecycle (`handleMouseDown`):
 *   1. Stops propagation and prevents default.
 *   2. Defends against zombie listeners from prior incomplete drags by
 *      removing any `mousemove` / `mouseup` listeners still tracked in
 *      `activeListenersRef.current` before installing fresh ones.
 *   3. Resolves the current table via `findTable`; no-ops if not in a table.
 *   4. Selects the entire dragged row via `selectRow(table, row, tr)` and
 *      dispatches the transaction.
 *   5. Measures table height via `getTableHeightPx` and per-row geometry via
 *      `getTableRowNodesInfo`.
 *   6. Looks up the in-table drop-marker and drag-marker DOM nodes via
 *      `getDropMarker` / `getRowDragMarker`.
 *   7. Installs a window `mousemove` listener that recomputes `dropIndex` via
 *      `calculateRowDropIndex`, lazily builds the preview row on first move
 *      via `constructRowDragPreview` (matching the table width via
 *      `getTableWidthPx` so explicit-column-width tables do not visually
 *      jump), and updates marker positions via `updateRowDragMarker` /
 *      `updateRowDropMarker`.
 *   8. Installs a window `mouseup` listener (`handleFinish`) that hides both
 *      markers, calls `showCellContent` to restore hidden source cells if a
 *      `CellSelection` is active, dispatches `moveSelectedRows` to actually
 *      reorder iff the index changed, and clears both window listeners + the
 *      active-listener refs.
 *
 * Cross-extension contract (NON-NEGOTIABLE): while the dropdown is open this
 * component calls `editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS
 * .TABLE)` and on close calls `removeActiveDropbarExtension` (deferred via
 * `setTimeout(..., 0)` so the close-click's synchronous handlers still see
 * the flag). Other dropbar-aware extensions (`enter-key.ts`, slash-commands,
 * mention/emoji suggestions, ...) READ `editor.storage.utility
 * .activeDropbarExtensions` to suppress their own affordances while a dropbar
 * is active — do NOT remove this coupling without updating all readers.
 *
 * Cleanup: an unmount `useEffect` removes any window-level `mousemove` /
 * `mouseup` listeners still tracked in `activeListenersRef.current`, guarding
 * against zombie listeners if `./plugin.ts` tears down the renderer mid-drag
 * (which happens whenever the table structure changes).
 */
export function RowDragHandle(props: RowDragHandleProps) {
  const { editor, row } = props;
  // states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Track active event listeners for cleanup
  const activeListenersRef = useRef<{
    mouseup?: (e: MouseEvent) => void;
    mousemove?: (e: MouseEvent) => void;
  }>({});

  // Cleanup window event listeners on unmount
  useEffect(() => {
    const listenersRef = activeListenersRef.current;
    return () => {
      // Remove any lingering window event listeners when component unmounts
      if (listenersRef.mouseup) {
        window.removeEventListener("mouseup", listenersRef.mouseup);
      }
      if (listenersRef.mousemove) {
        window.removeEventListener("mousemove", listenersRef.mousemove);
      }
    };
  }, []);
  // floating ui
  const { refs, floatingStyles, context } = useFloating({
    placement: "bottom-start",
    middleware: [
      flip({
        fallbackPlacements: ["top-start", "bottom-start", "top-end", "bottom-end"],
      }),
      shift({
        padding: 8,
      }),
    ],
    open: isDropdownOpen,
    onOpenChange: (open) => {
      setIsDropdownOpen(open);
      if (open) {
        editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.TABLE);
      } else {
        setTimeout(() => {
          editor.commands.removeActiveDropbarExtension(CORE_EXTENSIONS.TABLE);
        }, 0);
      }
    },
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, click, role]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      context.onOpenChange(false);
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDropdownOpen, context]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();

      // Prevent multiple simultaneous drag operations
      // If there are already listeners attached, remove them first
      if (activeListenersRef.current.mouseup) {
        window.removeEventListener("mouseup", activeListenersRef.current.mouseup);
      }
      if (activeListenersRef.current.mousemove) {
        window.removeEventListener("mousemove", activeListenersRef.current.mousemove);
      }
      activeListenersRef.current.mouseup = undefined;
      activeListenersRef.current.mousemove = undefined;

      const table = findTable(editor.state.selection);
      if (!table) return;

      editor.view.dispatch(selectRow(table, row, editor.state.tr));

      // drag row
      const tableHeightPx = getTableHeightPx(table, editor);
      const rows = getTableRowNodesInfo(table, editor);

      let dropIndex = row;
      const startTop = rows[row].top ?? 0;
      const startY = e.clientY;
      const tableElement = editor.view.nodeDOM(table.pos);

      const dropMarker = tableElement instanceof HTMLElement ? getDropMarker(tableElement) : null;
      const dragMarker = tableElement instanceof HTMLElement ? getRowDragMarker(tableElement) : null;

      const handleFinish = (): void => {
        if (!dropMarker || !dragMarker) return;
        hideDropMarker(dropMarker);
        hideDragMarker(dragMarker);

        // Show cell content by clearing decorations
        if (isCellSelection(editor.state.selection)) {
          showCellContent(editor);
        }

        if (row !== dropIndex) {
          let tr = editor.state.tr;
          const selection = editor.state.selection;
          if (isCellSelection(selection)) {
            const table = findTable(selection);
            if (table) {
              tr = moveSelectedRows(editor, table, selection, dropIndex, tr);
            }
          }
          editor.view.dispatch(tr);
        }
        window.removeEventListener("mouseup", handleFinish);
        window.removeEventListener("mousemove", handleMove);
        // Clear the ref
        activeListenersRef.current.mouseup = undefined;
        activeListenersRef.current.mousemove = undefined;
      };

      let pseudoRow: HTMLElement | undefined;

      const handleMove = (moveEvent: MouseEvent): void => {
        if (!dropMarker || !dragMarker) return;
        const cursorTop = startTop + moveEvent.clientY - startY;
        dropIndex = calculateRowDropIndex(row, rows, cursorTop);

        if (!pseudoRow) {
          pseudoRow = constructRowDragPreview(editor, editor.state.selection, table);
          const tableWidthPx = getTableWidthPx(table, editor);
          if (pseudoRow) {
            pseudoRow.style.width = `${tableWidthPx}px`;
          }
        }

        const dragMarkerHeightPx = rows[row].height;
        const dragMarkerTopPx = Math.max(0, Math.min(cursorTop, tableHeightPx - dragMarkerHeightPx));
        const dropMarkerTopPx = dropIndex <= row ? rows[dropIndex].top : rows[dropIndex].top + rows[dropIndex].height;

        updateRowDropMarker({
          element: dropMarker,
          top: dropMarkerTopPx - DROP_MARKER_THICKNESS / 2,
          height: DROP_MARKER_THICKNESS,
        });
        updateRowDragMarker({
          element: dragMarker,
          top: dragMarkerTopPx,
          height: dragMarkerHeightPx,
          pseudoRow,
        });
      };

      try {
        // Store references for cleanup
        activeListenersRef.current.mouseup = handleFinish;
        activeListenersRef.current.mousemove = handleMove;
        window.addEventListener("mouseup", handleFinish);
        window.addEventListener("mousemove", handleMove);
      } catch (error) {
        console.error("Error in RowDragHandle:", error);
        handleFinish();
      }
    },
    [editor, row]
  );

  return (
    <>
      <div className="table-row-handle-container absolute top-0 left-0 z-20 flex h-full -translate-x-1/2 items-center justify-center">
        <button
          ref={refs.setReference}
          {...getReferenceProps()}
          type="button"
          onMouseDown={handleMouseDown}
          className={cn("rounded-sm border border-strong-1 bg-layer-1 py-1 transition-all duration-200 outline-none", {
            "border-accent-strong bg-accent-primary !opacity-100": isDropdownOpen,
            "hover:bg-layer-1-hover": !isDropdownOpen,
          })}
        >
          <Ellipsis className="size-4 rotate-90 text-primary" />
        </button>
      </div>
      {isDropdownOpen && (
        <FloatingPortal>
          {/* Backdrop */}
          <FloatingOverlay
            style={{
              zIndex: 99,
            }}
            lockScroll
          />
          <div
            className="max-h-[90vh] w-[12rem] overflow-y-auto rounded-md border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 shadow-raised-200"
            ref={refs.setFloating}
            {...getFloatingProps()}
            style={{
              ...floatingStyles,
              zIndex: 100,
            }}
          >
            <RowOptionsDropdown editor={editor} onClose={() => context.onOpenChange(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
