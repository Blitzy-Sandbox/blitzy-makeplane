/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating block-context menu attached to TipTap drag handles in the
 * `@plane/editor` wrapper. Surrounds drag handles and block-level selections
 * with two fixed actions (delete current block, duplicate current block) and
 * node-specific options provided by `getNodeOptions(editor)` from
 * `./block-menu-options` (currently table-only — "Fit to width").
 *
 * Coordinates with the editor's side-menu extension by registering and
 * deregistering itself as an active dropbar via
 * `editor.commands.addActiveDropbarExtension` /
 * `removeActiveDropbarExtension`, both keyed on `CORE_EXTENSIONS.SIDE_MENU`
 * from `@/constants/extension`. This synchronization prevents keyboard and
 * click conflicts between simultaneously-mounted floating UI elements (e.g.,
 * the bubble menu and the block menu) that would otherwise both react to the
 * same input.
 *
 * Consumer surface: every editor variant under
 * `packages/editor/src/core/components/editors/` (document, lite-text,
 * rich-text) mounts `BlockMenu` unconditionally as part of its editor shell.
 */

import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useInteractions,
  FloatingPortal,
} from "@floating-ui/react";
import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyIcon, TrashIcon } from "@plane/propel/icons";
import type { ISvgIcons } from "@plane/propel/icons";
import { cn } from "@plane/utils";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import type { IEditorProps } from "@/types";
// components
import { getNodeOptions } from "./block-menu-options";

type Props = {
  disabledExtensions?: IEditorProps["disabledExtensions"];
  editor: Editor;
  flaggedExtensions?: IEditorProps["flaggedExtensions"];
  workItemIdentifier?: IEditorProps["workItemIdentifier"];
};
/**
 * Shared row contract for any node-specific or fixed-action entry rendered
 * inside {@link BlockMenu}. Also returned by `getNodeOptions(editor)` in
 * `./block-menu-options.tsx`, so any future contributor adding node-specific
 * block actions must construct values matching this type.
 *
 * The icon slot is intentionally permissive so the menu can render either
 * `LucideIcon` instances or Plane custom SVG icons typed as
 * `React.FC<ISvgIcons>` from `@plane/propel/icons`; see the type signature
 * below for the exact field shapes.
 *
 * A truthy `isDisabled` causes the item to be filtered out at render time
 * rather than rendered as a greyed-out button — disabled entries are hidden
 * entirely from the user, which is why callers should treat `isDisabled` as
 * "hide this row" rather than "show but block clicks".
 */
export type BlockMenuOption = {
  icon: LucideIcon | React.FC<ISvgIcons>;
  key: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  isDisabled?: boolean;
};

/**
 * Floating block-context menu attached to TipTap drag handles. Provides
 * delete, duplicate, and node-specific actions for the block under the
 * cursor.
 *
 * Props: see the local `Props` type. `editor` is the active TipTap `Editor`
 * instance from `@tiptap/react`. `disabledExtensions`, `flaggedExtensions`,
 * and `workItemIdentifier` are forwarded from `IEditorProps` (see `@/types`)
 * so downstream node-specific options can read them — they are not consumed
 * by the top-level `BlockMenu` render path itself.
 *
 * Side effects:
 *   - Listens on `document` for `click`, `contextmenu`, `keydown` (Escape),
 *     and `scroll` (capture phase) to drive the open/close lifecycle.
 *   - Mutates the editor command pipeline by calling
 *     `editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.SIDE_MENU)`
 *     on open and `removeActiveDropbarExtension(CORE_EXTENSIONS.SIDE_MENU)`
 *     on close, synchronizing with the side-menu extension's active-dropbar
 *     registry.
 *   - Issues editor mutations through `editor.chain()`:
 *     `deleteSelection().focus().run()` for Delete;
 *     `insertContentAt(insertPos, contentToInsert).focus(...).run()` for
 *     Duplicate.
 *   - Renders into a portal via `FloatingPortal` so the menu escapes any
 *     clipping ancestors.
 *
 * TipTap behavior:
 *   - Exposes `editor.chain().deleteSelection()` and
 *     `editor.chain().insertContentAt(...)` as the user-facing "Delete" and
 *     "Duplicate" actions.
 *   - Exposes the `BlockMenuOption[]` returned by `getNodeOptions(editor)`
 *     as additional node-specific actions appended after the fixed pair.
 *   - Overrides default block-level command surfacing by gating menu
 *     visibility on the side-menu extension's dropbar state — the menu only
 *     opens when a `#drag-handle` is targeted.
 *   - Hides default tippy.js theming in favor of Floating UI's
 *     `useFloating` + `FloatingPortal` for positioning, animation, and
 *     dismissal.
 *
 * Behavior notes (WHY):
 *   - Duplicate is `isDisabled` for image and custom-image selections
 *     because the first-child node type matches `CORE_EXTENSIONS.IMAGE` or
 *     `editor.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE)`. Duplicating an image
 *     node directly produces a malformed insertion that bypasses the
 *     upload/asset pipeline, so the menu hides the row rather than
 *     attempting an invalid insert.
 *   - The animation effect uses `setTimeout(50)` + `requestAnimationFrame`
 *     so Floating UI computes the final position before the transform and
 *     opacity transition begins — without this delay, the menu briefly
 *     flashes at `scale-75 opacity-0` from the wrong screen coordinates.
 *   - The scroll listener uses the capture phase (`true`) so the menu
 *     closes on scrolling from any ancestor element above the editor, not
 *     just the editor container itself.
 *   - A Floating UI virtual reference (`refs.setReference(virtualReferenceRef.current)`)
 *     is used instead of a direct DOM-node binding because the drag
 *     handle's DOM node identity changes as the cursor moves between
 *     blocks; the virtual reference always reports the latest
 *     `getBoundingClientRect()` from whichever `#drag-handle` is currently
 *     active.
 *
 * Consumer surface: every editor variant under
 * `packages/editor/src/core/components/editors/` (document, lite-text,
 * rich-text) mounts `BlockMenu`.
 */
export function BlockMenu(props: Props) {
  const { editor } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimatedIn, setIsAnimatedIn] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const virtualReferenceRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => new DOMRect(),
  });

  // Set up Floating UI with virtual reference element
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset({ crossAxis: -10 }), flip(), shift()],
    whileElementsMounted: autoUpdate,
    placement: "left-start",
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  const openBlockMenu = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true);
      editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.SIDE_MENU);
    }
  }, [editor, isOpen]);

  const closeBlockMenu = useCallback(() => {
    if (isOpen) {
      setIsOpen(false);
      editor.commands.removeActiveDropbarExtension(CORE_EXTENSIONS.SIDE_MENU);
    }
  }, [editor, isOpen]);

  // Handle click on drag handle
  const handleClickDragHandle = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const dragHandle = target.closest("#drag-handle");

      if (dragHandle) {
        event.preventDefault();

        // Update virtual reference with current drag handle position
        virtualReferenceRef.current = {
          getBoundingClientRect: () => dragHandle.getBoundingClientRect(),
        };

        // Set the virtual reference as the reference element
        refs.setReference(virtualReferenceRef.current);

        // Show the menu
        openBlockMenu();
        return;
      }

      // If clicking outside and not on a menu item, hide the menu
      if (menuRef.current && !menuRef.current.contains(target)) {
        closeBlockMenu();
      }
    },
    [refs, openBlockMenu, closeBlockMenu]
  );

  // Set up event listeners
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBlockMenu();
      }
    };

    const handleScroll = () => {
      closeBlockMenu();
    };

    document.addEventListener("click", handleClickDragHandle);
    document.addEventListener("contextmenu", handleClickDragHandle);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("click", handleClickDragHandle);
      document.removeEventListener("contextmenu", handleClickDragHandle);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [editor.commands, handleClickDragHandle, closeBlockMenu]);

  // Animation effect
  useEffect(() => {
    if (isOpen) {
      setIsAnimatedIn(false);
      // Add a small delay before starting the animation
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          setIsAnimatedIn(true);
        });
      }, 50);

      return () => clearTimeout(timeout);
    } else {
      setIsAnimatedIn(false);
    }
  }, [isOpen]);

  const MENU_ITEMS: BlockMenuOption[] = [
    {
      icon: TrashIcon,
      key: "delete",
      label: "Delete",
      onClick: (_e) => {
        // Execute the delete action
        editor.chain().deleteSelection().focus().run();
      },
    },
    {
      icon: CopyIcon,
      key: "duplicate",
      label: "Duplicate",
      isDisabled:
        editor.state.selection.content().content.firstChild?.type.name === CORE_EXTENSIONS.IMAGE ||
        editor.isActive(CORE_EXTENSIONS.CUSTOM_IMAGE),
      onClick: (_e) => {
        try {
          const { state } = editor;
          const { selection } = state;
          const firstChild = selection.content().content.firstChild;
          const docSize = state.doc.content.size;

          if (!firstChild) {
            throw new Error("No content selected or content is not duplicable.");
          }

          // Directly use selection.to as the insertion position
          const insertPos = selection.to;

          // Ensure the insertion position is within the document's bounds
          if (insertPos < 0 || insertPos > docSize) {
            throw new Error("The insertion position is invalid or outside the document.");
          }

          const contentToInsert = firstChild.toJSON();

          // Insert the content at the calculated position
          editor
            .chain()
            .insertContentAt(insertPos, contentToInsert, {
              updateSelection: true,
            })
            .focus(Math.min(insertPos + 1, docSize), { scrollIntoView: false })
            .run();
        } catch (error) {
          if (error instanceof Error) {
            console.error(error.message);
          }
        }
      },
    },
    ...getNodeOptions(editor),
  ];

  if (!isOpen) {
    return null;
  }

  return (
    <FloatingPortal>
      <div
        ref={(node) => {
          refs.setFloating(node);
          menuRef.current = node;
        }}
        style={{
          ...floatingStyles,
          animationFillMode: "forwards",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)", // Expo ease out
          zIndex: 100,
        }}
        className={cn(
          "max-h-60 min-w-[7rem] overflow-y-scroll rounded-lg border border-subtle bg-surface-1 p-1.5 shadow-raised-200",
          "origin-top-right transform transition-all duration-300",
          isAnimatedIn ? "scale-100 opacity-100" : "scale-75 opacity-0"
        )}
        {...getFloatingProps()}
      >
        {MENU_ITEMS.map((item) => {
          if (item.isDisabled) return null;

          return (
            <button
              key={item.key}
              type="button"
              className="flex w-full items-center gap-1.5 truncate rounded-sm px-1 py-1.5 text-11 text-secondary hover:bg-layer-1"
              onClick={(e) => {
                item.onClick(e);
                e.preventDefault();
                e.stopPropagation();
                closeBlockMenu();
              }}
              disabled={item.isDisabled}
            >
              <item.icon className="h-3 w-3" />
              {item.label}
            </button>
          );
        })}
      </div>
    </FloatingPortal>
  );
}
