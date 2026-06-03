/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Link preview block component rendering URL metadata with derived favicon,
 * title, and relative timestamp.
 *
 * Used to surface attached links in issue link lists, page references, and
 * similar contexts where a compact, recognizable preview is preferred over
 * the raw URL.
 */

import React from "react";
// plane utils
import { calculateTimeAgo, cn, getIconForLink } from "@plane/utils";
// plane ui
import type { TContextMenuItem } from "../dropdowns/context-menu/root";
import { CustomMenu } from "../dropdowns/custom-menu";

/**
 * Props for {@link LinkItemBlock}.
 *
 * @property title - Display text shown as the primary label.
 * @property url - Source URL the block represents; also feeds the icon picker.
 * @property createdAt - Optional creation timestamp; when present, a relative
 *   "time ago" line is rendered. Accepts `Date` or ISO string so callers can
 *   pass either native dates or serialized API payloads.
 * @property menuItems - Optional context menu actions; surfaces a hover-only
 *   ellipsis trigger when provided.
 * @property onClick - Optional activation callback for the block container.
 */
export type TLinkItemBlockProps = {
  title: string;
  url: string;
  createdAt?: Date | string;
  menuItems?: TContextMenuItem[];
  onClick?: () => void;
};

/**
 * Renders a single attached link as a styled preview card with leading icon,
 * truncated title, optional relative timestamp, and an optional contextual
 * action menu shown on hover.
 *
 * Behavior notes:
 * - Icon resolution: {@link getIconForLink} parses the URL and matches the
 *   domain (e.g. `github.com`, `figma.com`) or file extension against a known
 *   pattern table to choose a brand/file Lucide icon. The match is best-effort;
 *   unmatched URLs fall back to a generic link icon. This is purely a
 *   client-side mapping — no network fetch of a real favicon occurs.
 * - Relative timestamp: {@link calculateTimeAgo} wraps `date-fns`
 *   `formatDistanceToNow` to render strings like "2 hours ago", which keeps
 *   recency readable as time passes without forcing the caller to reformat.
 * - The context menu trigger is hidden by default and revealed via Tailwind's
 *   `group-hover` so the card stays visually compact at rest. Each menu item's
 *   click handler calls `preventDefault` + `stopPropagation` before invoking
 *   `item.action` to keep the outer block's `onClick` and any anchor-default
 *   navigation from also firing.
 *
 * Accessibility: rendered as a clickable `<div>` (not an `<a>` or `<button>`),
 * so the outer container does not expose native anchor or button semantics.
 * Keyboard activation and assistive labelling of the block itself are the
 * caller's responsibility; the context menu trigger's keyboard behavior is
 * provided by {@link CustomMenu}.
 *
 * @param props - See {@link TLinkItemBlockProps}.
 */
export function LinkItemBlock(props: TLinkItemBlockProps) {
  // props
  const { title, url, createdAt, menuItems, onClick } = props;
  // icons
  const Icon = getIconForLink(url);
  return (
    <div
      onClick={onClick}
      className="group flex h-[56px] w-[230px] cursor-pointer items-center gap-4 rounded-md border-[0.5px] border-subtle bg-surface-1 px-4"
    >
      <div className="grid size-8 flex-shrink-0 place-items-center rounded-sm bg-surface-2 p-2">
        <Icon className="size-4 stroke-2 text-tertiary group-hover:text-primary" />
      </div>
      <div className="flex-1 truncate">
        <div className="truncate text-13 font-medium">{title}</div>
        {createdAt && <div className="text-11 font-medium text-placeholder">{calculateTimeAgo(createdAt)}</div>}
      </div>
      {menuItems && (
        <div className="hidden group-hover:block">
          <CustomMenu placement="bottom-end" menuItemsClassName="z-20" closeOnSelect verticalEllipsis>
            {menuItems.map((item) => (
              <CustomMenu.MenuItem
                key={item.key}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  item.action();
                }}
                className={cn("flex w-full items-center gap-2", {
                  "text-placeholder": item.disabled,
                })}
                disabled={item.disabled}
              >
                {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
                <div>
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
              </CustomMenu.MenuItem>
            ))}
          </CustomMenu>
        </div>
      )}
    </div>
  );
}
