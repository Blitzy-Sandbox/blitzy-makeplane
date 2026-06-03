/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Text-alignment selector for the bubble menu inside the `@plane/editor` TipTap wrapper.
 *
 * Renders three icon buttons (`AlignLeft`, `AlignCenter`, `AlignRight`) that dispatch
 * alignment commands through the shared `TextAlignItem(editor)` factory from
 * `../menu-items`. The selector is suppressed entirely (`return null`) when the
 * current selection has code formatting active — inline `code` or `codeBlock` —
 * because the underlying `CustomTextAlignExtension` only registers `heading` and
 * `paragraph` as alignable node types, so exposing alignment controls inside code
 * would dispatch commands that do nothing visible.
 *
 * TipTap framing:
 *   - EXPOSES the `@tiptap/extension-text-align` `setTextAlign` command via the
 *     `TextAlignItem(editor).command({ alignment })` adapter.
 *   - REFLECTS active alignment through `editorState.left | center | right` (booleans
 *     derived once in `./root.tsx` from
 *     `formattingItems["text-align"].isActive({ alignment: <key> })`).
 *   - OVERRIDES the default extension visibility by gating the whole selector on
 *     `editorState.code`; the underlying TipTap extension does not gate visibility
 *     by block type on its own.
 *
 * Consumer surface: mounted only inside `./root.tsx` (`EditorBubbleMenu`) — not
 * consumed elsewhere.
 */

import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
// plane utils
import { cn } from "@plane/utils";
// components
import { TextAlignItem } from "@/components/menus";
// types
import type { TEditorCommands } from "@/types";
import type { EditorStateType } from "./root";

type Props = {
  editor: Editor;
  editorState: EditorStateType;
};

/**
 * Compact left/center/right text-alignment control for the bubble menu.
 *
 * Renders three icon buttons that toggle the `textAlign` attribute on the
 * currently-selected `heading` or `paragraph` node; hides itself entirely
 * (`return null`) when code formatting is active at the cursor because
 * `CustomTextAlignExtension` does not register code as an alignable node type.
 *
 * Props (see the local `Props` type):
 *   - `editor` (`Editor` from `@tiptap/core`) — the active TipTap editor instance.
 *   - `editorState` (`EditorStateType` from `./root`) — derived state owned by the
 *     parent `EditorBubbleMenu`. This selector consumes `editorState.left`,
 *     `editorState.center`, `editorState.right` for active-state highlighting and
 *     `editorState.code` for the suppress-on-code gate. It does NOT run its own
 *     `useEditorState` subscription — the parent's single subscription owns state
 *     derivation, so every selector inside the bubble menu sees a coherent snapshot.
 *
 * Local state:
 *   - `menuItem = TextAlignItem(editor)` — the shared builder factory invoked once
 *     per render; its `command({ alignment })` is dispatched on click.
 *   - `textAlignmentOptions` — local array of three entries constructed inside the
 *     component body (cheap, no memoization needed) so each render captures fresh
 *     closures over the current `editor`.
 *
 * Side effects: each button `onClick` calls `e.stopPropagation()` first and then
 * `item.command()`, which dispatches `menuItem.command({ alignment: <key> })`
 * (a TipTap chain command setting the `textAlign` attribute on the current block).
 * No subscriptions installed, no DOM listeners attached, no portals rendered.
 *
 * TipTap behavior:
 *   - EXPOSES the `@tiptap/extension-text-align` commands via the
 *     `TextAlignItem(editor).command({ alignment })` factory from `../menu-items`.
 *   - REFLECTS active alignment through `editorState.left | center | right`.
 *   - OVERRIDES the default extension visibility by suppressing the selector on
 *     `editorState.code` — the upstream extension itself does not gate visibility by
 *     block type, but the Plane wrapper restricts alignable types to `heading` and
 *     `paragraph`, so dispatching alignment inside a code block would be a no-op.
 *
 * Behavior notes (WHY):
 *   - `renderKey` (e.g., `"text-align-left"`) differs from `itemKey` (`"text-align"`)
 *     because all three buttons share the same `TEditorCommands` discriminant but
 *     need unique React `key` attributes for the JSX map; using `itemKey` alone
 *     would produce three identical React keys and trigger reconciliation warnings.
 *   - `e.stopPropagation()` runs BEFORE `item.command()` so the click is consumed by
 *     this button regardless of whether the dispatched TipTap command completes
 *     synchronously — without this ordering, sibling floating menus (color, link,
 *     node) could interpret the click as occurring outside their dropdowns and close
 *     prematurely.
 *   - The `editorState.code` early return is preferred over a hidden DOM node
 *     (`display: none`) so the JSX tree stays minimal when alignment isn't
 *     applicable, and the accessibility tree isn't polluted for screen readers.
 *
 * Consumer surface: mounted inside `./root.tsx` (`EditorBubbleMenu`) as the final
 * section of the toolbar (after node, link, color, and basic formatting sections).
 */
export function TextAlignmentSelector(props: Props) {
  const { editor, editorState } = props;
  const menuItem = TextAlignItem(editor);

  const textAlignmentOptions: {
    itemKey: TEditorCommands;
    renderKey: string;
    icon: LucideIcon;
    command: () => void;
    isActive: () => boolean;
  }[] = [
    {
      itemKey: "text-align",
      renderKey: "text-align-left",
      icon: AlignLeft,
      command: () =>
        menuItem.command({
          alignment: "left",
        }),
      isActive: () => editorState.left,
    },
    {
      itemKey: "text-align",
      renderKey: "text-align-center",
      icon: AlignCenter,
      command: () =>
        menuItem.command({
          alignment: "center",
        }),
      isActive: () => editorState.center,
    },
    {
      itemKey: "text-align",
      renderKey: "text-align-right",
      icon: AlignRight,
      command: () =>
        menuItem.command({
          alignment: "right",
        }),
      isActive: () => editorState.right,
    },
  ];
  if (editorState.code) return null;

  return (
    <div className="flex gap-0.5 px-2">
      {textAlignmentOptions.map((item) => (
        <button
          key={item.renderKey}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            item.command();
          }}
          className={cn(
            "grid size-7 place-items-center rounded-sm text-tertiary transition-colors hover:bg-layer-1 active:bg-layer-1",
            {
              "bg-layer-1 text-primary": item.isActive(),
            }
          )}
        >
          <item.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
