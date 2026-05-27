/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Breadcrumb-item dropdown with built-in text search for navigating large sibling lists.
 *
 * Wraps `CustomSearchSelect` so users can type-to-filter peer entities (projects, cycles,
 * modules, views) when a plain menu would be too long. Click handling on non-terminal
 * segments forwards through `handleOnClick` before opening the search popover, allowing
 * the host to navigate to the selected entity's primary route.
 */

import * as React from "react";
import { useState } from "react";
import { Tooltip } from "@plane/propel/tooltip";
import type { ICustomSearchSelectOption } from "@plane/types";
import { CustomSearchSelect } from "../dropdowns";
import { cn } from "../utils";
import { Breadcrumbs } from "./breadcrumbs";

type TBreadcrumbNavigationSearchDropdownProps = {
  icon?: React.ReactNode;
  title?: string;
  selectedItem: string;
  navigationItems: ICustomSearchSelectOption[];
  onChange?: (value: string) => void;
  navigationDisabled?: boolean;
  isLast?: boolean;
  handleOnClick?: () => void;
  disableRootHover?: boolean;
  shouldTruncate?: boolean;
};

/**
 * Breadcrumb segment that opens a searchable dropdown for selecting among a large set of siblings.
 *
 * Synchronizes its open state with the underlying `CustomSearchSelect` (`onOpen`/`onClose`)
 * and guards `onChange` so re-selecting the current value is a no-op. On narrow viewports
 * (below the `@4xl` container-query breakpoint) the icon+label collapses to a `...` placeholder
 * when `shouldTruncate` is true. Tapping the trigger on a non-terminal segment fires
 * `handleOnClick` (typically to navigate to the selected entity) before the popover opens.
 *
 * @param props.icon - Optional leading icon rendered inside the trigger.
 * @param props.title - Trigger label and tooltip content.
 * @param props.selectedItem - Currently selected option value, forwarded to `CustomSearchSelect.value`.
 * @param props.navigationItems - Options consumed by `CustomSearchSelect`; conforms to `ICustomSearchSelectOption[]`.
 * @param props.onChange - Optional callback fired when the user picks a different option; suppressed when the picked value equals `selectedItem`.
 * @param props.navigationDisabled - When true, disables the underlying search select (default: false).
 * @param props.isLast - Set by the parent `Breadcrumbs` for the terminal segment; suppresses hover/click affordances and rotates the chevron (default: false).
 * @param props.handleOnClick - Optional callback fired when the trigger of a non-terminal segment is clicked.
 * @param props.disableRootHover - Declared in the prop type but not consumed by the implementation; reserved for type compatibility with call sites that pass it.
 * @param props.shouldTruncate - When true, collapses the icon+label to a `...` affordance below the `@4xl` container-query breakpoint (default: false).
 */
// INTENT UNCLEAR: explicit ARIA semantics (combobox + textbox roles, debounced input behavior) are delegated to the underlying `CustomSearchSelect`; accessibility behavior must be verified at that layer.
// INTENT UNCLEAR: `disableRootHover` is part of the prop type but never read in the component body — it appears reserved but inert; do not infer behavior beyond what is observed.
export function BreadcrumbNavigationSearchDropdown(props: TBreadcrumbNavigationSearchDropdownProps) {
  const {
    icon,
    title,
    selectedItem,
    navigationItems,
    onChange,
    navigationDisabled = false,
    isLast = false,
    handleOnClick,
    shouldTruncate = false,
  } = props;
  // state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <CustomSearchSelect
      onOpen={() => {
        setIsDropdownOpen(true);
      }}
      onClose={() => {
        setIsDropdownOpen(false);
      }}
      options={navigationItems}
      value={selectedItem}
      onChange={(value: string) => {
        if (value !== selectedItem) {
          onChange?.(value);
        }
      }}
      customButton={
        <>
          <Tooltip tooltipContent={title} position="bottom">
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
              {shouldTruncate && <div className="flex text-tertiary @4xl:hidden">...</div>}
              <div
                className={cn("flex gap-2", {
                  "hidden items-center gap-2 @4xl:flex": shouldTruncate,
                })}
              >
                {icon && <Breadcrumbs.Icon>{icon}</Breadcrumbs.Icon>}
                <Breadcrumbs.Label>{title}</Breadcrumbs.Label>
              </div>
            </button>
          </Tooltip>
          <Breadcrumbs.Separator
            className={cn("rounded-r-sm", {
              "bg-layer-1": isDropdownOpen && !isLast,
              "hover:bg-layer-1": !isLast,
            })}
            containerClassName="p-0"
            iconClassName={cn("group-hover:rotate-90 hover:text-primary", {
              "text-primary": isDropdownOpen,
              "rotate-90": isDropdownOpen || isLast,
            })}
            showDivider={!isLast}
          />
        </>
      }
      disabled={navigationDisabled}
      className="h-full rounded-sm"
      customButtonClassName={cn(
        "group flex h-full cursor-pointer items-center gap-0.5 rounded-sm outline-none hover:bg-surface-2",
        {
          "bg-surface-2": isDropdownOpen,
        }
      )}
    />
  );
}
