/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-actions affordance attached to a workspace-draft row.
 *
 * Rendered purpose: dual-surface action menu — a `ContextMenu` anchored to `parentRef`
 * (triggered by right-click on the draft row) plus a `CustomMenu` kebab button (rendered
 * on hover). Both surfaces share the same caller-supplied `MENU_ITEMS` so context-menu
 * and overflow-menu actions stay in sync.
 *
 * Props:
 *   - parentRef (React.RefObject<HTMLElement>, required): element the context menu is anchored to
 *   - MENU_ITEMS (TContextMenuItem[], required): action entries (Edit, Duplicate, Move to project, Delete, ...)
 *
 * MobX stores read: none — entirely driven by the caller-supplied `MENU_ITEMS` array.
 *
 * Side effects: none directly — each `MENU_ITEMS` entry owns its own action callback.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/workspace-draft/draft-issue-block.tsx`
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
