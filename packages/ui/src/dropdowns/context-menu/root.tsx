/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Right-click context menu root container with positioning logic.
 *
 * Implements the public `ContextMenu` component, the recursive `TContextMenuItem` data shape
 * driving menu entries, the local `Portal` helper, and the `ContextMenuContext` used by nested
 * items to register their `closeSubmenu` callbacks. The internal `ContextMenuWithoutPortal`
 * controller subscribes to native `contextmenu` events on the parent ref, computes viewport-
 * aware coordinates (flipping left/up when the menu would overflow), and installs Escape,
 * Arrow, and Enter key handlers for keyboard navigation.
 *
 * The optional `#context-menu-portal` host element (if present in the DOM) is preferred as the
 * mount target; otherwise the controller is rendered inline. The host's presence is read
 * synchronously inside `ContextMenu`, so the document must already have it before the menu
 * mounts.
 */

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
// hooks
import { usePlatformOS } from "../../hooks/use-platform-os";
// helpers
import { cn } from "../../utils";
// components
import { ContextMenuItem } from "./item";

/**
 * Recursive item descriptor for a context-menu entry. Each item may render a custom React
 * node (`customContent`), a default `title` + `description` layout with optional `icon`, or
 * none of the above (the renderer simply skips items with `shouldRender === false`).
 *
 * Fields:
 *   - `key` (required): React reconciliation key; must be unique within a menu level.
 *   - `action` (required): invoked on click or Enter; for nested-only entries pass a no-op.
 *   - `customContent`: full render override; when set, `title`/`description`/`icon` are ignored.
 *   - `title`, `description`, `icon`: default render slots used when `customContent` is absent.
 *   - `shouldRender`: when `false`, the item is filtered out before render and before keyboard
 *     navigation accounting (so arrow keys skip hidden rows).
 *   - `closeOnClick` (default `true`): when `false`, clicking the row does NOT close the menu —
 *     useful for items that mutate state and want the menu to remain open.
 *   - `disabled`: greys the row and blocks `action`.
 *   - `className` / `iconClassName`: Tailwind class overrides on the row button / icon.
 *   - `nestedMenuItems`: when present and non-empty, the row becomes a submenu trigger and
 *     renders a chevron affordance; nested items follow the same descriptor recursively.
 */
export type TContextMenuItem = {
  key: string;
  customContent?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.FC<any>;
  action: () => void;
  shouldRender?: boolean;
  closeOnClick?: boolean;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  nestedMenuItems?: TContextMenuItem[];
};

// Portal component for nested menus
interface PortalProps {
  children: React.ReactNode;
  container?: Element | null;
}

/**
 * Client-only portal helper used by `ContextMenuItem` to mount nested submenu panels into
 * `document.body` (or `container` if provided) so they escape parent overflow/transform
 * stacking contexts.
 *
 * Rendering is deferred until first mount (`useEffect` flips `mounted` from `false` to `true`)
 * so SSR output is `null` and the portal only attaches after hydration.
 *
 * Props (local `PortalProps`):
 *   - `children` (required): subtree to portal.
 *   - `container`: target element; defaults to `document.body`.
 */
export function Portal({ children, container }: PortalProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) {
    return null;
  }

  const targetContainer = container || document.body;
  return ReactDOM.createPortal(children, targetContainer);
}

/**
 * React context shared between `ContextMenu` (controller) and `ContextMenuItem` (rows).
 * Surfaces:
 *   - `closeAllSubmenus`: invokes every registered submenu's close callback. The controller
 *     calls this when the user opens a new menu or dismisses the entire context menu.
 *   - `registerSubmenu`: each `ContextMenuItem` with nested items registers its
 *     `closeNestedMenu` callback here on mount and unregisters on unmount. Returns the
 *     unregister function so the effect can clean up.
 *   - `portalContainer`: optional DOM element passed through to nested-menu `Portal`
 *     instances; defaults to `document.body` when omitted.
 */
// Context for managing nested menus
export const ContextMenuContext = React.createContext<{
  closeAllSubmenus: () => void;
  registerSubmenu: (closeSubmenu: () => void) => () => void;
  portalContainer?: Element | null;
} | null>(null);

type ContextMenuProps = {
  parentRef: React.RefObject<HTMLElement>;
  items: TContextMenuItem[];
  portalContainer?: Element | null;
};

/**
 * Internal controller for `ContextMenu`. Owns the open/closed state, calculated `{x, y}`
 * position, active item index for keyboard navigation, and the set of registered nested-submenu
 * close callbacks.
 *
 * Behavior:
 *   - Subscribes to native `contextmenu` events on `parentRef.current`, preventing the
 *     browser's default menu and storing the click coordinates. Skips entirely on mobile
 *     (`isMobile` from `usePlatformOS`) — touch devices do not trigger right-click context menus.
 *   - Flips the menu's `top` / `left` when the calculated position would overflow the viewport.
 *   - Installs a window-level `keydown` listener for Escape (close), ArrowDown / ArrowUp (cycle
 *     active item), and Enter (invoke `items[activeItemIndex].action` and conditionally close).
 *   - Installs a document-level `mousedown` capture listener that closes the menu on outside
 *     clicks. Clicks on `[data-context-submenu="true"]` (nested-menu elements) and clicks inside
 *     `contextMenuRef.current` are explicitly preserved as "inside" so they do not collapse the menu.
 *
 * The rendered root is a fullscreen pointer-events-`none` overlay that becomes interactive
 * (`pointer-events-auto`, `opacity-100`) only when `isOpen` is true; this preserves transition
 * timing without unmounting the menu DOM.
 */
function ContextMenuWithoutPortal(props: ContextMenuProps) {
  const { parentRef, items, portalContainer } = props;
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
  });
  const [activeItemIndex, setActiveItemIndex] = useState<number>(0);
  // refs
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const submenuClosersRef = useRef<Set<() => void>>(new Set());
  // derived values
  const renderedItems = items.filter((item) => item.shouldRender !== false);
  const { isMobile } = usePlatformOS();

  const closeAllSubmenus = React.useCallback(() => {
    submenuClosersRef.current.forEach((closeSubmenu) => closeSubmenu());
  }, []);

  const registerSubmenu = React.useCallback((closeSubmenu: () => void) => {
    submenuClosersRef.current.add(closeSubmenu);
    return () => {
      submenuClosersRef.current.delete(closeSubmenu);
    };
  }, []);

  const handleClose = () => {
    closeAllSubmenus();
    setIsOpen(false);
    setActiveItemIndex(0);
  };

  // calculate position of context menu
  useEffect(() => {
    const parentElement = parentRef.current;
    const contextMenu = contextMenuRef.current;
    if (!parentElement || !contextMenu) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (isMobile) return;

      e.preventDefault();
      e.stopPropagation();

      const contextMenuWidth = contextMenu.clientWidth;
      const contextMenuHeight = contextMenu.clientHeight;

      const clickX = e?.pageX || 0;
      const clickY = e?.pageY || 0;

      // check if there's enough space at the bottom, otherwise show at the top
      let top = clickY;
      if (clickY + contextMenuHeight > window.innerHeight) top = clickY - contextMenuHeight;

      // check if there's enough space on the right, otherwise show on the left
      let left = clickX;
      if (clickX + contextMenuWidth > window.innerWidth) left = clickX - contextMenuWidth;

      setPosition({ x: left, y: top });
      setIsOpen(true);
    };

    const hideContextMenu = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Escape") handleClose();
    };

    parentElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", hideContextMenu);

    return () => {
      parentElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", hideContextMenu);
    };
  }, [contextMenuRef, isMobile, isOpen, parentRef, setIsOpen, setPosition]);

  // handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveItemIndex((prev) => (prev + 1) % renderedItems.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveItemIndex((prev) => (prev - 1 + renderedItems.length) % renderedItems.length);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = renderedItems[activeItemIndex];
        if (!item.disabled) {
          renderedItems[activeItemIndex].action();
          if (item.closeOnClick !== false) handleClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeItemIndex, isOpen, renderedItems, setIsOpen]);

  // Custom handler for nested menu portal clicks
  React.useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if the click is on a nested menu element
      const isNestedMenuClick = target.closest('[data-context-submenu="true"]');
      const isMainMenuClick = contextMenuRef.current?.contains(target);

      // Also check if the target itself has the data attribute
      const isNestedMenuElement = target.hasAttribute("data-context-submenu");

      // If it's a nested menu click, main menu click, or nested menu element, don't close
      if (isNestedMenuClick || isMainMenuClick || isNestedMenuElement) {
        return;
      }

      // If menu is open and it's an outside click, close it
      if (isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      // Use capture phase to ensure we handle the event before other handlers
      document.addEventListener("mousedown", handleDocumentClick, true);
      return () => {
        document.removeEventListener("mousedown", handleDocumentClick, true);
      };
    }
  }, [isOpen, handleClose]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-0 left-0 z-30 h-screen w-screen cursor-default opacity-0 transition-opacity",
        {
          "pointer-events-auto opacity-100": isOpen,
        }
      )}
    >
      <div
        ref={contextMenuRef}
        className="vertical-scrollbar fixed scrollbar-sm max-h-72 min-w-[12rem] overflow-y-scroll rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-2 py-2.5"
        style={{
          top: position.y,
          left: position.x,
        }}
        data-context-menu="true"
      >
        <ContextMenuContext.Provider value={{ closeAllSubmenus, registerSubmenu, portalContainer }}>
          {renderedItems.map((item, index) => (
            <ContextMenuItem
              key={item.key}
              handleActiveItem={() => setActiveItemIndex(index)}
              handleClose={handleClose}
              isActive={index === activeItemIndex}
              item={item}
            />
          ))}
        </ContextMenuContext.Provider>
      </div>
    </div>
  );
}

/**
 * Top-level public component for right-click context menus. Wraps the internal
 * `ContextMenuWithoutPortal` controller and optionally mounts it into the
 * `#context-menu-portal` host element when that element exists in the DOM.
 *
 * Consumers attach the menu to a target by passing a `parentRef` (any DOM element ref):
 * `contextmenu` events fired on that element open the menu at the click coordinates.
 *
 * Props (local `ContextMenuProps`):
 *   - `parentRef` (required): React ref pointing at the element to listen for `contextmenu` on.
 *   - `items` (required): the `TContextMenuItem[]` to render; nested items create submenus.
 *   - `portalContainer`: optional override passed down through `ContextMenuContext` so nested
 *     submenu panels can portal into a non-default container.
 *
 * Accessibility: keyboard activation requires the parent element to have focus; ArrowUp /
 * ArrowDown cycle, Enter activates, Escape closes. INTENT UNCLEAR: there is no explicit
 * `role="menu"` / `role="menuitem"` ARIA wiring on the rendered overlay; assistive tech will
 * announce the buttons but not their grouping as a menu.
 */
export function ContextMenu(props: ContextMenuProps) {
  let contextMenu = <ContextMenuWithoutPortal {...props} />;
  const portal = document.querySelector("#context-menu-portal");
  if (portal) contextMenu = ReactDOM.createPortal(contextMenu, portal);
  return contextMenu;
}
