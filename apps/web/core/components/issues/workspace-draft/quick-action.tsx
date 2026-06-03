/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-actions menu for a workspace draft issue row.
 *
 * Pure presentation component that renders both a right-click context menu
 * (bound to `parentRef`) and an ellipsis-triggered custom dropdown menu,
 * populated from a caller-supplied list of `TContextMenuItem` entries. The
 * component performs no store mutations, network calls, or navigations of
 * its own — all behavioral effects are delegated to `item.action()`.
 *
 * Props:
 *   - parentRef (React.RefObject<HTMLElement>, required): ref to the parent
 *     element on which the right-click context menu is bound.
 *   - MENU_ITEMS (TContextMenuItem[], required): items with `key`, `title`,
 *     `icon`, optional `description`, optional `disabled`, optional
 *     `className`/`iconClassName`, and an `action` callback.
 *
 * MobX stores read (via React context):
 *   - useTranslation — translator `t` used to localize `item.title`.
 *
 * Side effects:
 *   - Invokes `item.action()` on selection; no other side effects.
 *
 * Accessibility / behavior:
 *   - Disabled items get both the `disabled` prop and a `text-placeholder`
 *     class for visual contrast.
 *   - `closeOnSelect` collapses the menu after a click.
 *   - `useCaptureForOutsideClick` resolves outside-click during the capture
 *     phase to avoid conflicts with the parent row's double-click handler.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// ui
import type { TContextMenuItem } from "@plane/ui";
import { ContextMenu, CustomMenu } from "@plane/ui";
// helpers
import { cn } from "@plane/utils";

export interface Props {
  parentRef: React.RefObject<HTMLElement>;
  MENU_ITEMS: TContextMenuItem[];
}

export const WorkspaceDraftIssueQuickActions = observer(function WorkspaceDraftIssueQuickActions(props: Props) {
  const { parentRef, MENU_ITEMS } = props;

  const { t } = useTranslation();

  return (
    <>
      <ContextMenu parentRef={parentRef} items={MENU_ITEMS} />
      <CustomMenu
        ellipsis
        placement="bottom-end"
        menuItemsClassName="z-[14]"
        maxHeight="lg"
        useCaptureForOutsideClick
        closeOnSelect
      >
        {MENU_ITEMS.map((item) => (
          <CustomMenu.MenuItem
            key={item.key}
            onClick={() => {
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
            {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
            <div>
              <h5>{t(item.title || "")}</h5>
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
    </>
  );
});
