/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical `Table` Node extension for the Plane editor.
 *
 * Defines the top-level `table` ProseMirror node (`tableRole: "table"`,
 * `content: "tableRow+"`, `isolating: true`, `group: "block"`) and wires
 * together the editor's table feature: the full command surface
 * (`insertTable`, `addColumnAfter`, `deleteRow`, `mergeCells`, etc.), the
 * keyboard shortcuts (`Tab`/`Shift-Tab` navigation, `Backspace`/`Delete`
 * cell-selection-aware deletion, `ArrowDown`/`ArrowUp` insert-line-around-
 * table), the custom `TableView` React NodeView for `<colgroup>`-driven
 * column layout, and the ProseMirror plugin stack (`columnResizing`,
 * `tableEditing`, `TableDragStatePlugin`, `TableInsertPlugin`,
 * `TableColumnDragHandlePlugin`, `TableRowDragHandlePlugin`) that gives
 * tables their drag-handles, insert affordances, and selection outline UX.
 *
 * First-party note (AAP §0.2.2):
 *   Although this extension parallels `@tiptap/extension-table`, it is
 *   built from scratch via `Node.create<TableOptions>()` from `@tiptap/core`
 *   and depends on the ProseMirror table primitives from `@tiptap/pm/tables`
 *   (notably `tableEditing`, `columnResizing`, `addColumnAfter`,
 *   `addRowAfter`, etc.). Treat this code as owned; the Exposes / Overrides
 *   / Hides triplet on the `Table` declaration below documents the
 *   conceptual relationship with the upstream package, not a runtime
 *   import dependency.
 */

import type { ParentConfig } from "@tiptap/core";
import { callOrReturn, getExtensionField, mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteCellSelection,
  deleteTable,
  fixTables,
  goToNextCell,
  mergeCells,
  setCellAttr,
  splitCell,
  tableEditing,
  toggleHeader,
  toggleHeaderCell,
} from "@tiptap/pm/tables";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// local imports
import { TableDragStatePlugin } from "../plugins/drag-state";
import { TableColumnDragHandlePlugin } from "../plugins/drag-handles/column/plugin";
import { TableRowDragHandlePlugin } from "../plugins/drag-handles/row/plugin";
import { TableInsertPlugin } from "../plugins/insert-handlers/plugin";
import { TableView } from "./table-view";
import { createTable } from "./utilities/create-table";
import { deleteColumnOrTable } from "./utilities/delete-column";
import { handleDeleteKeyOnTable } from "./utilities/delete-key-shortcut";
import { deleteRowOrTable } from "./utilities/delete-row";
import { insertLineAboveTableAction } from "./utilities/insert-line-above-table-action";
import { insertLineBelowTableAction } from "./utilities/insert-line-below-table-action";
import { DEFAULT_COLUMN_WIDTH } from ".";

/**
 * Options accepted by the `Table` extension.
 *
 * - `HTMLAttributes`: merged into the rendered `<table>` tag.
 * - `resizable`: when `true`, the `columnResizing` plugin from
 *   `@tiptap/pm/tables` is prepended to the plugin stack so users can
 *   drag column borders to resize.
 * - `handleWidth` (px): hit-area width of the column resize handle that
 *   `columnResizing` listens on.
 * - `cellMinWidth` (px): minimum column width the resizer enforces;
 *   also passed to `TableView` so the `<colgroup>` can clamp `<col>`
 *   widths during re-renders.
 * - `lastColumnResizable`: when `true`, the rightmost column gets a
 *   resize handle too (upstream default; preserved for parity).
 * - `allowTableNodeSelection`: when `true`, the entire table node can
 *   be selected as a single ProseMirror NodeSelection (e.g., via the
 *   row/column drag-handle "select table" affordance).
 */
type TableOptions = {
  HTMLAttributes: Record<string, unknown>;
  resizable: boolean;
  handleWidth: number;
  cellMinWidth: number;
  lastColumnResizable: boolean;
  allowTableNodeSelection: boolean;
};

/**
 * TypeScript module augmentation that registers the table command surface
 * on `Commands<ReturnType>` (so consumers can call
 * `editor.commands.insertTable(...)` with full type safety) and adds the
 * `tableRole` optional field to `NodeConfig` (so any node spec, not just
 * this one, can declare `tableRole: "table" | "row" | "cell" | "header_cell"`
 * to participate in `@tiptap/pm/tables` schema lookup).
 *
 * Exposed commands (full set, in declaration order):
 *   `insertTable({ rows?, cols?, withHeaderRow? })`, `addColumnBefore()`,
 *   `addColumnAfter()`, `deleteColumn()`, `addRowBefore()`, `addRowAfter()`,
 *   `deleteRow()`, `deleteTable()`, `mergeCells()`, `splitCell()`,
 *   `toggleHeaderColumn()`, `toggleHeaderRow()`, `toggleHeaderCell()`,
 *   `clearSelectedCells()`, `mergeOrSplit()`, `setCellAttribute(name, value)`,
 *   `goToNextCell()`, `goToPreviousCell()`, `fixTables()`,
 *   `setCellSelection({ anchorCell, headCell? })`.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.TABLE]: {
      insertTable: (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => ReturnType;
      addColumnBefore: () => ReturnType;
      addColumnAfter: () => ReturnType;
      deleteColumn: () => ReturnType;
      addRowBefore: () => ReturnType;
      addRowAfter: () => ReturnType;
      deleteRow: () => ReturnType;
      deleteTable: () => ReturnType;
      mergeCells: () => ReturnType;
      splitCell: () => ReturnType;
      toggleHeaderColumn: () => ReturnType;
      toggleHeaderRow: () => ReturnType;
      toggleHeaderCell: () => ReturnType;
      clearSelectedCells: () => ReturnType;
      mergeOrSplit: () => ReturnType;
      setCellAttribute: (name: string, value: any) => ReturnType;
      goToNextCell: () => ReturnType;
      goToPreviousCell: () => ReturnType;
      fixTables: () => ReturnType;
      setCellSelection: (position: { anchorCell: number; headCell?: number }) => ReturnType;
    };
  }

  interface NodeConfig<Options, Storage> {
    tableRole?:
      | string
      | ((this: {
          name: string;
          options: Options;
          storage: Storage;
          parent: ParentConfig<NodeConfig<Options>>["tableRole"];
        }) => string);
  }
}

/**
 * Plane editor's `Table` Node extension — the canonical implementation of
 * the top-level `table` node and the wiring point for the table feature's
 * commands, keyboard shortcuts, NodeView, and ProseMirror plugin stack.
 *
 * First-party note (AAP §0.2.2):
 *   Although this extension parallels `@tiptap/extension-table`, it is
 *   built from scratch via `Node.create<>()` from `@tiptap/core` and
 *   depends on the ProseMirror table primitives from `@tiptap/pm/tables`.
 *   The triplet below documents the conceptual relationship with the
 *   upstream package, not a runtime import dependency.
 *
 * Exposes (parity with `@tiptap/extension-table`):
 *   - Schema node named `CORE_EXTENSIONS.TABLE` (`"table"`)
 *   - `content: "tableRow+"` — table contains one or more `TableRow` children
 *   - `tableRole: "table"` — wires this node into `@tiptap/pm/tables`'
 *     `tableEditing`, `addColumnAfter`, `deleteRow`, etc. so they recognize
 *     the table boundary
 *   - `isolating: true` — selection cannot cross the table boundary
 *   - `group: "block"` — the table is a block-level node
 *   - `allowGapCursor: false` — no gap-cursor is rendered immediately before
 *     or after the table (the editor uses the `ArrowUp`/`ArrowDown`
 *     shortcuts below to navigate around the table instead)
 *   - `parseHTML` matching `<table>` elements
 *   - `renderHTML` emitting `["table", attrs, ["tbody", 0]]`
 *   - Full canonical command surface declared in the module augmentation
 *     above: `insertTable`, `addColumnBefore`, `addColumnAfter`,
 *     `deleteColumn`, `addRowBefore`, `addRowAfter`, `deleteRow`,
 *     `deleteTable`, `mergeCells`, `splitCell`, `toggleHeaderColumn`,
 *     `toggleHeaderRow`, `toggleHeaderCell`, `clearSelectedCells`,
 *     `mergeOrSplit`, `setCellAttribute`, `goToNextCell`,
 *     `goToPreviousCell`, `fixTables`, `setCellSelection`. Each delegates
 *     to the matching `@tiptap/pm/tables` primitive (or, for `deleteColumn`
 *     and `deleteRow`, to the Plane utility wrappers that fall back to
 *     `deleteTable` when only one column/row remains).
 *   - `extendNodeSchema` callback that resolves `tableRole` from any other
 *     extension's options/storage via `callOrReturn` + `getExtensionField`
 *     — enables sibling node extensions (`TableCell`, `TableHeader`,
 *     `TableRow`) to declare their role statically or via a callback.
 *
 * Overrides (vs `@tiptap/extension-table`):
 *   - `insertTable` command: builds the new table via the LOCAL
 *     `createTable` utility (`./utilities/create-table.ts`) — which routes
 *     cell/row/header-cell construction through the schema-agnostic
 *     `getTableNodeTypes(schema)` helper rather than hard-coding the
 *     Plane node names — then `replaceSelectionWith(node).scrollIntoView()`
 *     and finally places the caret inside the first cell via
 *     `TextSelection.near(tr.doc.resolve(offset))`. WHY: the upstream
 *     pattern doesn't `scrollIntoView()` after insert and assumes its own
 *     schema's node names; routing through the schema-agnostic utility
 *     keeps the extension portable to any schema that registers
 *     `tableRole`-tagged nodes.
 *   - `deleteColumn` command: delegated to `deleteColumnOrTable`
 *     (`./utilities/delete-column.ts`), which deletes the whole table
 *     when only one column remains instead of leaving an empty
 *     zero-column table. Symmetric override for `deleteRow` via
 *     `deleteRowOrTable` (`./utilities/delete-row.ts`).
 *   - `addNodeView` returns a `TableView` instance (from `./table-view.tsx`)
 *     — replaces upstream's vanilla DOM `<table>` renderer with a custom
 *     NodeView that paints a `<colgroup>` of explicit `<col>` elements so
 *     `updateColumnsOnResize` from `@tiptap/pm/tables` can enforce
 *     deterministic column widths during edits. WHY: without explicit
 *     `<colgroup>` widths, cell widths flex with content and the
 *     drag-handle pixel math becomes unreliable.
 *   - `addKeyboardShortcuts` overrides:
 *       * `Tab` / `Shift-Tab`: route to `goToNextCell` / `goToPreviousCell`
 *         UNLESS the active selection is inside a `LIST_ITEM` or
 *         `TASK_ITEM` (which need Tab for list indent), in which case the
 *         shortcut returns `false` so the list-indent handler runs first.
 *         `Tab` also chains `addRowAfter().goToNextCell()` when the caret
 *         is in the last cell, growing the table by one row on demand.
 *       * `Backspace` / `Mod-Backspace` / `Delete` / `Mod-Delete`: ALL
 *         route to `handleDeleteKeyOnTable` (from
 *         `./utilities/delete-key-shortcut.ts`). That handler inspects
 *         the active `CellSelection` rectangle: if the selection spans an
 *         entire row, it deletes those rows; if it spans an entire
 *         column, it deletes those columns; otherwise it returns `false`
 *         so the default text-deletion behavior runs. WHY: without this
 *         override, pressing Backspace on a row-drag-handle selection
 *         would either be a no-op (cells are empty) or attempt to delete
 *         the table structure as if it were plain text.
 *       * `ArrowDown` / `ArrowUp`: route to `insertLineBelowTableAction`
 *         / `insertLineAboveTableAction` so the user can press the arrow
 *         key from the first/last row to either insert a fresh paragraph
 *         around the table or move into the existing paragraph there.
 *         WHY: ProseMirror won't otherwise allow caret placement
 *         immediately before a table at the start of a document; this
 *         shortcut creates the paragraph for the user transparently.
 *   - `addProseMirrorPlugins` returns the table's plugin stack. When
 *     `this.options.resizable && this.editor.isEditable`, the canonical
 *     upstream `columnResizing({ handleWidth, cellMinWidth,
 *     lastColumnResizable })` is `unshift`ed onto the front (so it sees
 *     transactions first); otherwise it is omitted entirely. The base
 *     stack (in registration order, applied AFTER `columnResizing`) is:
 *       1. `tableEditing({ allowTableNodeSelection })` — the canonical
 *          `@tiptap/pm/tables` editing plugin that owns cell-selection
 *          rectangle navigation, table-aware command routing, and the
 *          tab-key keymap fallback. Comes FIRST in the base stack so
 *          other plugins see its post-resolution `tr` metadata.
 *       2. `TableDragStatePlugin` — owns the `content-hidden`
 *          decorations that visually fade cell contents during a column
 *          or row drag (see `../plugins/drag-state.ts`).
 *       3. `TableInsertPlugin(editor)` — scans the DOM for rendered
 *          tables and attaches the inline "+" insert buttons on every
 *          row/column edge (see `../plugins/insert-handlers/`).
 *       4. `TableColumnDragHandlePlugin(editor)` — renders the column
 *          drag-handle widgets above each column header (see
 *          `../plugins/drag-handles/column/`).
 *       5. `TableRowDragHandlePlugin(editor)` — renders the row
 *          drag-handle widgets to the left of each row (see
 *          `../plugins/drag-handles/row/`).
 *     WHY this order: ProseMirror dispatches transactions through plugins
 *     in registration order; the Plane decoration plugins (drag-state,
 *     insert, column-drag, row-drag) are registered AFTER `tableEditing`
 *     so they observe the post-resolution state of every cell-selection
 *     transaction `tableEditing` may have mutated, and their decorations
 *     stay in sync with the cell-selection rectangle. `columnResizing`
 *     is prepended via `unshift` because its `handleWidth` hit-area
 *     detection must run BEFORE `tableEditing` consumes the same pointer
 *     events.
 *
 * Hides (vs `@tiptap/extension-table`):
 *   - Upstream's default Tab/Shift-Tab keymap is replaced by the
 *     Plane-specific routing above (which yields to `LIST_ITEM` /
 *     `TASK_ITEM` when those nodes are active).
 *   - Upstream's default Backspace/Delete behavior inside a table is
 *     intercepted by `handleDeleteKeyOnTable` — the upstream behavior
 *     (delete the cell's enclosing structure) is suppressed in favor of
 *     the row/column-aware deletion above.
 *   - The vanilla DOM `<table>` renderer is suppressed by `addNodeView`
 *     returning a `TableView` instance — `renderHTML` is still implemented
 *     for serialization (HTML export, copy-paste) but is not used when
 *     the editor mounts the table.
 *
 * Cross-references:
 *   - `CORE_EXTENSIONS.TABLE` is defined in
 *     `packages/editor/src/core/constants/extension.ts`.
 *   - `DEFAULT_COLUMN_WIDTH` (the `150`-pixel seed for every fresh cell's
 *     `colwidth` array) is defined in the sibling `./index.ts`.
 *   - The five Plane-specific plugins live under `../plugins/` — see
 *     `../plugins/drag-state.ts`, `../plugins/insert-handlers/plugin.ts`,
 *     `../plugins/drag-handles/column/plugin.ts`, and
 *     `../plugins/drag-handles/row/plugin.ts` for each plugin's own
 *     documentation.
 *   - The sibling schema files `../table-cell.ts`, `../table-header.ts`,
 *     and `../table-row.ts` declare the `tableRole`-tagged nodes that
 *     fill the `tableRow+ → (tableCell|tableHeader)*` content expression
 *     this Node depends on.
 */
export const Table = Node.create<TableOptions>({
  name: CORE_EXTENSIONS.TABLE,

  /**
   * Default options for the `Table` extension. `resizable: true` is the
   * default so the `columnResizing` plugin is registered out of the box;
   * `handleWidth: 5` / `cellMinWidth: 100` are the same defaults
   * `@tiptap/pm/tables` uses upstream.
   */
  addOptions() {
    return {
      HTMLAttributes: {},
      resizable: true,
      handleWidth: 5,
      cellMinWidth: 100,
      lastColumnResizable: true,
      allowTableNodeSelection: true,
    };
  },

  content: "tableRow+",

  tableRole: "table",

  isolating: true,

  group: "block",

  allowGapCursor: false,

  /**
   * Parse rule: match any `<table>` element when ingesting HTML
   * (clipboard paste, document load, etc.).
   */
  parseHTML() {
    return [{ tag: "table" }];
  },

  /**
   * Serialize the table to HTML as `<table><tbody>...</tbody></table>`
   * with merged HTML attributes. The custom `TableView` NodeView
   * (`./table-view.tsx`) intercepts rendering in the editor — this
   * `renderHTML` runs only for HTML export, copy-paste, and other
   * out-of-editor serialization paths.
   */
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ["tbody", 0]];
  },

  /**
   * Registers the table command surface declared in the
   * `Commands<ReturnType>` module augmentation above. Most commands
   * forward directly to the matching `@tiptap/pm/tables` primitive;
   * the exceptions (`insertTable`, `deleteColumn`, `deleteRow`,
   * `mergeOrSplit`, `setCellSelection`, `fixTables`) use Plane-specific
   * wrappers — see the Overrides section of the top-of-extension JSDoc.
   */
  addCommands() {
    return {
      insertTable:
        ({ rows = 3, cols = 3, withHeaderRow = false } = {}) =>
        ({ tr, dispatch, editor }) => {
          const node = createTable({
            schema: editor.schema,
            rowsCount: rows,
            colsCount: cols,
            withHeaderRow,
            columnWidth: DEFAULT_COLUMN_WIDTH,
          });
          if (dispatch) {
            const offset = tr.selection.anchor + 1;

            tr.replaceSelectionWith(node)
              .scrollIntoView()
              .setSelection(TextSelection.near(tr.doc.resolve(offset)));
          }

          return true;
        },
      addColumnBefore:
        () =>
        ({ state, dispatch }) =>
          addColumnBefore(state, dispatch),
      addColumnAfter:
        () =>
        ({ state, dispatch }) =>
          addColumnAfter(state, dispatch),
      deleteColumn: deleteColumnOrTable,
      addRowBefore:
        () =>
        ({ state, dispatch }) =>
          addRowBefore(state, dispatch),
      addRowAfter:
        () =>
        ({ state, dispatch }) =>
          addRowAfter(state, dispatch),
      deleteRow: deleteRowOrTable,
      deleteTable:
        () =>
        ({ state, dispatch }) =>
          deleteTable(state, dispatch),
      mergeCells:
        () =>
        ({ state, dispatch }) =>
          mergeCells(state, dispatch),
      splitCell:
        () =>
        ({ state, dispatch }) =>
          splitCell(state, dispatch),
      toggleHeaderColumn:
        () =>
        ({ state, dispatch }) =>
          toggleHeader("column")(state, dispatch),
      toggleHeaderRow:
        () =>
        ({ state, dispatch }) =>
          toggleHeader("row")(state, dispatch),
      toggleHeaderCell:
        () =>
        ({ state, dispatch }) =>
          toggleHeaderCell(state, dispatch),
      clearSelectedCells:
        () =>
        ({ state, dispatch }) =>
          deleteCellSelection(state, dispatch),
      mergeOrSplit:
        () =>
        ({ state, dispatch }) => {
          if (mergeCells(state, dispatch)) {
            return true;
          }

          return splitCell(state, dispatch);
        },
      setCellAttribute:
        (name, value) =>
        ({ state, dispatch }) =>
          setCellAttr(name, value)(state, dispatch),
      goToNextCell:
        () =>
        ({ state, dispatch }) =>
          goToNextCell(1)(state, dispatch),
      goToPreviousCell:
        () =>
        ({ state, dispatch }) =>
          goToNextCell(-1)(state, dispatch),
      fixTables:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            fixTables(state);
          }

          return true;
        },
      setCellSelection:
        (position) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const selection = CellSelection.create(tr.doc, position.anchorCell, position.headCell);
            tr.setSelection(selection);
          }
          return true;
        },
    };
  },

  /**
   * Table-aware keyboard shortcut bindings.
   *
   * - `Tab`: routes to `goToNextCell` UNLESS the caret is inside a
   *   `LIST_ITEM` or `TASK_ITEM` (let list-indent handle Tab); when
   *   `goToNextCell` cannot advance (already in the last cell), chain
   *   `addRowAfter().goToNextCell()` to grow the table by one row.
   * - `Shift-Tab`: routes to `goToPreviousCell` with the same list-item
   *   yield semantics.
   * - `Backspace` / `Mod-Backspace` / `Delete` / `Mod-Delete`: all four
   *   route to `handleDeleteKeyOnTable` from
   *   `./utilities/delete-key-shortcut.ts`, which inspects the
   *   `CellSelection` rectangle and deletes whole rows or columns when
   *   the selection spans a full table dimension.
   * - `ArrowDown` / `ArrowUp`: route to `insertLineBelowTableAction` /
   *   `insertLineAboveTableAction` so the caret can escape the
   *   first/last row of a table.
   */
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive(CORE_EXTENSIONS.TABLE)) return false;

        if (this.editor.isActive(CORE_EXTENSIONS.LIST_ITEM) || this.editor.isActive(CORE_EXTENSIONS.TASK_ITEM)) {
          return false;
        }

        if (this.editor.commands.goToNextCell()) {
          return true;
        }

        if (!this.editor.can().addRowAfter()) {
          return false;
        }

        return this.editor.chain().addRowAfter().goToNextCell().run();
      },
      "Shift-Tab": () => {
        if (!this.editor.isActive(CORE_EXTENSIONS.TABLE)) return false;

        if (this.editor.isActive(CORE_EXTENSIONS.LIST_ITEM) || this.editor.isActive(CORE_EXTENSIONS.TASK_ITEM)) {
          return false;
        }

        return this.editor.commands.goToPreviousCell();
      },
      Backspace: handleDeleteKeyOnTable,
      "Mod-Backspace": handleDeleteKeyOnTable,
      Delete: handleDeleteKeyOnTable,
      "Mod-Delete": handleDeleteKeyOnTable,
      ArrowDown: insertLineBelowTableAction,
      ArrowUp: insertLineAboveTableAction,
    };
  },

  /**
   * Mounts the custom `TableView` NodeView (see `./table-view.tsx`).
   * The NodeView owns the table's wrapper DOM, the `<colgroup>` of
   * explicit `<col>` widths, the `<tbody>` content mount point, and the
   * `ignoreMutation` opt-out that prevents ProseMirror from trying to
   * directly reconcile the custom DOM structure.
   */
  addNodeView() {
    return ({ editor, node, decorations, getPos }) => {
      const { cellMinWidth } = this.options;

      return new TableView(node, cellMinWidth, decorations, editor, getPos);
    };
  },

  /**
   * Registers the table's ProseMirror plugin stack.
   *
   * Base stack (registration order, applied AFTER any prepended
   * `columnResizing`):
   *   1. `tableEditing` (canonical `@tiptap/pm/tables`) — owns
   *      cell-selection rectangle navigation and table-aware command
   *      routing. Registered FIRST so its `tr` metadata is visible to
   *      every subsequent plugin in the chain.
   *   2. `TableDragStatePlugin` — `content-hidden` decorations during
   *      drag.
   *   3. `TableInsertPlugin(editor)` — inline "+" insert buttons on
   *      every row/column edge.
   *   4. `TableColumnDragHandlePlugin(editor)` — column drag handles.
   *   5. `TableRowDragHandlePlugin(editor)` — row drag handles.
   *
   * When `resizable && editor.isEditable`, the canonical
   * `columnResizing({ handleWidth, cellMinWidth, lastColumnResizable })`
   * is `unshift`ed onto the front so it sees pointer events first. The
   * commented-out `// View: TableView,` inside the `columnResizing`
   * config call is preserved verbatim — upstream `columnResizing`
   * accepts an optional `View` factory but Plane uses its own
   * `TableView` via `addNodeView` instead.
   */
  addProseMirrorPlugins() {
    const isResizable = this.options.resizable && this.editor.isEditable;

    const plugins = [
      tableEditing({
        allowTableNodeSelection: this.options.allowTableNodeSelection,
      }),
      TableDragStatePlugin,
      TableInsertPlugin(this.editor),
      TableColumnDragHandlePlugin(this.editor),
      TableRowDragHandlePlugin(this.editor),
    ];

    if (isResizable) {
      plugins.unshift(
        columnResizing({
          handleWidth: this.options.handleWidth,
          cellMinWidth: this.options.cellMinWidth,
          // View: TableView,
          lastColumnResizable: this.options.lastColumnResizable,
        })
      );
    }

    return plugins;
  },

  /**
   * Resolves the `tableRole` field on any other extension (`TableCell`,
   * `TableHeader`, `TableRow`, or any user-registered node that declares
   * `tableRole` either as a string literal or as a callback function).
   *
   * Called by `@tiptap/core` for every registered extension during schema
   * compilation. Uses `callOrReturn` so callbacks resolve against the
   * extension's own `name` / `options` / `storage` context; static string
   * roles pass through unchanged.
   */
  extendNodeSchema(extension) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
    };

    return {
      tableRole: callOrReturn(getExtensionField(extension, "tableRole", context)),
    };
  },
});
