/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Disclosure-based dropdown content that mutates the background color of the
 * currently-active TipTap `tableCell`.
 *
 * Consumed in lock-step from both `column/dropdown.tsx` and `row/dropdown.tsx`
 * so the column-drag and row-drag menus share a single color-picker UI; the
 * parent dropdown passes its `onClose` handler as `onSelect` so the menu
 * dismisses itself once the editor mutation has run. Color application is a
 * single `editor.chain().focus().updateAttributes(CORE_EXTENSIONS.TABLE_CELL,
 * { background }).run()` transaction — no `addActiveDropbarExtension`
 * registration happens here; that contract is owned by the drag-handle
 * component, not by this UI surface.
 *
 * The pre-existing `handleTextColorChange` helper and the matching
 * `<Disclosure.Panel>` "Text colors" subtree are retained in commented-out
 * form as scaffolding for a future text-color UI (the
 * `// TODO: implement text color selector` line is the marker). Per this
 * documentation pass's system boundary (no restructuring), they MUST NOT be
 * deleted, moved, or uncommented as part of this work.
 *
 * `@plane/editor` is an internal TipTap wrapper treated as first-party code.
 */

import { Disclosure } from "@headlessui/react";
import type { Editor } from "@tiptap/core";
import { Ban, Palette } from "lucide-react";
// plane imports
import { ChevronRightIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
// constants
import { COLORS_LIST } from "@/constants/common";
import { CORE_EXTENSIONS } from "@/constants/extension";

// TODO: implement text color selector

/**
 * Props for {@link TableDragHandleDropdownColorSelector}.
 *
 * @property editor - TipTap {@link Editor} instance whose currently-active
 *   table cell will receive the new `background` attribute via
 *   `updateAttributes(CORE_EXTENSIONS.TABLE_CELL, …)`.
 * @property onSelect - Callback fired AFTER the editor mutation runs;
 *   `color === null` indicates the user clicked the reset (Ban icon) button.
 *   The consuming drag-handle dropdowns pass their own `onClose` here so the
 *   parent menu dismisses itself once the cell attributes are updated —
 *   without this hook the menu would stay open after a swatch click.
 */
type Props = {
  editor: Editor;
  onSelect: (color: string | null) => void;
};

/**
 * Applies a `background` attribute to the currently-selected TipTap
 * `tableCell` by chaining `focus()` and `updateAttributes` into a single
 * editor transaction; passing `color === null` clears the attribute so the
 * cell reverts to its default theme background.
 */
const handleBackgroundColorChange = (editor: Editor, color: string | null) => {
  editor
    .chain()
    .focus()
    .updateAttributes(CORE_EXTENSIONS.TABLE_CELL, {
      background: color,
    })
    .run();
};

// const handleTextColorChange = (editor: Editor, color: string | null) => {
//   editor
//     .chain()
//     .focus()
//     .updateAttributes(CORE_EXTENSIONS.TABLE_CELL, {
//       textColor: color,
//     })
//     .run();
// };

/**
 * Headless UI `Disclosure`-based dropdown that lets the user paint a
 * background color onto the currently-active TipTap `tableCell` from inside
 * the table column-drag and row-drag menus.
 *
 * Renders a palette icon trigger which expands into a swatch grid sourced
 * from `COLORS_LIST` (re-exported from `@/constants/common`); clicking a
 * swatch calls {@link handleBackgroundColorChange} and then invokes
 * `props.onSelect` so the parent dropdown can dismiss itself. The reset
 * button (Ban icon) clears the cell background via the same path with
 * `color === null`. Consumed by
 * `core/extensions/table/plugins/drag-handles/column/dropdown.tsx` and
 * `core/extensions/table/plugins/drag-handles/row/dropdown.tsx`; the
 * `addActiveDropbarExtension` lifecycle is owned by those drag-handle
 * components, not by this UI surface.
 *
 * Accessibility: Headless UI `Disclosure` provides keyboard-accessible
 * expand/collapse behavior (Enter/Space toggles, Escape closes) and focus
 * management without bespoke key handlers; the `ChevronRight` indicator
 * rotates 90° via the `open` render prop so sighted users get an unambiguous
 * expand-state cue. The component opts into `defaultOpen` because the parent
 * menu is itself a popover the user just chose to open — collapsing the
 * swatches on entry would require a second click before the primary action.
 *
 * The commented-out "Text colors" `<Disclosure.Panel>` subtree below and the
 * commented `handleTextColorChange` helper above are pre-existing scaffolding
 * for a future text-color UI; per this documentation pass's system boundary
 * (no restructuring) they MUST NOT be deleted, moved, or uncommented.
 *
 * @param props - See {@link Props}.
 */
export function TableDragHandleDropdownColorSelector(props: Props) {
  const { editor, onSelect } = props;

  return (
    <Disclosure defaultOpen>
      <Disclosure.Button
        as="button"
        type="button"
        className="flex w-full items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 text-left text-11 text-secondary hover:bg-layer-1"
      >
        {({ open }) => (
          <>
            <span className="flex items-center gap-2">
              <Palette className="size-3 shrink-0" />
              Color
            </span>
            <ChevronRightIcon
              className={cn("size-3 shrink-0 transition-transform duration-200", {
                "rotate-90": open,
              })}
            />
          </>
        )}
      </Disclosure.Button>
      <Disclosure.Panel className="mb-1.5 space-y-2 p-1">
        {/* <div className="space-y-1.5">
          <p className="text-11 text-tertiary font-semibold">Text colors</p>
          <div className="flex items-center flex-wrap gap-2">
            {COLORS_LIST.map((color) => (
              <button
                key={color.key}
                type="button"
                className="flex-shrink-0 size-6 rounded-sm border-[0.5px] border-strong-1 hover:opacity-60 transition-opacity"
                style={{
                  backgroundColor: color.textColor,
                }}
                onClick={() => handleTextColorChange(editor, color.textColor)}
              />
            ))}
            <button
              type="button"
              className="flex-shrink-0 size-6 grid place-items-center rounded-sm text-tertiary border-[0.5px] border-strong-1 hover:bg-layer-1 transition-colors"
              onClick={() => handleTextColorChange(editor, null)}
            >
              <Ban className="size-4" />
            </button>
          </div>
        </div> */}
        <div className="space-y-1">
          <p className="text-11 font-semibold text-tertiary">Background colors</p>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS_LIST.map((color) => (
              <button
                key={color.key}
                type="button"
                className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                style={{
                  backgroundColor: color.backgroundColor,
                }}
                onClick={() => {
                  handleBackgroundColorChange(editor, color.backgroundColor);
                  onSelect(color.backgroundColor);
                }}
              />
            ))}
            <button
              type="button"
              className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary transition-colors hover:bg-layer-1-hover"
              onClick={() => {
                handleBackgroundColorChange(editor, null);
                onSelect(null);
              }}
            >
              <Ban className="size-4" />
            </button>
          </div>
        </div>
      </Disclosure.Panel>
    </Disclosure>
  );
}
