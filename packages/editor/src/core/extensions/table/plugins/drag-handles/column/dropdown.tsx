/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating column-options dropdown shown from the column drag-handle button.
 *
 * Mounted by `./drag-handle.tsx` inside a `@floating-ui/react` portal when the
 * user clicks the handle. The symmetric counterpart `../row/dropdown.tsx`
 * exposes the row-axis equivalents (`addRowBefore`/`addRowAfter`/`deleteRow`/
 * `toggleHeaderRow`); behavior and structure mirror this file and the two
 * should be kept in sync when either is modified.
 */

import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { ArrowLeft, ArrowRight, ToggleRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// extensions
import type { ISvgIcons } from "@plane/propel/icons";
import { CopyIcon, TrashIcon, CloseIcon } from "@plane/propel/icons";
import { findTable, getSelectedColumns } from "@/extensions/table/table/utilities/helpers";
// local imports
import { duplicateColumns } from "../actions";
import { TableDragHandleDropdownColorSelector } from "../color-selector";

/**
 * Declarative column-options menu configuration.
 *
 * Each entry pairs an icon and label with an `action(editor)` callback that
 * runs the corresponding column command. Most entries are one-shot Tiptap
 * chains (`addColumnBefore` / `addColumnAfter` / `clearSelectedCells` /
 * `deleteColumn`); the `duplicate` entry is special — it resolves the active
 * `TableMap`, derives selected columns via `getSelectedColumns`, and invokes
 * the merged-cell-safe `duplicateColumns` helper from `../actions.ts` (matrix
 * round-trip pattern) rather than a naive table-column duplication chain so
 * merged cells survive intact. The header-column toggle is rendered separately
 * above this list in `ColumnOptionsDropdown` because it is a stateful toggle,
 * not a one-shot action.
 */
const DROPDOWN_ITEMS: {
  key: string;
  label: string;
  icon: LucideIcon | React.FC<ISvgIcons>;
  action: (editor: Editor) => void;
}[] = [
  {
    key: "insert-left",
    label: "Insert left",
    icon: ArrowLeft,
    action: (editor) => editor.chain().focus().addColumnBefore().run(),
  },
  {
    key: "insert-right",
    label: "Insert right",
    icon: ArrowRight,
    action: (editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    key: "duplicate",
    label: "Duplicate",
    icon: CopyIcon,
    action: (editor) => {
      const table = findTable(editor.state.selection);
      if (!table) return;

      const tableMap = TableMap.get(table.node);
      let tr = editor.state.tr;
      const selectedColumns = getSelectedColumns(editor.state.selection, tableMap);
      tr = duplicateColumns(table, selectedColumns, tr);
      editor.view.dispatch(tr);
    },
  },
  {
    key: "clear-contents",
    label: "Clear contents",
    icon: CloseIcon,
    action: (editor) => editor.chain().focus().clearSelectedCells().run(),
  },
  {
    key: "delete",
    label: "Delete",
    icon: TrashIcon,
    action: (editor) => editor.chain().focus().deleteColumn().run(),
  },
];

type Props = {
  editor: Editor;
  onClose: () => void;
};

/**
 * Floating menu listing all column-scoped actions, opened from the column
 * drag-handle button.
 *
 * Structure (top to bottom): a `Header column` toggle button that dispatches
 * `toggleHeaderColumn`, a horizontal divider, the shared
 * `TableDragHandleDropdownColorSelector` (closes the panel on color pick via
 * `onSelect={onClose}`), and the declarative `DROPDOWN_ITEMS` rendered as a
 * list of real `<button type="button">` entries. Every click handler calls
 * `e.preventDefault()` + `e.stopPropagation()` BEFORE running the editor
 * command so the click does not leak into the editor view's keyboard /
 * selection handling and break the floating-ui dismissal of the dropdown.
 *
 * The `duplicate` action takes the merged-cell-safe path: it resolves the
 * active table via `findTable(editor.state.selection)`, derives a `TableMap`
 * from `table.node`, computes selected column indices via `getSelectedColumns`,
 * calls `duplicateColumns` from `../actions.ts` to mutate the transaction
 * (matrix round-trip preserves merged-cell structure), and dispatches the
 * transaction via `editor.view.dispatch(tr)`. A naive
 * `editor.chain().duplicateColumn().run()` would not handle merged cells
 * correctly and must NOT replace this path.
 *
 * Cross-extension contract: this component does NOT manage the dropbar-active
 * flag itself — the parent `./drag-handle.tsx` registers
 * `addActiveDropbarExtension(CORE_EXTENSIONS.TABLE)` while open and removes it
 * on close. Dropbar-aware extensions (e.g. `enter-key.ts`, `placeholder.ts`)
 * read that flag to suppress their own affordances while a dropbar is active,
 * so closing this dropdown has side effects beyond its own DOM.
 *
 * @param props.editor Tiptap Editor instance the menu commands run against.
 * @param props.onClose Called after each action to close the floating panel
 *   (caller wires this to release the dropbar lock in the parent handle).
 */
export function ColumnOptionsDropdown(props: Props) {
  const { editor, onClose } = props;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 text-left text-11 text-secondary hover:bg-layer-1"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          editor.chain().focus().toggleHeaderColumn().run();
          onClose();
        }}
      >
        <div className="flex-grow truncate">Header column</div>
        <ToggleRight className="size-3 shrink-0" />
      </button>
      <hr className="my-2 border-subtle" />
      <TableDragHandleDropdownColorSelector editor={editor} onSelect={onClose} />
      {DROPDOWN_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className="flex w-full items-center gap-2 truncate rounded-sm px-1 py-1.5 text-left text-11 text-secondary hover:bg-layer-1"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            item.action(editor);
            onClose();
          }}
        >
          <item.icon className="size-3 shrink-0" />
          <div className="flex-grow truncate">{item.label}</div>
        </button>
      ))}
    </>
  );
}
