/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Breadcrumb-item dropdown for navigating sibling entities at the same hierarchy level.
 *
 * Renders a trigger button that opens a `CustomMenu` listing peer items; selecting one
 * invokes its `action` callback (typically a router navigation). Used in workspace,
 * project, cycle, and module breadcrumbs to let users hop between siblings without
 * backing out to a list view.
 */

import { CheckIcon } from "lucide-react";
import * as React from "react";
// ui
import { Tooltip } from "@plane/propel/tooltip";
import type { TContextMenuItem } from "../dropdowns";
import { CustomMenu } from "../dropdowns";
import { cn } from "../utils";
import { Breadcrumbs } from "./breadcrumbs";

type TBreadcrumbNavigationDropdownProps = {
  selectedItemKey: string;
  navigationItems: TContextMenuItem[];
  navigationDisabled?: boolean;
  handleOnClick?: () => void;
  isLast?: boolean;
};

/**
 * Breadcrumb segment that opens a dropdown menu of sibling items at the same hierarchy level.
 *
 * Finds the entry in `navigationItems` whose `key` matches `selectedItemKey` and renders its
 * icon + title in the trigger; returns `null` when no item matches. Items with
 * `shouldRender === false` are skipped, the currently-selected item is suffixed with a check
 * icon, and re-selecting it is a no-op. Tapping the trigger on a non-terminal segment fires
 * `handleOnClick` (typically to navigate to the selected item's own page) before opening the
 * menu. When `navigationDisabled` is true, only the static trigger renders (no `CustomMenu`).
 *
 * @param props.selectedItemKey - Key of the navigation item currently shown in the trigger.
 * @param props.navigationItems - Sibling items rendered inside the dropdown; each carries `key`, `title`, optional `icon`, `description`, `action`, `disabled`, and `shouldRender` per `TContextMenuItem`.
 * @param props.navigationDisabled - When true, renders only the static trigger button without an attached menu (default: false).
 * @param props.handleOnClick - Optional callback fired when the trigger of a non-terminal segment is clicked.
 * @param props.isLast - Set by the parent `Breadcrumbs` for the terminal segment; suppresses hover/click affordances and rotates the chevron (default: false).
 *
 * // INTENT UNCLEAR: explicit ARIA semantics (combobox/menu role, aria-expanded, arrow-key navigation, Enter/Escape handling) are delegated to the underlying `CustomMenu` primitive; accessibility behavior must be verified at that layer.
 */
export function BreadcrumbNavigationDropdown(props: TBreadcrumbNavigationDropdownProps) {
  const { selectedItemKey, navigationItems, navigationDisabled = false, handleOnClick, isLast = false } = props;
  const [isOpen, setIsOpen] = React.useState(false);
  // derived values
  const selectedItem = navigationItems.find((item) => item.key === selectedItemKey);
  const selectedItemIcon = selectedItem?.icon ? (
    <selectedItem.icon className={cn("size-4", selectedItem.iconClassName)} />
  ) : undefined;

  // if no selected item, return null
  if (!selectedItem) return null;

  function NavigationButton() {
    return (
      <Tooltip tooltipContent={selectedItem?.title} position="bottom" disabled={isOpen}>
        <button
          onClick={(e) => {
            if (!isLast) {
              e.preventDefault();
              e.stopPropagation();
              handleOnClick?.();
            }
          }}
          className={cn(
            "group flex h-full cursor-pointer items-center gap-2 rounded-sm rounded-r-none px-1.5 py-1 text-13 font-medium text-tertiary",
            {
              "hover:bg-layer-1 hover:text-primary": !isLast,
            }
          )}
        >
          <div className="flex text-tertiary @4xl:hidden">...</div>
          <div className="hidden items-center gap-2 @4xl:flex">
            {selectedItemIcon && <Breadcrumbs.Icon>{selectedItemIcon}</Breadcrumbs.Icon>}
            <Breadcrumbs.Label>{selectedItem?.title}</Breadcrumbs.Label>
          </div>
        </button>
      </Tooltip>
    );
  }

  if (navigationDisabled) {
    return <NavigationButton />;
  }

  return (
    <CustomMenu
      customButton={
        <>
          <NavigationButton />
          <Breadcrumbs.Separator
            className={cn("rounded-r-sm", {
              "bg-layer-1": isOpen && !isLast,
              "hover:bg-layer-1": !isLast,
            })}
            containerClassName="p-0"
            iconClassName={cn("group-hover:rotate-90 hover:text-primary", {
              "text-primary": isOpen,
              "rotate-90": isOpen || isLast,
            })}
            showDivider={!isLast}
          />
        </>
      }
      placement="bottom-start"
      className="h-full rounded-sm"
      customButtonClassName={cn(
        "group flex h-full cursor-pointer items-center gap-0.5 rounded-sm outline-none hover:bg-surface-2",
        {
          "bg-surface-2": isOpen,
        }
      )}
      closeOnSelect
      menuButtonOnClick={() => {
        setIsOpen(!isOpen);
      }}
      onMenuClose={() => {
        setIsOpen(false);
      }}
    >
      {navigationItems.map((item) => {
        if (item.shouldRender === false) return null;
        return (
          <CustomMenu.MenuItem
            key={item.key}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (item.key === selectedItemKey) return;
              item.action();
            }}
            className={cn(
              "flex items-center gap-2",
              {
                "text-placeholder": item.disabled,
              },
              item.className
            )}
            disabled={item.disabled}
          >
            {item.icon && <item.icon className={cn("size-4 flex-shrink-0", item.iconClassName)} />}
            <div className="w-full">
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
            {item.key === selectedItemKey && <CheckIcon className="size-3.5 flex-shrink-0" />}
          </CustomMenu.MenuItem>
        );
      })}
    </CustomMenu>
  );
}
