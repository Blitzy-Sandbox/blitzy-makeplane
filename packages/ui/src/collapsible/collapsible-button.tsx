/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Styled trigger button paired with `Collapsible` for accessible expand/collapse interactions.
 *
 * Presentational header that visually reflects open/closed state via a rotating chevron; the
 * parent component owns click handling and is responsible for invoking `Collapsible.onToggle`
 * (see `./collapsible.tsx`).
 */

import React from "react";
import type { ISvgIcons } from "@plane/propel/icons";
import { DropdownIcon } from "@plane/propel/icons";
import { cn } from "../utils";

type Props = {
  isOpen: boolean;
  title: React.ReactNode;
  hideChevron?: boolean;
  indicatorElement?: React.ReactNode;
  actionItemElement?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  ChevronIcon?: React.FC<ISvgIcons>;
};

/**
 * Renders the styled header row for a `Collapsible` section, displaying a title, an optional
 * chevron icon that rotates with state, an optional indicator slot, and an optional trailing
 * action slot that appears only when the section is open.
 *
 * @param props.isOpen - Required. Drives chevron rotation and visibility of `actionItemElement`.
 * @param props.title - Required. Header text or any React node rendered as the section label.
 * @param props.hideChevron - Optional, default `false`. When `true`, suppresses the chevron icon.
 * @param props.indicatorElement - Optional. React node rendered to the right of the title (e.g., a count badge).
 * @param props.actionItemElement - Optional. React node rendered on the far right; visible only when `isOpen` is `true`.
 * @param props.className - Optional, default `""`. Additional classes merged onto the outer container via `cn`.
 * @param props.titleClassName - Optional, default `""`. Additional classes merged onto the title `<span>`.
 * @param props.ChevronIcon - Optional, default `DropdownIcon` from `@plane/propel/icons`. Custom chevron component receiving the open/closed rotation class.
 */
// INTENT UNCLEAR: rendered as a `<div>` without `role="button"`, `tabIndex`, `aria-expanded`,
// `aria-controls`, or an `onClick`/`onToggle` prop — keyboard activation, focus, and the
// linkage to the controlled panel are not implemented at this file; the parent must wire them.
export function CollapsibleButton(props: Props) {
  const {
    isOpen,
    title,
    hideChevron = false,
    indicatorElement,
    actionItemElement,
    className = "",
    titleClassName = "",
    ChevronIcon = DropdownIcon,
  } = props;
  return (
    <div className={cn("flex h-12 items-center justify-between gap-3 border-b border-subtle px-2.5 py-3", className)}>
      <div className="flex items-center gap-3.5">
        <div className="flex items-center gap-3">
          {!hideChevron && (
            <ChevronIcon
              className={cn("size-2 text-tertiary duration-300 hover:text-secondary", {
                "-rotate-90": !isOpen,
              })}
            />
          )}
          <span className={cn("text-14 font-medium text-primary", titleClassName)}>{title}</span>
        </div>
        {indicatorElement && indicatorElement}
      </div>
      {/* Action slot is intentionally hidden when collapsed so the closed header stays compact. */}
      {actionItemElement && isOpen && actionItemElement}
    </div>
  );
}
