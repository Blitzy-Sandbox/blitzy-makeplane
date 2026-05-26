/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Individual menu item rendered inside a context menu. Acts as both leaf-action button and as
 * submenu trigger, depending on whether the supplied `TContextMenuItem.nestedMenuItems` array
 * is present and non-empty.
 *
 * Leaf items invoke `item.action()` on click and conditionally close the entire menu via
 * `handleClose()` based on `item.closeOnClick`. Submenu-trigger items toggle a portaled nested
 * panel positioned to the right of the trigger via `react-popper` with `strategy: "fixed"`, and
 * coordinate sibling closure through the parent `ContextMenuContext.registerSubmenu`.
 */

import React, { useState, useRef, useContext } from "react";
import { usePopper } from "react-popper";
import { ChevronRightIcon } from "@plane/propel/icons";
// helpers
import { cn } from "../../utils";
// types
import type { TContextMenuItem } from "./root";
import { ContextMenuContext, Portal } from "./root";

/**
 * Prop contract passed by the parent `ContextMenu` controller. Not exported — strictly internal
 * to this folder.
 *
 *   - `handleActiveItem`: called when the row receives a mouse-enter; updates the parent's
 *     `activeItemIndex` so keyboard navigation reflects the hovered row.
 *   - `handleClose`: closes the entire context menu (NOT just the nested submenu).
 *   - `isActive`: when `true`, the row gets the active background tint; driven by the parent's
 *     `activeItemIndex` keyboard navigation.
 *   - `item`: the `TContextMenuItem` descriptor to render.
 */
type ContextMenuItemProps = {
  handleActiveItem: () => void;
  handleClose: () => void;
  isActive: boolean;
  item: TContextMenuItem;
};

/**
 * Row-level renderer for a single `TContextMenuItem`. Returns `null` when `item.shouldRender`
 * is `false`. Renders a `<button>` that either:
 *
 *   - Calls `item.action()` + conditionally `handleClose()` (leaf items), or
 *   - Toggles a nested submenu panel (when `item.nestedMenuItems` is present), portaled via
 *     `<Portal container={contextMenuContext?.portalContainer}>` and positioned with `usePopper`
 *     using `strategy: "fixed"` to escape overflow constraints. The nested popper modifiers
 *     include a 4 px offset, fallback placements (`left-start`, `right-end`, `left-end`,
 *     `top-start`, `bottom-start`), and `preventOverflow` with 8 px padding.
 *
 * Submenu coordination:
 *   - On mount with nested items, registers `closeNestedMenu` with the parent
 *     `ContextMenuContext`; on unmount or when nested items disappear, unregisters.
 *   - Before opening this submenu, calls `contextMenuContext.closeAllSubmenus()` to dismiss any
 *     sibling that is open.
 *   - Hover-to-open: `handleMouseEnter` opens the submenu when nested items exist (in addition
 *     to updating `activeItemIndex`).
 *   - Keyboard nav inside the open submenu: ArrowUp / ArrowDown cycle `activeNestedIndex`,
 *     Enter activates the focused nested item (calling `handleNestedItemClick`), ArrowLeft
 *     collapses the submenu.
 *
 * Each nested-menu button carries `data-context-submenu="true"` so the parent controller's
 * outside-click handler treats clicks inside the submenu as inside-clicks and does not close
 * the parent menu.
 *
 * Render content rules:
 *   - When `item.customContent` is set, it is rendered verbatim and `title`/`description`/`icon`
 *     are skipped.
 *   - Otherwise the default layout renders `item.icon`, `item.title`, and (if present)
 *     `item.description`. Submenu triggers also append a `ChevronRightIcon` affordance.
 *
 * Accessibility: rendered as a native `<button type="button">`, so Space/Enter activate.
 * ArrowLeft on an open submenu collapses it. INTENT UNCLEAR: there is no `role="menuitem"`
 * ARIA wiring on the rendered button; the parent controller in `root.tsx` likewise omits
 * `role="menu"`, so assistive tech will not announce the menu grouping.
 */
export function ContextMenuItem(props: ContextMenuItemProps) {
  const { handleActiveItem, handleClose, isActive, item } = props;

  // Nested menu state
  const [isNestedOpen, setIsNestedOpen] = useState(false);
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [activeNestedIndex, setActiveNestedIndex] = useState<number>(0);
  const nestedMenuRef = useRef<HTMLDivElement | null>(null);

  const contextMenuContext = useContext(ContextMenuContext);
  const hasNestedItems = item.nestedMenuItems && item.nestedMenuItems.length > 0;
  const renderedNestedItems = item.nestedMenuItems?.filter((nestedItem) => nestedItem.shouldRender !== false) || [];

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "right-start",
    strategy: "fixed",
    modifiers: [
      {
        name: "offset",
        options: {
          offset: [0, 4],
        },
      },
      {
        name: "flip",
        options: {
          fallbackPlacements: ["left-start", "right-end", "left-end", "top-start", "bottom-start"],
        },
      },
      {
        name: "preventOverflow",
        options: {
          padding: 8,
        },
      },
    ],
  });

  const closeNestedMenu = React.useCallback(() => {
    setIsNestedOpen(false);
    setActiveNestedIndex(0);
  }, []);

  // Register this nested menu with the main context
  React.useEffect(() => {
    if (contextMenuContext && hasNestedItems) {
      return contextMenuContext.registerSubmenu(closeNestedMenu);
    }
  }, [contextMenuContext, hasNestedItems, closeNestedMenu]);

  const handleItemClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (hasNestedItems) {
      // Toggle nested menu
      if (!isNestedOpen && contextMenuContext) {
        contextMenuContext.closeAllSubmenus();
      }
      setIsNestedOpen(!isNestedOpen);
    } else {
      // Execute action for regular items
      item.action();
      if (item.closeOnClick !== false) handleClose();
    }
  };

  const handleMouseEnter = () => {
    handleActiveItem();

    if (hasNestedItems) {
      // Close other submenus and open this one
      if (contextMenuContext) {
        contextMenuContext.closeAllSubmenus();
      }
      setIsNestedOpen(true);
    }
  };

  const handleNestedItemClick = (nestedItem: TContextMenuItem, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    nestedItem.action();
    if (nestedItem.closeOnClick !== false) {
      handleClose(); // Close the entire context menu
    }
  };

  // Handle keyboard navigation for nested items
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isNestedOpen || !hasNestedItems) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveNestedIndex((prev) => (prev + 1) % renderedNestedItems.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveNestedIndex((prev) => (prev - 1 + renderedNestedItems.length) % renderedNestedItems.length);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const nestedItem = renderedNestedItems[activeNestedIndex];
        if (!nestedItem.disabled) {
          handleNestedItemClick(nestedItem);
        }
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        closeNestedMenu();
      }
    };

    if (isNestedOpen && nestedMenuRef.current) {
      const menuElement = nestedMenuRef.current;
      menuElement.addEventListener("keydown", handleKeyDown);
      // Ensure the menu can receive keyboard events
      menuElement.setAttribute("tabindex", "-1");
      menuElement.focus();
      return () => {
        menuElement.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isNestedOpen, activeNestedIndex, renderedNestedItems, hasNestedItems, closeNestedMenu]);

  if (item.shouldRender === false) return null;

  return (
    <>
      <button
        ref={setReferenceElement}
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-11 text-secondary select-none",
          {
            "bg-layer-transparent-hover": isActive,
            "text-placeholder": item.disabled,
          },
          item.className
        )}
        onClick={handleItemClick}
        onMouseEnter={handleMouseEnter}
        disabled={item.disabled}
      >
        {item.customContent ?? (
          <>
            {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
            <div className="flex-1">
              <h5>{item.title}</h5>
              {item.description && (
                <p
                  className={cn("whitespace-pre-line text-tertiary", {
                    "text-placeholder": item.disabled,
                  })}
                >
                  {item.description}
                </p>
              )}
            </div>
            {hasNestedItems && <ChevronRightIcon className="h-3 w-3 flex-shrink-0" />}
          </>
        )}
      </button>

      {/* Nested Menu */}
      {hasNestedItems && isNestedOpen && (
        <Portal container={contextMenuContext?.portalContainer}>
          <div
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
            className="fixed z-[35] min-w-[12rem] overflow-hidden rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-2 py-2.5 text-11"
            data-context-submenu="true"
          >
            <div ref={nestedMenuRef} className="vertical-scrollbar scrollbar-sm max-h-72 overflow-y-scroll">
              {renderedNestedItems.map((nestedItem, index) => (
                <button
                  key={nestedItem.key}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-11 text-secondary select-none",
                    {
                      "bg-layer-transparent-hover": index === activeNestedIndex,
                      "text-placeholder": nestedItem.disabled,
                    },
                    nestedItem.className
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleNestedItemClick(nestedItem, e);
                  }}
                  onMouseEnter={() => setActiveNestedIndex(index)}
                  disabled={nestedItem.disabled}
                  data-context-submenu="true"
                >
                  {nestedItem.customContent ?? (
                    <>
                      {nestedItem.icon && <nestedItem.icon className={cn("h-3 w-3", nestedItem.iconClassName)} />}
                      <div>
                        <h5>{nestedItem.title}</h5>
                        {nestedItem.description && (
                          <p
                            className={cn("whitespace-pre-line text-tertiary", {
                              "text-placeholder": nestedItem.disabled,
                            })}
                          >
                            {nestedItem.description}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
