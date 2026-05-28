/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Overflow menu for the issues / epics layout page header.
 *
 * Rendered purpose: an ellipsis-triggered `CustomMenu` exposing layout-level quick actions (currently
 * copy-link and open-in-new-tab), backed by the shared `useLayoutMenuItems` helper which supplies the
 * menu items and any modal portals.
 *
 * Props:
 *   - workspaceSlug (string, required): builds the layout URL and is passed through to `useLayoutMenuItems`
 *   - projectId (string, required): builds the layout URL and is passed through to `useLayoutMenuItems`
 *   - storeType ("PROJECT" | "EPIC", required): switches the URL segment between `/issues` and `/epics` and
 *     drives the i18n copy ("Work items" vs "Epics")
 *
 * MobX stores read: none directly — store access (if any) is delegated to `useLayoutMenuItems`.
 *
 * Side effects:
 *   - Clipboard write via `copyUrlToClipboard(layoutLink)` from `@plane/utils`.
 *   - Toast emission via `setToast` ("Link copied").
 *   - `window.open` to the layout URL in a new tab with `"noopener,noreferrer"` features so the
 *     newly opened tab cannot access `window.opener` of the originating tab (defeats
 *     reverse-tabnabbing).
 *
 * Derived state notes:
 *   - `layoutLink` is built locally (no env var lookup) using the supplied slug + id + storeType.
 *   - `useLayoutMenuItems(...)` may return either an array of items OR an object `{ items, modals }`; the code
 *     normalises both shapes via `Array.isArray(menuResult)`. Items with `shouldRender === false` are filtered
 *     out at render time.
 *
 * Consumers: mounted by issues/epics layout headers — e.g.,
 * `apps/web/core/components/issues/issue-layouts/roots/*` shells and `archived-issues-header.tsx`.
 */

import { observer } from "mobx-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TContextMenuItem } from "@plane/ui";
import { CustomMenu } from "@plane/ui";
import { copyUrlToClipboard, cn } from "@plane/utils";
import { useLayoutMenuItems } from "@/components/common/quick-actions-helper";
import { Ellipsis } from "lucide-react";
import { IconButton } from "@plane/propel/icon-button";

type Props = {
  workspaceSlug: string;
  projectId: string;
  storeType: "PROJECT" | "EPIC";
};

export const LayoutQuickActions = observer(function LayoutQuickActions(props: Props) {
  const { workspaceSlug, projectId, storeType } = props;

  const layoutLink = `${workspaceSlug}/projects/${projectId}/${storeType === "EPIC" ? "epics" : "issues"}`;

  const handleCopyLink = () =>
    copyUrlToClipboard(layoutLink).then(() => {
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Link copied",
        message: `${storeType === "EPIC" ? "Epics" : "Work items"} link copied to clipboard.`,
      });
    });

  const handleOpenInNewTab = () => window.open(`/${layoutLink}`, "_blank", "noopener,noreferrer");

  const menuResult = useLayoutMenuItems({
    workspaceSlug,
    projectId,
    storeType,
    handleCopyLink,
    handleOpenInNewTab,
  });

  const MENU_ITEMS: TContextMenuItem[] = Array.isArray(menuResult) ? menuResult : menuResult.items;
  const additionalModals = Array.isArray(menuResult) ? null : menuResult.modals;

  return (
    <>
      {additionalModals}
      <CustomMenu
        ellipsis
        placement="bottom-end"
        closeOnSelect
        maxHeight="lg"
        className="flex size-[26px] flex-shrink-0 items-center justify-center rounded"
        customButton={<IconButton size="lg" variant="tertiary" icon={Ellipsis} />}
      >
        {MENU_ITEMS.map((item) => {
          if (item.shouldRender === false) return null;
          return (
            <CustomMenu.MenuItem
              key={item.key}
              onClick={item.action}
              className={cn("flex items-center gap-2", {
                "text-placeholder": item.disabled,
              })}
              disabled={item.disabled}
            >
              {item.icon && <item.icon className="h-3 w-3" />}
              <span>{item.title}</span>
            </CustomMenu.MenuItem>
          );
        })}
      </CustomMenu>
    </>
  );
});
