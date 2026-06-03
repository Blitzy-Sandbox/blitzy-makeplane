/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Block-type selector for the bubble menu inside the `@plane/editor` TipTap wrapper.
 *
 * Renders a dropdown listing 12 block types — Text (paragraph), Heading 1–6,
 * Bulleted list, Numbered list, To-do list, Quote, and Code — and dispatches the
 * corresponding TipTap toggle command on selection via the shared
 * `EditorMenuItem<T>` builder factories from `../menu-items`. The trigger displays
 * the active block type's label, or `"Multiple"` when no single block type owns
 * the current selection.
 *
 * TipTap framing:
 *   - EXPOSES the block-type commands (`toggleHeading`, `toggleBulletList`,
 *     `toggleOrderedList`, `toggleTaskList`, `toggleBlockquote`, `toggleCodeBlock`,
 *     and the paragraph setter via `setText`) by delegating to the corresponding
 *     builder factories in `../menu-items`.
 *   - OVERRIDES the default keyboard-shortcut-only block toggling behavior by
 *     surfacing the same commands in a click-driven dropdown UI; users can switch
 *     block type without remembering shortcuts.
 *   - HIDES the underlying chain invocations (e.g.,
 *     `editor.chain().focus().toggleHeading(...).run()`) behind the typed
 *     `EditorMenuItem<T>.command()` contract so the bubble menu code does not
 *     depend on TipTap's untyped chainable API.
 *
 * Consumer surface: mounted only inside `./root.tsx` (`EditorBubbleMenu`) — not
 * consumed elsewhere.
 */

import type { Editor } from "@tiptap/react";

import { CheckIcon, ChevronDownIcon } from "@plane/propel/icons";
// plane utils
import { cn } from "@plane/utils";
// components
import type { EditorMenuItem } from "@/components/menus";
import {
  BulletListItem,
  HeadingOneItem,
  HeadingThreeItem,
  HeadingTwoItem,
  NumberedListItem,
  QuoteItem,
  CodeItem,
  TodoListItem,
  TextItem,
  HeadingFourItem,
  HeadingFiveItem,
  HeadingSixItem,
} from "@/components/menus";
// types
import type { TEditorCommands } from "@/types";
// local imports
import { FloatingMenuRoot } from "../floating-menu/root";
import { useFloatingMenu } from "../floating-menu/use-floating-menu";

type Props = {
  editor: Editor;
};

/**
 * Block-type dropdown rendered inside `EditorBubbleMenu`.
 *
 * Shows the current active block label (e.g., "Heading 2") on the trigger, opens a
 * scrollable popup listing all 12 block-type options, executes the chosen command,
 * and closes the menu.
 *
 * Props (see the local `Props` type):
 *   - `editor` (`Editor` from `@tiptap/react`) — the active TipTap editor instance.
 *
 * Unlike `BubbleMenuColorSelector` and `TextAlignmentSelector`, this selector does
 * NOT receive an `editorState` prop. Each `EditorMenuItem` from `../menu-items`
 * carries its own synchronous `isActive()` predicate that reads the editor's
 * current state directly, so no parent-derived state slice (and no extra
 * `useEditorState` subscription) is required for the active-item lookup performed
 * on render.
 *
 * Local state:
 *   - `useFloatingMenu({})` returns `options`, `getReferenceProps`,
 *     `getFloatingProps`, and exposes `context` (Floating UI's `onOpenChange`
 *     controller used to close the menu after a selection).
 *   - `items: EditorMenuItem<TEditorCommands>[]` — the 12 menu entries built per
 *     render by invoking the builder factories from `../menu-items` against the
 *     current `editor`.
 *   - `activeItem` — derived as
 *     `items.filter((item) => item.isActive()).pop() ?? { name: "Multiple" }`,
 *     used both to label the trigger and to highlight the matching row.
 *
 * Side effects: each row's `onClick` dispatches `item.command()` (the corresponding
 * TipTap toggle command via the builder factory), then closes the dropdown via
 * `context.onOpenChange(false)`, then calls `e.stopPropagation()` to prevent the
 * click from reaching `FloatingMenuRoot`'s outside-click dismiss handler before
 * the command runs.
 *
 * TipTap behavior:
 *   - EXPOSES the 12 block-type commands by delegating to the builder factories
 *     from `../menu-items`:
 *       `TextItem`                        → `setText(editor)` (paragraph)
 *       `HeadingOneItem`–`HeadingSixItem` → `toggleHeading(editor, level)` (levels 1–6)
 *       `BulletListItem`                  → `toggleBulletList(editor)`
 *       `NumberedListItem`                → `toggleOrderedList(editor)`
 *       `TodoListItem`                    → `toggleTaskList(editor)`
 *       `QuoteItem`                       → `toggleBlockquote(editor)`
 *       `CodeItem`                        → `toggleCodeBlock(editor)` — note that
 *         `CodeItem.isActive` is true for EITHER inline code OR a code block (see
 *         `../menu-items.ts` `CodeItem` for the predicate).
 *   - OVERRIDES the default keyboard-shortcut-only block toggling by surfacing the
 *     same commands in a click-driven dropdown UI.
 *   - HIDES the underlying chain invocations behind the typed
 *     `EditorMenuItem<T>.command()` contract so the bubble menu code does not
 *     depend on TipTap's untyped chainable API.
 *
 * Behavior notes (WHY):
 *   - The `{ name: "Multiple" }` fallback is reached when the selection spans
 *     multiple block types (e.g., a heading and a paragraph) — the trigger
 *     displays "Multiple" rather than guessing one block type, preventing user
 *     confusion under multi-type selections.
 *   - `.pop()` (not `[0]`) is used on the filtered active items because nested
 *     block types — a heading INSIDE a list item, for instance — can match more
 *     than one `isActive` predicate; `.pop()` returns the LAST match so the
 *     trigger shows the most-specific active type.
 *   - The 12 items are constructed inside the component body (not memoized via
 *     `useMemo`) because the builder factories are cheap object-literal
 *     constructions; memoization would not save measurable cycles here and would
 *     add a dependency-array maintenance burden.
 *   - The `as EditorMenuItem<TEditorCommands>[]` cast widens the heterogeneous
 *     union of per-key items (`"text"`, `"h1"`, ..., `"code"`) into the broader
 *     `TEditorCommands` union. Without it, TypeScript would infer the array
 *     literal as a heterogeneous tuple of differently-discriminated items and
 *     reject the assignment to `EditorMenuItem<TEditorCommands>[]`.
 *
 * Consumer surface: mounted inside `./root.tsx` (`EditorBubbleMenu`).
 */
export function BubbleMenuNodeSelector(props: Props) {
  const { editor } = props;
  // floating ui
  const { options, getReferenceProps, getFloatingProps } = useFloatingMenu({});
  const { context } = options;
  const items: EditorMenuItem<TEditorCommands>[] = [
    TextItem(editor),
    HeadingOneItem(editor),
    HeadingTwoItem(editor),
    HeadingThreeItem(editor),
    HeadingFourItem(editor),
    HeadingFiveItem(editor),
    HeadingSixItem(editor),
    BulletListItem(editor),
    NumberedListItem(editor),
    TodoListItem(editor),
    QuoteItem(editor),
    CodeItem(editor),
  ] as EditorMenuItem<TEditorCommands>[];

  const activeItem = items.filter((item) => item.isActive()).pop() ?? {
    name: "Multiple",
  };

  return (
    <FloatingMenuRoot
      classNames={{
        buttonContainer: "h-full",
        button: cn(
          "flex h-full items-center gap-1 rounded-sm px-3 text-13 font-medium whitespace-nowrap text-tertiary transition-colors hover:bg-layer-1 active:bg-layer-1",
          {
            "bg-layer-1": context.open,
          }
        ),
      }}
      menuButton={
        <>
          <span>{activeItem?.name}</span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </>
      }
      options={options}
      getFloatingProps={getFloatingProps}
      getReferenceProps={getReferenceProps}
    >
      <section className="mt-1 flex max-h-[90vh] w-48 flex-col overflow-y-scroll rounded-md border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 shadow-raised-200">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={(e) => {
              item.command();
              context.onOpenChange(false);
              e.stopPropagation();
            }}
            className={cn(
              "flex items-center justify-between rounded-sm px-1 py-1.5 text-13 text-secondary hover:bg-layer-1",
              {
                "bg-layer-1": activeItem.name === item.name,
              }
            )}
          >
            <div className="flex items-center space-x-2">
              <item.icon className="size-3 flex-shrink-0" />
              <span>{item.name}</span>
            </div>
            {activeItem.name === item.name && <CheckIcon className="size-3 flex-shrink-0 text-tertiary" />}
          </button>
        ))}
      </section>
    </FloatingMenuRoot>
  );
}
