/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating row-options dropdown shown from the row drag-handle button.
 *
 * Mounted by `./drag-handle.tsx` inside a `@floating-ui/react` portal when the
 * user clicks the handle. The symmetric counterpart `../column/dropdown.tsx`
 * exposes the column-axis equivalents (`addColumnBefore`/`addColumnAfter`/
 * `deleteColumn`/`toggleHeaderColumn`); behavior and structure mirror this file
 * and the two should be kept in sync when either is modified.
 */

import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { ArrowDown, ArrowUp, ToggleRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// extensions
import type { ISvgIcons } from "@plane/propel/icons";
import { CopyIcon, TrashIcon, CloseIcon } from "@plane/propel/icons";
import { findTable, getSelectedRows } from "@/extensions/table/table/utilities/helpers";
// local imports
import { duplicateRows } from "../actions";
import { TableDragHandleDropdownColorSelector } from "../color-selector";

/**
 * Declarative row-options menu configuration.
 *
 * Each entry pairs an icon and label with an `action(editor)` callback that
 * runs the corresponding row command. Most entries are one-shot Tiptap chains
 * (`addRowBefore` / `addRowAfter` / `clearSelectedCells` / `deleteRow`); the
 * `duplicate` entry is special — it resolves the active `TableMap`, derives
 * selected rows via `getSelectedRows`, and invokes the merged-cell-safe
 * `duplicateRows` helper from `../actions.ts` (matrix round-trip pattern)
 * rather than a naive table-row duplication chain so merged cells survive
 * intact. The header-row toggle is rendered separately above this list in
 * `RowOptionsDropdown` because it is a stateful toggle, not a one-shot action.
 */
const DROPDOWN_ITEMS: {
  key: string;
  label: string;
  icon: LucideIcon | React.FC<ISvgIcons>;
  action: (editor: Editor) => void;
}[] = [
  {
    key: "insert-above",
    label: "Insert above",
    icon: ArrowUp,
    action: (editor) => editor.chain().focus().addRowBefore().run(),
  },
  {
    key: "insert-below",
    label: "Insert below",
    icon: ArrowDown,
    action: (editor) => editor.chain().focus().addRowAfter().run(),
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
      const selectedRows = getSelectedRows(editor.state.selection, tableMap);
      tr = duplicateRows(table, selectedRows, tr);
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
    action: (editor) => editor.chain().focus().deleteRow().run(),
  },
];

type Props = {
  editor: Editor;
  onClose: () => void;
};

/**
 * Floating menu listing all row-scoped actions, opened from the row
 * drag-handle button.
 *
 * Structure (top to bottom): a `Header row` toggle button that dispatches
 * `toggleHeaderRow`, a horizontal divider, the shared
 * `TableDragHandleDropdownColorSelector` (closes the panel on color pick via
 * `onSelect={onClose}`), and the declarative `DROPDOWN_ITEMS` rendered as a
 * list of real `<button type="button">` entries. Every click handler calls
 * `e.preventDefault()` + `e.stopPropagation()` BEFORE running the editor
 * command so the click does not leak into the editor view's keyboard /
 * selection handling and break the floating-ui dismissal of the dropdown.
 *
 * The `duplicate` action takes the merged-cell-safe path: it resolves the
 * active table via `findTable(editor.state.selection)`, derives a `TableMap`
 * from `table.node`, computes selected row indices via `getSelectedRows`,
 * calls `duplicateRows` from `../actions.ts` to mutate the transaction
 * (matrix round-trip preserves merged-cell structure), and dispatches the
 * transaction via `editor.view.dispatch(tr)`. A naive
 * `editor.chain().duplicateRow().run()` would not handle merged cells
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
export function RowOptionsDropdown(props: Props) {
  const { editor, onClose } = props;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 text-left text-11 text-secondary hover:bg-layer-1"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          editor.chain().focus().toggleHeaderRow().run();
          onClose();
        }}
      >
        <div className="flex-grow truncate">Header row</div>
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
