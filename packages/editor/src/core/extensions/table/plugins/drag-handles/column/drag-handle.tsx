/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Visible column-handle button at the top of each table column — opens the
 * column actions menu OR initiates drag-to-reorder.
 *
 * Mounted by `./plugin.ts`, which wraps this component in a `ReactRenderer`
 * and attaches one widget per column via a ProseMirror `Decoration.widget`.
 * Symmetric X-axis counterpart to `../row/drag-handle.tsx`: `left`/`width`
 * substitute for `top`/`height`. The axes are kept in sibling subfolders so
 * axis-specific math stays visible at a glance — keep both files in sync
 * when modifying drag UX.
 */

import {
  shift,
  flip,
  useDismiss,
  useFloating,
  useInteractions,
  autoUpdate,
  useClick,
  useRole,
  FloatingOverlay,
  FloatingPortal,
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
  selectColumn,
} from "@/extensions/table/table/utilities/helpers";
// local imports
import { moveSelectedColumns } from "../actions";
import {
  DROP_MARKER_THICKNESS,
  getColDragMarker,
  getDropMarker,
  hideDragMarker,
  hideDropMarker,
  updateColDragMarker,
  updateColDropMarker,
} from "../marker-utils";
import { showCellContent } from "../utils";
import { ColumnOptionsDropdown } from "./dropdown";
import { calculateColumnDropIndex, constructColumnDragPreview, getTableColumnNodesInfo } from "./utils";

/**
 * Props for the column drag-handle component.
 *
 * Passed by `./plugin.ts` when mounting the React renderer per column.
 *
 * @property col Zero-based column index this handle controls — used to select
 *   the column on mouse-down and to identify the dragged column for drop-index
 *   calculation.
 * @property editor Tiptap editor instance — used to dispatch transactions,
 *   resolve the current table from selection, and register/unregister the
 *   dropbar flag in `editor.storage.utility.activeDropbarExtensions`.
 */
export type ColumnDragHandleProps = {
  col: number;
  editor: Editor;
};

/**
 * Visible column drag-handle button anchored at the top of each table column.
 *
 * Two responsibilities:
 *   1. Open the `ColumnOptionsDropdown` floating panel for column-level
 *      commands (header toggle, color, insert left/right, duplicate, clear
 *      contents, delete).
 *   2. Initiate column drag-to-reorder on mouse-down.
 *
 * Accessibility / positioning: uses `@floating-ui/react` (`useFloating` with
 * `placement: "bottom-start"`, `flip` middleware with fallbacks `top-start`,
 * `bottom-start`, `top-end`, `bottom-end`, `shift({ padding: 8 })`, and
 * `autoUpdate` for live-positioning while mounted) for the dropdown anchor;
 * `useClick` / `useDismiss` / `useRole` + `useInteractions` for ARIA-correct
 * toggle behavior; `FloatingPortal` + `FloatingOverlay({ lockScroll: true })`
 * so the panel renders above the editor and blocks page scroll while open. A
 * document-level `keydown` listener installed while the panel is open closes
 * it on any key press via `context.onOpenChange(false)`.
 *
 * Drag lifecycle (`handleMouseDown`):
 *   1. Stops propagation and prevents default, then defends against zombie
 *      `mousemove` / `mouseup` listeners surviving from a prior incomplete
 *      drag by removing them from `window` and clearing the ref slots — see
 *      the cleanup notes below for why this is mandatory, not defensive.
 *   2. Resolves the current table via `findTable(editor.state.selection)` and
 *      no-ops if not in a table.
 *   3. Dispatches `selectColumn(table, col, editor.state.tr)` to select the
 *      entire dragged column.
 *   4. Measures table width via `getTableWidthPx` and per-column geometry via
 *      `getTableColumnNodesInfo`; looks up the in-table drop / drag marker
 *      DOM nodes via `getDropMarker` / `getColDragMarker`.
 *   5. Installs a window `mousemove` listener that computes pointer-derived
 *      `currentLeft`, recomputes `dropIndex` via `calculateColumnDropIndex`,
 *      lazily builds the preview column on first movement via
 *      `constructColumnDragPreview` (sized to the full table height via
 *      `getTableHeightPx` so variable row heights don't cause a visual jump),
 *      clamps the drag marker into the table bounds, and updates marker
 *      positions via `updateColDragMarker` / `updateColDropMarker`.
 *   6. Installs a window `mouseup` listener (`handleFinish`) that hides both
 *      markers, calls `showCellContent(editor)` to restore source-cell
 *      content when a `CellSelection` is active, dispatches
 *      `moveSelectedColumns` to actually reorder if the index changed, and
 *      tears down both window listeners, clearing the active-listener refs.
 *
 * Cross-extension contract (NON-NEGOTIABLE): while the dropdown is open this
 * component calls `editor.commands.addActiveDropbarExtension(
 * CORE_EXTENSIONS.TABLE)` and removes the flag on close — the removal is
 * deferred via `setTimeout(..., 0)` so the closing click can complete its
 * synchronous handlers before the flag clears. Other dropbar-aware
 * extensions (`enter-key.ts`, `placeholder.ts`, ...) READ
 * `editor.storage.utility.activeDropbarExtensions` to suppress their own
 * affordances while a dropbar is active — do NOT remove this coupling
 * (including the `setTimeout(0)`) without updating every reader.
 *
 * Cleanup: an unmount `useEffect` removes any window-level `mousemove` /
 * `mouseup` listeners still tracked in `activeListenersRef.current`. This
 * is not defensive — the host `ReactRenderer` may be destroyed by
 * `./plugin.ts` mid-drag (e.g., when the table structure changes during
 * the drag), and without the cleanup a zombie listener would survive
 * renderer destruction and crash on access to the now-stale `dropMarker`
 * / `dragMarker` from the destroyed table.
 *
 * @param props.col Zero-based column index this handle controls.
 * @param props.editor Tiptap editor instance for transactions and selection.
 */
export function ColumnDragHandle(props: ColumnDragHandleProps) {
  const { col, editor } = props;
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

      editor.view.dispatch(selectColumn(table, col, editor.state.tr));

      // drag column
      const tableWidthPx = getTableWidthPx(table, editor);
      const columns = getTableColumnNodesInfo(table, editor);

      let dropIndex = col;
      const startLeft = columns[col].left ?? 0;
      const startX = e.clientX;
      const tableElement = editor.view.nodeDOM(table.pos);

      const dropMarker = tableElement instanceof HTMLElement ? getDropMarker(tableElement) : null;
      const dragMarker = tableElement instanceof HTMLElement ? getColDragMarker(tableElement) : null;

      const handleFinish = () => {
        if (!dropMarker || !dragMarker) return;
        hideDropMarker(dropMarker);
        hideDragMarker(dragMarker);

        // Show cell content by clearing decorations
        if (isCellSelection(editor.state.selection)) {
          showCellContent(editor);
        }

        if (col !== dropIndex) {
          let tr = editor.state.tr;
          const selection = editor.state.selection;
          if (isCellSelection(selection)) {
            const table = findTable(selection);
            if (table) {
              tr = moveSelectedColumns(editor, table, selection, dropIndex, tr);
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

      let pseudoColumn: HTMLElement | undefined;

      const handleMove = (moveEvent: MouseEvent) => {
        if (!dropMarker || !dragMarker) return;
        const currentLeft = startLeft + moveEvent.clientX - startX;
        dropIndex = calculateColumnDropIndex(col, columns, currentLeft);

        if (!pseudoColumn) {
          pseudoColumn = constructColumnDragPreview(editor, editor.state.selection, table);
          const tableHeightPx = getTableHeightPx(table, editor);
          if (pseudoColumn) {
            pseudoColumn.style.height = `${tableHeightPx}px`;
          }
        }

        const dragMarkerWidthPx = columns[col].width;
        const dragMarkerLeftPx = Math.max(0, Math.min(currentLeft, tableWidthPx - dragMarkerWidthPx));
        const dropMarkerLeftPx =
          dropIndex <= col ? columns[dropIndex].left : columns[dropIndex].left + columns[dropIndex].width;

        updateColDropMarker({
          element: dropMarker,
          left: dropMarkerLeftPx - Math.floor(DROP_MARKER_THICKNESS / 2) - 1,
          width: DROP_MARKER_THICKNESS,
        });
        updateColDragMarker({
          element: dragMarker,
          left: dragMarkerLeftPx,
          width: dragMarkerWidthPx,
          pseudoColumn,
        });
      };

      try {
        // Store references for cleanup
        activeListenersRef.current.mouseup = handleFinish;
        activeListenersRef.current.mousemove = handleMove;
        window.addEventListener("mouseup", handleFinish);
        window.addEventListener("mousemove", handleMove);
      } catch (error) {
        console.error("Error in ColumnDragHandle:", error);
        handleFinish();
      }
    },
    [col, editor]
  );

  return (
    <>
      <div className="table-col-handle-container absolute top-0 left-0 z-20 flex w-full -translate-y-1/2 items-center justify-center">
        <button
          ref={refs.setReference}
          {...getReferenceProps()}
          type="button"
          onMouseDown={handleMouseDown}
          className={cn("rounded-sm border border-strong-1 bg-layer-1 px-1 transition-all duration-200 outline-none", {
            "border-accent-strong bg-accent-primary !opacity-100": isDropdownOpen,
            "hover:bg-layer-1-hover": !isDropdownOpen,
          })}
        >
          <Ellipsis className="size-4 text-primary" />
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
            <ColumnOptionsDropdown editor={editor} onClose={() => context.onOpenChange(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
