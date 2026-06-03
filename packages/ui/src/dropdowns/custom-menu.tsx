/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Headless UI Menu-based dropdown for action menus (vs. value-selection dropdowns).
 *
 * Use this for triggering actions ("Delete", "Archive", "Duplicate") rather than picking a value.
 * For value selection use `custom-select.tsx` or `custom-search-select.tsx`.
 *
 * Composes: a `Menu` root with multiple trigger variants (custom button, horizontal/vertical
 * ellipsis, or labelled button), a popper-positioned `Menu.Items` panel that can be optionally
 * portaled, hover-open behavior, close-on-select coordination, outside-click dismissal, and a
 * `SubMenu` system that coordinates sibling closure through `MenuContext`.
 *
 * Subcomponents exposed as static members: `CustomMenu.Portal`, `CustomMenu.MenuItem`,
 * `CustomMenu.SubMenu`, `CustomMenu.SubMenuTrigger`, `CustomMenu.SubMenuContent`.
 */

import { Menu } from "@headlessui/react";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import ReactDOM from "react-dom";
import { usePopper } from "react-popper";
import { useOutsideClickDetector } from "@plane/hooks";
import { ChevronDownIcon, ChevronRightIcon } from "@plane/propel/icons";
// plane helpers
// helpers
import { useDropdownKeyDown } from "../hooks/use-dropdown-key-down";
import { cn } from "../utils";
// hooks
// types
import type {
  ICustomMenuDropdownProps,
  ICustomMenuItemProps,
  ICustomSubMenuProps,
  ICustomSubMenuTriggerProps,
  ICustomSubMenuContentProps,
} from "./helper";

interface PortalProps {
  children: React.ReactNode;
  container?: Element | null;
  asChild?: boolean;
}

/**
 * Client-only portal helper used by `CustomMenu` and `SubMenu` to render menu panels into
 * `document.body` (or a caller-supplied container) so they escape parent overflow/stacking
 * contexts.
 *
 * Rendering is deferred until the component has mounted (`useEffect` flips `mounted`) to
 * avoid SSR mismatches — server-rendered output is `null` and the portal only attaches after
 * hydration.
 *
 * Props (local `PortalProps`):
 *   - `children` (required): React subtree to portal.
 *   - `container`: target element; defaults to `document.body`.
 *   - `asChild` (default `false`): when `true`, the children are portaled directly; when
 *     `false`, they are wrapped in a `<div data-radix-portal="">` for compatibility with
 *     consumers that scope styles or event delegation by that attribute.
 */
function Portal({ children, container, asChild = false }: PortalProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) {
    return null;
  }

  const targetContainer = container || document.body;

  if (asChild) {
    return ReactDOM.createPortal(children, targetContainer);
  }

  return ReactDOM.createPortal(<div data-radix-portal="">{children}</div>, targetContainer);
}

// Context for main menu to communicate with submenus
const MenuContext = React.createContext<{
  closeAllSubmenus: () => void;
  registerSubmenu: (closeSubmenu: () => void) => () => void;
} | null>(null);

/**
 * Action-menu dropdown built on Headless UI `Menu`. Distinct from `CustomSelect` and
 * `CustomSearchSelect`: this primitive triggers actions (Delete, Archive, Duplicate) rather
 * than selecting a value.
 *
 * Composes Headless UI `Menu` with three trigger variants (custom button → ellipsis →
 * labelled chevron button), `react-popper` placement, optional portal mounting into a caller-
 * supplied container, hover-open/close coordination with a 150 ms grace period for moving to
 * a submenu, and a `MenuContext`-mediated submenu system where each nested `SubMenu` registers
 * a close callback so siblings can be dismissed when a new one opens.
 *
 * The component runs its OWN outside-click handler (a `mousedown` listener) in addition to
 * `useOutsideClickDetector` because portaled menus live outside `dropdownRef` and need to
 * recognise clicks on `[data-prevent-outside-click="true"]` (submenu panels) as inside-clicks.
 *
 * Props (see `ICustomMenuDropdownProps` in `./helper`):
 *   - `children` (required): typically `<CustomMenu.MenuItem>` and `<CustomMenu.SubMenu>` entries.
 *   - Trigger: `customButton` / `ellipsis` (horizontal MoreHorizontal) / `verticalEllipsis`
 *     (rotated 90°) / `label` (default button text) / `noChevron` / `noBorder`.
 *   - Behavior: `closeOnSelect` / `openOnHover` (150 ms close delay) / `disabled` /
 *     `menuButtonOnClick` / `onMenuClose` / `useCaptureForOutsideClick`.
 *   - Panel: `placement` (default `"auto"`) / `maxHeight` (default `"md"`) /
 *     `menuItemsClassName` / `optionsClassName` / `portalElement` (mount target).
 *   - Accessibility: `ariaLabel` — required for icon-only ellipsis triggers.
 *
 * Accessibility: Headless UI Menu provides ARIA `menu` role, `aria-expanded`, `aria-haspopup`,
 * arrow-key navigation between items, Enter to activate, Escape to close. The local
 * `useDropdownKeyDown` adds Enter-to-open and an active-item activator used by keyboard input.
 */
function CustomMenu(props: ICustomMenuDropdownProps) {
  const {
    ariaLabel,
    buttonClassName = "",
    customButtonClassName = "",
    customButtonTabIndex = 0,
    placement,
    children,
    className = "",
    customButton,
    disabled = false,
    ellipsis = false,
    label,
    maxHeight = "md",
    noBorder = false,
    noChevron = false,
    optionsClassName = "",
    menuItemsClassName = "",
    verticalEllipsis = false,
    portalElement,
    menuButtonOnClick,
    onMenuClose,
    tabIndex,
    closeOnSelect,
    openOnHover = false,
    useCaptureForOutsideClick = false,
  } = props;

  const [referenceElement, setReferenceElement] = React.useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = React.useState<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  // refs
  const dropdownRef = React.useRef<HTMLDivElement | null>(null);
  const submenuClosersRef = React.useRef<Set<() => void>>(new Set());

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "auto",
  });

  const closeAllSubmenus = React.useCallback(() => {
    submenuClosersRef.current.forEach((closeSubmenu) => closeSubmenu());
  }, []);

  const registerSubmenu = React.useCallback((closeSubmenu: () => void) => {
    submenuClosersRef.current.add(closeSubmenu);
    return () => {
      submenuClosersRef.current.delete(closeSubmenu);
    };
  }, []);

  const openDropdown = () => {
    setIsOpen(true);
    if (referenceElement) referenceElement.focus();
  };

  const closeDropdown = React.useCallback(() => {
    if (isOpen) {
      closeAllSubmenus();
      onMenuClose?.();
    }
    setIsOpen(false);
  }, [isOpen, closeAllSubmenus, onMenuClose]);

  const selectActiveItem = () => {
    const activeItem: HTMLElement | undefined | null = dropdownRef.current?.querySelector(
      `[data-headlessui-state="active"] button`
    );
    activeItem?.click();
  };

  const handleKeyDown = useDropdownKeyDown(openDropdown, closeDropdown, isOpen, selectActiveItem);

  const handleOnClick = () => {
    if (closeOnSelect) closeDropdown();
  };

  const handleMenuButtonClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
    if (menuButtonOnClick) menuButtonOnClick();
  };

  const handleMouseEnter = () => {
    if (openOnHover) openDropdown();
  };

  const handleMouseLeave = () => {
    if (openOnHover && isOpen) {
      setTimeout(() => {
        // Only close if menu is still open
        if (isOpen) {
          closeDropdown();
        }
      }, 150); // Small delay to allow moving to submenu
    }
  };

  useOutsideClickDetector(dropdownRef, closeDropdown, useCaptureForOutsideClick);

  // Custom handler for submenu portal clicks
  React.useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isSubmenuClick = target.closest('[data-prevent-outside-click="true"]');
      const isMainMenuClick = dropdownRef.current?.contains(target);

      // If it's a submenu click or main menu click, don't close
      if (isSubmenuClick || isMainMenuClick) {
        return;
      }

      // If menu is open and it's an outside click, close it
      if (isOpen) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleDocumentClick, useCaptureForOutsideClick);

      return () => {
        document.removeEventListener("mousedown", handleDocumentClick, useCaptureForOutsideClick);
      };
    }
  }, [isOpen, closeDropdown, useCaptureForOutsideClick]);

  let menuItems = (
    <Menu.Items
      data-prevent-outside-click={!!portalElement}
      className={cn(
        "fixed z-30 translate-y-0",
        menuItemsClassName
      )} /** translate-y-0 is a hack to create new stacking context. Required for safari  */
      static
    >
      <div
        className={cn(
          "my-1 min-w-[12rem] overflow-y-scroll rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-2 py-2.5 text-11 whitespace-nowrap focus:outline-none",
          {
            "max-h-60": maxHeight === "lg",
            "max-h-48": maxHeight === "md",
            "max-h-36": maxHeight === "rg",
            "max-h-28": maxHeight === "sm",
          },
          optionsClassName
        )}
        ref={setPopperElement}
        style={styles.popper}
        {...attributes.popper}
      >
        <MenuContext.Provider value={{ closeAllSubmenus, registerSubmenu }}>{children}</MenuContext.Provider>
      </div>
    </Menu.Items>
  );

  if (portalElement) {
    menuItems = ReactDOM.createPortal(menuItems, portalElement);
  }

  return (
    <Menu
      as="div"
      ref={dropdownRef}
      tabIndex={tabIndex}
      className={cn("relative w-min text-left", className)}
      onKeyDownCapture={handleKeyDown}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        handleOnClick();
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-main-menu="true"
    >
      {({ open }) => (
        <>
          {customButton ? (
            <Menu.Button as={React.Fragment}>
              <button
                ref={setReferenceElement}
                type="button"
                onClick={handleMenuButtonClick}
                className={customButtonClassName}
                tabIndex={customButtonTabIndex}
                disabled={disabled}
                aria-label={ariaLabel}
              >
                {customButton}
              </button>
            </Menu.Button>
          ) : (
            <>
              {ellipsis || verticalEllipsis ? (
                <Menu.Button as={React.Fragment}>
                  <button
                    ref={setReferenceElement}
                    type="button"
                    onClick={handleMenuButtonClick}
                    disabled={disabled}
                    className={`relative grid place-items-center rounded-sm p-1 text-secondary outline-none hover:text-primary ${
                      disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-layer-transparent-hover"
                    } ${buttonClassName}`}
                    tabIndex={customButtonTabIndex}
                    aria-label={ariaLabel}
                  >
                    <MoreHorizontal className={`h-3.5 w-3.5 ${verticalEllipsis ? "rotate-90" : ""}`} />
                  </button>
                </Menu.Button>
              ) : (
                <Menu.Button as={React.Fragment}>
                  <button
                    ref={setReferenceElement}
                    type="button"
                    className={`flex items-center justify-between gap-1 rounded-md px-2.5 py-1 text-11 whitespace-nowrap duration-300 ${
                      open ? "text-primary" : "text-secondary"
                    } ${noBorder ? "" : "shadow-sm border border-strong focus:outline-none"} ${
                      disabled ? "cursor-not-allowed text-secondary" : "cursor-pointer hover:bg-layer-transparent-hover"
                    } ${buttonClassName}`}
                    onClick={handleMenuButtonClick}
                    tabIndex={customButtonTabIndex}
                    disabled={disabled}
                    aria-label={ariaLabel}
                  >
                    {label}
                    {!noChevron && <ChevronDownIcon className="h-3.5 w-3.5" />}
                  </button>
                </Menu.Button>
              )}
            </>
          )}
          {isOpen && menuItems}
        </>
      )}
    </Menu>
  );
}

// SubMenu context for closing submenu from nested items
const SubMenuContext = React.createContext<{ closeSubmenu: () => void } | null>(null);

// Hook to use submenu context
const useSubMenu = () => React.useContext(SubMenuContext);

// SubMenu implementation
/**
 * Nested submenu rendered inside a `CustomMenu`. The trigger row appears as a `Menu.Item` with
 * a `ChevronRightIcon` affordance; clicking or hovering the row toggles a portaled panel
 * positioned to the right of the trigger via `react-popper` with `strategy: "fixed"` (so the
 * panel escapes overflow constraints of the parent menu).
 *
 * Each `SubMenu` registers a `closeSubmenu` callback with the parent `MenuContext` so the
 * `CustomMenu` can close ALL submenus on outer dismissal, and so a newly-opened submenu can
 * close its siblings.
 *
 * The portaled content carries `data-prevent-outside-click="true"` so the parent menu's
 * outside-click handler treats clicks inside the submenu as inside-clicks. Hover events on the
 * panel re-dispatch synthetic `mouseenter`/`mouseleave` to the parent `data-main-menu="true"`
 * element so the parent's hover-open delay does not collapse the menu while the cursor is on
 * a submenu panel.
 *
 * Popper modifiers: 4 px offset, fallback placements (`left-start`, `right-end`, `left-end`,
 * `top-start`, `bottom-start`), and `preventOverflow` with 8 px padding.
 *
 * Props (see `ICustomSubMenuProps` in `./helper`):
 *   - `trigger` (required): row content shown in the parent menu.
 *   - `children` (required): submenu panel content (typically `CustomMenu.MenuItem` entries).
 *   - `disabled`: greys out the trigger and blocks open.
 *   - `className` / `contentClassName`: trigger / panel class overrides.
 *   - `placement` (default `"right-start"`): popper placement.
 */
function SubMenu(props: ICustomSubMenuProps) {
  const {
    children,
    trigger,
    disabled = false,
    className = "",
    contentClassName = "",
    placement = "right-start",
  } = props;

  const [isOpen, setIsOpen] = React.useState(false);
  const [referenceElement, setReferenceElement] = React.useState<HTMLSpanElement | null>(null);
  const [popperElement, setPopperElement] = React.useState<HTMLDivElement | null>(null);
  const submenuRef = React.useRef<HTMLDivElement | null>(null);

  const menuContext = React.useContext(MenuContext);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement,
    strategy: "fixed", // Use fixed positioning to escape overflow constraints
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

  const closeSubmenu = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  // Register this submenu with the main menu context
  React.useEffect(() => {
    if (menuContext) {
      return menuContext.registerSubmenu(closeSubmenu);
    }
  }, [menuContext, closeSubmenu]);

  const toggleSubmenu = () => {
    if (!disabled) {
      // Close other submenus when opening this one
      if (!isOpen && menuContext) {
        menuContext.closeAllSubmenus();
      }
      setIsOpen(!isOpen);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSubmenu();
  };

  // Close submenu when clicking on other menu items
  React.useEffect(() => {
    const handleMenuItemClick = (e: Event) => {
      const target = e.target as HTMLElement;
      // Check if the click is on a menu item that's not part of this submenu
      if (target.closest('[role="menuitem"]') && !submenuRef.current?.contains(target)) {
        closeSubmenu();
      }
    };

    document.addEventListener("click", handleMenuItemClick);
    return () => {
      document.removeEventListener("click", handleMenuItemClick);
    };
  }, [closeSubmenu]);

  return (
    <div ref={submenuRef} className={cn("relative", className)}>
      <span ref={setReferenceElement} className="w-full">
        <Menu.Item as="div" disabled={disabled}>
          {({ active }) => (
            <div
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-sm px-1 py-1.5 text-left text-secondary select-none",
                {
                  "bg-layer-transparent-hover": active && !disabled,
                  "text-placeholder": disabled,
                  "cursor-not-allowed": disabled,
                }
              )}
              onClick={handleClick}
            >
              <span className="flex-1">{trigger}</span>
              <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0" />
            </div>
          )}
        </Menu.Item>
      </span>

      {isOpen && (
        <Portal>
          <div
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
            className={cn(
              "fixed z-30 min-w-[12rem] overflow-hidden rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 text-11",
              contentClassName
            )}
            data-prevent-outside-click="true"
            onMouseEnter={() => {
              // Notify parent menu that we're hovering over submenu
              const mainMenuElement = document.querySelector('[data-main-menu="true"]');
              if (mainMenuElement) {
                const mouseEnterEvent = new MouseEvent("mouseenter", { bubbles: true });
                mainMenuElement.dispatchEvent(mouseEnterEvent);
              }
            }}
            onMouseLeave={() => {
              // Notify parent menu that we're leaving submenu
              const mainMenuElement = document.querySelector('[data-main-menu="true"]');
              if (mainMenuElement) {
                const mouseLeaveEvent = new MouseEvent("mouseleave", { bubbles: true });
                mainMenuElement.dispatchEvent(mouseLeaveEvent);
              }
            }}
          >
            <SubMenuContext.Provider value={{ closeSubmenu }}>{children}</SubMenuContext.Provider>
          </div>
        </Portal>
      )}
    </div>
  );
}

/**
 * Single actionable row rendered inside a `CustomMenu`. Wraps Headless UI `Menu.Item` and
 * renders a `<button>` whose click invokes the caller's `onClick` and then closes the menu
 * via Headless UI's render-prop `close`. If this `MenuItem` is rendered inside a `SubMenu`,
 * the local `SubMenuContext` is also notified so the submenu collapses.
 *
 * Props (see `ICustomMenuItemProps` in `./helper`):
 *   - `children` (required): row content.
 *   - `onClick`: invoked with the click `MouseEvent`; the menu then auto-closes.
 *   - `disabled`: greys out and blocks click.
 *   - `className`: extra Tailwind classes merged onto the button.
 *
 * Accessibility: native `<button type="button">` semantics; ARIA `menuitem` role is provided
 * by the parent Headless UI `Menu`.
 */
function MenuItem(props: ICustomMenuItemProps) {
  const { children, disabled = false, onClick, className } = props;
  const submenuContext = useSubMenu();

  return (
    <Menu.Item as="div" disabled={disabled}>
      {({ active, close }) => (
        <button
          type="button"
          className={cn(
            "w-full truncate rounded-sm px-1 py-1.5 text-left text-secondary select-none",
            {
              "bg-layer-transparent-hover": active && !disabled,
              "text-placeholder": disabled,
            },
            className
          )}
          onClick={(e) => {
            close();
            onClick?.(e);
            // Close submenu if this item is inside a submenu
            submenuContext?.closeSubmenu();
          }}
          disabled={disabled}
        >
          {children}
        </button>
      )}
    </Menu.Item>
  );
}

/**
 * Helper row that visually mimics a `SubMenu` trigger (chevron-right affordance, hover styling)
 * without owning submenu open/close state. Useful when consumers want to render the trigger
 * appearance as a presentational element.
 *
 * Props (see `ICustomSubMenuTriggerProps` in `./helper`):
 *   - `children` (required): row content.
 *   - `disabled`: greys out the row.
 *   - `className`: extra Tailwind classes.
 *
 * Accessibility: rendered as a Headless UI `Menu.Item` (with `as="div"`), so the parent menu's
 * ARIA `menuitem` semantics apply.
 */
function SubMenuTrigger(props: ICustomSubMenuTriggerProps) {
  const { children, disabled = false, className } = props;

  return (
    <Menu.Item as="div" disabled={disabled}>
      {({ active }) => (
        <div
          className={cn(
            "flex w-full items-center justify-between rounded-sm px-1 py-1.5 text-left text-secondary select-none",
            {
              "bg-layer-transparent-hover": active && !disabled,
              "text-placeholder": disabled,
              "cursor-pointer": !disabled,
              "cursor-not-allowed": disabled,
            },
            className
          )}
        >
          <span className="flex-1">{children}</span>
          <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0" />
        </div>
      )}
    </Menu.Item>
  );
}

/**
 * Plain styled container for submenu content. Unlike `SubMenu`, this does NOT manage
 * popper positioning, open state, or portal mounting — it is a presentational shell that
 * consumers can compose when they want submenu visuals without the coordination machinery.
 *
 * Props (see `ICustomSubMenuContentProps` in `./helper`):
 *   - `children` (required): panel content.
 *   - `className`: extra Tailwind class overrides.
 *
 * (The `placement`, `sideOffset`, `alignOffset` props declared on `ICustomSubMenuContentProps`
 * are not consumed by this presentational shell — they exist for API parity with `SubMenu`.)
 */
function SubMenuContent(props: ICustomSubMenuContentProps) {
  const { children, className } = props;

  return (
    <div
      className={cn(
        "z-[15] min-w-[12rem] overflow-hidden rounded-md border border-subtle-1 bg-surface-1 p-1 text-11",
        className
      )}
    >
      {children}
    </div>
  );
}

// Add all components as static properties for external use
CustomMenu.Portal = Portal;
CustomMenu.MenuItem = MenuItem;
CustomMenu.SubMenu = SubMenu;
CustomMenu.SubMenuTrigger = SubMenuTrigger;
CustomMenu.SubMenuContent = SubMenuContent;

export { CustomMenu };
