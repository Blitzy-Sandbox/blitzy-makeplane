/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestrator for the inline contextual formatting toolbar
 * ("bubble menu") in the `@plane/editor` TipTap wrapper.
 *
 * Assembles the four selector subcomponents (`BubbleMenuNodeSelector`,
 * `BubbleMenuLinkSelector`, `BubbleMenuColorSelector`, `TextAlignmentSelector`)
 * and the inline-style buttons (bold, italic, underline, strikethrough, code)
 * into a single `<BubbleMenu>` surface that floats above the active text
 * selection.
 *
 * Performance contract: this module is the SINGLE owner of the
 * `EditorStateType` derivation — `useEditorState` runs exactly ONCE here and
 * the resulting snapshot is passed down to the color and alignment selectors
 * as a prop. Splitting the subscription across selectors would multiply
 * re-renders on every selection change, so future refactors MUST preserve
 * this single-subscription pattern.
 *
 * Visibility logic suppresses the toolbar for: empty selections, non-editable
 * content, IMAGE / CUSTOM_IMAGE active states, ProseMirror node selections,
 * table cell selections, and drag-selection gestures in progress — see
 * `shouldShow` inside `EditorBubbleMenu` for the authoritative predicate.
 *
 * Consumer surface: mounted by editor variants under
 * `packages/editor/src/core/components/editors/{document, rich-text}/`. The
 * lite-text editor variant intentionally does NOT mount this orchestrator
 * (single-line input contexts suppress the bubble menu).
 */

import { isNodeSelection } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { BubbleMenu, useEditorState } from "@tiptap/react";
import type { BubbleMenuProps } from "@tiptap/react";
import { useEffect, useState, useRef } from "react";
// plane utils
import { cn } from "@plane/utils";
// components
import type { EditorMenuItem } from "@/components/menus";
import {
  BackgroundColorItem,
  BoldItem,
  BubbleMenuColorSelector,
  BubbleMenuNodeSelector,
  CodeItem,
  ItalicItem,
  StrikeThroughItem,
  TextAlignItem,
  TextColorItem,
  UnderLineItem,
} from "@/components/menus";
// constants
import { COLORS_LIST } from "@/constants/common";
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import { isCellSelection } from "@/extensions/table/table/utilities/helpers";
// types
import type { IEditorPropsExtended, TEditorCommands, TExtensions } from "@/types";
// local imports
import { TextAlignmentSelector } from "./alignment-selector";
import { BubbleMenuLinkSelector } from "./link-selector";

type EditorBubbleMenuProps = Omit<BubbleMenuProps, "children">;

/**
 * Discriminated derivation result produced by the single `useEditorState`
 * subscription inside `EditorBubbleMenu`.
 *
 * The boolean fields (`code`, `bold`, `italic`, `underline`, `strikethrough`,
 * `left`, `center`, `right`) reflect inline-mark and text-alignment activity
 * at the current selection. The `color` and `backgroundColor` fields resolve
 * to the matching entry from the curated `COLORS_LIST` palette in
 * `@/constants/common` for the currently-active text/background color, or
 * `undefined` when no palette color is active.
 *
 * WHY exported: this type is consumed as a prop by `./color-selector.tsx`
 * and `./alignment-selector.tsx` so those selectors can render active-state
 * highlights without each running an independent `useEditorState`
 * subscription — that single-subscription pattern is the performance
 * contract of this module. The inline TypeScript declaration below is the
 * source of truth for the field shape; this JSDoc intentionally does not
 * duplicate it.
 */
export type EditorStateType = {
  code: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  left: boolean;
  right: boolean;
  center: boolean;
  color:
    | {
        key: string;
        label: string;
        textColor: string;
        backgroundColor: string;
      }
    | undefined;
  backgroundColor:
    | {
        key: string;
        label: string;
        textColor: string;
        backgroundColor: string;
      }
    | undefined;
};

type Props = {
  disabledExtensions: TExtensions[];
  editor: Editor;
  extendedEditorProps: IEditorPropsExtended;
  flaggedExtensions: TExtensions[];
};

/**
 * Inline contextual formatting toolbar — the top-level bubble-menu component
 * rendered above the active text selection.
 *
 * Renders, inside a horizontally-scrolling rounded container: the node
 * selector, the link selector (hidden when `code` is active), the color
 * selector (hidden when `code` is active), the inline-style buttons mapped
 * from `formattingItems`, and the text-alignment selector.
 *
 * Props (see local `Props` type for the TypeScript signature — fields are not
 * duplicated here):
 *  - `editor` — the active TipTap `Editor` instance from `@tiptap/core`.
 *  - `disabledExtensions`, `flaggedExtensions` — `TExtensions[]` forwarded
 *    from `IEditorPropsExtended` (`@/types`); accepted for prop API
 *    stability across editor variants, currently unused in this component's
 *    render path.
 *  - `extendedEditorProps` — `IEditorPropsExtended` (`@/types`) forwarded
 *    extended config; accepted for API stability, currently unused in this
 *    component's render path.
 *
 * State consumed: subscribes to editor state ONCE via `useEditorState` and
 * propagates the resulting `EditorStateType` snapshot to the color and
 * alignment selectors as a prop, avoiding per-selector subscriptions.
 *
 * State managed:
 *  - `isSelecting: boolean` — true while the user is dragging to extend a
 *    text selection; while true the bubble menu is suppressed to avoid
 *    jitter mid-drag.
 *  - `menuRef: HTMLDivElement | null` — DOM ref for the toolbar container;
 *    used by the document-level `mousedown` handler to distinguish
 *    clicks-inside-the-menu from clicks-on-content.
 *
 * Side effects:
 *  - Document-level `mousedown` listener (managed by `useEffect`): when the
 *    user mouses-down outside the menu, transiently installs `mousemove`
 *    and `mouseup` listeners that detect whether the selection becomes
 *    non-empty during the drag; if so, `isSelecting` is set true to
 *    suppress the menu until the next `mouseup`. This prevents the menu
 *    from flickering during click-drag-to-select gestures.
 *  - `tippyOptions.onShow` sets `editor.storage.link.isBubbleMenuOpen =
 *    true` and dispatches `editor.commands.addActiveDropbarExtension(
 *    "bubble-menu")`, registering the menu in the editor's side-menu
 *    coordination registry. The `isBubbleMenuOpen` flag is a cross-extension
 *    signal that the custom-link extension reads to decide whether to render
 *    its own inline UI.
 *  - `tippyOptions.onHide` and `onHidden` reset
 *    `editor.storage.link.isBubbleMenuOpen = false` and dispatch
 *    `removeActiveDropbarExtension("bubble-menu")` inside a zero-delay
 *    `setTimeout`. The deferral sequences the dropbar registry update
 *    AFTER the current event loop tick so a simultaneous
 *    `addActiveDropbarExtension` call from another dropbar's synchronous
 *    `onShow` is not overwritten.
 *
 * TipTap framing:
 *  - EXPOSES the `editor` instance and the derived `EditorStateType` to the
 *    selector subcomponents as props, enabling them to render active-state
 *    highlights without running their own `useEditorState` subscriptions.
 *  - EXPOSES `@tiptap/react`'s `<BubbleMenu>` wrapper, configured with
 *    custom `shouldShow` and `tippyOptions`.
 *  - OVERRIDES the default `@tiptap/extension-bubble-menu` visibility
 *    predicate by adding gates for: empty selections, non-editable content,
 *    IMAGE / CUSTOM_IMAGE active states, ProseMirror `isNodeSelection`
 *    (block-level node selections), table `isCellSelection`, and active
 *    drag-selection gestures (`isSelecting`).
 *  - OVERRIDES the default tippy theme via `moveTransition: "transform
 *    0.15s ease-out"`, `duration: [300, 0]` (300 ms show, 0 ms hide for
 *    instant dismissal), and `zIndex: 9` (above editor content, below most
 *    app modals).
 *  - HIDES the upstream "show on any selection" behavior — the bubble menu
 *    is intentionally suppressed for non-text selections so it does not
 *    compete with the block menu (for ProseMirror node selections) or the
 *    table controls (for table cell selections).
 *
 * Behavior notes (WHY):
 *  - `formattingItems` is constructed once per render and reused both in the
 *    `useEditorState` selector (for `isActive()` checks) and in the rendered
 *    button row, keeping active-state evaluation and command dispatch tied
 *    to the same builder factories (single source of truth for command
 *    semantics).
 *  - `BubbleMenuLinkSelector` and `BubbleMenuColorSelector` are
 *    conditionally hidden when `editorState.code` is true because color
 *    marks and link marks are visually suppressed inside code blocks by
 *    most downstream renderers; the gate prevents users from applying
 *    styles that would silently disappear at render time.
 *
 * Consumer surface: mounted by `editors/document/` and `editors/rich-text/`
 * variants; NOT mounted by `editors/lite-text/` (single-line input contexts
 * suppress the bubble menu by design).
 */
export function EditorBubbleMenu(props: Props) {
  const { editor } = props;
  // states
  const [isSelecting, setIsSelecting] = useState(false);
  // refs
  const menuRef = useRef<HTMLDivElement>(null);

  const formattingItems = {
    code: CodeItem(editor),
    bold: BoldItem(editor),
    italic: ItalicItem(editor),
    underline: UnderLineItem(editor),
    strikethrough: StrikeThroughItem(editor),
    "text-align": TextAlignItem(editor),
  } satisfies {
    [K in TEditorCommands]?: EditorMenuItem<K>;
  };

  const editorState: EditorStateType = useEditorState({
    editor,
    selector: ({ editor }) => ({
      code: formattingItems.code.isActive(),
      bold: formattingItems.bold.isActive(),
      italic: formattingItems.italic.isActive(),
      underline: formattingItems.underline.isActive(),
      strikethrough: formattingItems.strikethrough.isActive(),
      left: formattingItems["text-align"].isActive({ alignment: "left" }),
      right: formattingItems["text-align"].isActive({ alignment: "right" }),
      center: formattingItems["text-align"].isActive({ alignment: "center" }),
      color: COLORS_LIST.find((c) => TextColorItem(editor).isActive({ color: c.key })),
      backgroundColor: COLORS_LIST.find((c) => BackgroundColorItem(editor).isActive({ color: c.key })),
    }),
  });

  const basicFormattingOptions = editorState.code
    ? [formattingItems.code]
    : [formattingItems.bold, formattingItems.italic, formattingItems.underline, formattingItems.strikethrough];

  const bubbleMenuProps: EditorBubbleMenuProps = {
    editor,
    shouldShow: ({ state, editor }) => {
      const { selection } = state;
      const { empty } = selection;

      if (
        empty ||
        !editor.isEditable ||
        editor.isActive(CORE_EXTENSIONS.IMAGE) ||
        editor.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE) ||
        isNodeSelection(selection) ||
        isCellSelection(selection) ||
        isSelecting
      ) {
        return false;
      }
      return true;
    },
    tippyOptions: {
      moveTransition: "transform 0.15s ease-out",
      duration: [300, 0],
      zIndex: 9,
      onShow: () => {
        if (editor.storage.link) {
          editor.storage.link.isBubbleMenuOpen = true;
        }
        editor.commands.addActiveDropbarExtension("bubble-menu");
      },
      onHide: () => {
        if (editor.storage.link) {
          editor.storage.link.isBubbleMenuOpen = false;
        }
        setTimeout(() => {
          editor.commands.removeActiveDropbarExtension("bubble-menu");
        }, 0);
      },
      onHidden: () => {
        if (editor.storage.link) {
          editor.storage.link.isBubbleMenuOpen = false;
        }
        setTimeout(() => {
          editor.commands.removeActiveDropbarExtension("bubble-menu");
        }, 0);
      },
    },
  };

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;

      function handleMouseMove() {
        if (!editor.state.selection.empty) {
          setIsSelecting(true);
          document.removeEventListener("mousemove", handleMouseMove);
        }
      }

      function handleMouseUp() {
        setIsSelecting(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      }

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [editor]);

  return (
    <BubbleMenu {...bubbleMenuProps}>
      {!isSelecting && (
        <div
          ref={menuRef}
          className="horizontal-scrollbar flex scrollbar-xs divide-x divide-subtle-1 overflow-x-scroll rounded-lg border border-subtle bg-surface-1 py-2 shadow-raised-200"
        >
          <div className="px-2">
            <BubbleMenuNodeSelector editor={editor} />
          </div>
          {!editorState.code && (
            <div className="px-2">
              <BubbleMenuLinkSelector editor={editor} />
            </div>
          )}
          {!editorState.code && (
            <div className="px-2">
              <BubbleMenuColorSelector editor={editor} editorState={editorState} />
            </div>
          )}
          <div className="flex gap-0.5 px-2">
            {basicFormattingOptions.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={(e) => {
                  item.command();
                  e.stopPropagation();
                }}
                className={cn(
                  "grid size-7 place-items-center rounded-sm text-tertiary transition-colors hover:bg-layer-1 active:bg-layer-1",
                  {
                    "bg-layer-1 text-primary": editorState[item.key],
                  }
                )}
              >
                <item.icon className="size-4" />
              </button>
            ))}
          </div>
          <TextAlignmentSelector editor={editor} editorState={editorState} />
        </div>
      )}
    </BubbleMenu>
  );
}
