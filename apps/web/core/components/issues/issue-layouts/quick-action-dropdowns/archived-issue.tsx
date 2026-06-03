/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-action dropdown menu for archived work items, exposing restore,
 * open-in-new-tab, copy-link, and delete actions for rows in the archived
 * issues layout.
 *
 * Props (from {@link IQuickActionProps} in `../list/list-view-types`):
 *   - `issue: TIssue` (required) — the archived work item this menu acts on.
 *   - `handleDelete: () => Promise<void>` (required) — caller-provided
 *     permanent delete handler invoked by the {@link DeleteIssueModal}
 *     `onSubmit`.
 *   - `handleRestore?: () => Promise<void>` (optional) — caller-provided
 *     restore handler; when absent the Restore item is hidden via the
 *     locally-derived `isRestoringAllowed` flag.
 *   - `customActionButton?: React.ReactElement` (optional) — overrides the
 *     default ellipsis trigger rendered by `CustomMenu`.
 *   - `portalElement?: HTMLDivElement | null` (optional) — portal target for
 *     the `CustomMenu` overlay.
 *   - `readOnly?: boolean` (optional, default `false`) — forces all
 *     edit/restore/delete items off by collapsing `isEditingAllowed`.
 *   - `placements?: TPlacement` (optional, default `"bottom-end"`) — popover
 *     placement passed through to `CustomMenu`.
 *   - `parentRef: React.RefObject<HTMLElement>` (required) — anchor element
 *     for the right-click `ContextMenu`.
 *
 * MobX stores read (frontend state is MobX exclusively per AAP §0.2.2; the
 * component is wrapped in `observer` so re-renders track these observables):
 *   - `useUserPermissions()` → `allowPermissions` — gates edit/restore on
 *     ADMIN/MEMBER at the PROJECT level.
 *   - `useIssues(EIssuesStoreType.ARCHIVED)` → `issuesFilter` — reads the
 *     active layout label (`displayFilters.layout`) for menu context.
 *
 * Side effects:
 *   - Opens {@link DeleteIssueModal} via local `useState`; on submit delegates
 *     to the caller-provided `handleDelete`.
 *   - On Restore, calls the caller-provided `handleRestore` and emits
 *     success/error toasts via `setToast` (handled inside `helper.tsx`).
 *   - Copy link writes the work item URL to the clipboard via
 *     `copyUrlToClipboard` (helper).
 *   - Open in new tab calls `window.open(workItemLink, "_blank")` (helper).
 *   - No API calls in this file directly — all mutations flow through
 *     caller-provided handlers per the service layer pattern.
 *
 * Menu composition note: only Restore, Open in new tab, Copy link, and Delete
 * are exposed (see `useArchivedIssueMenuItems` in `./helper`). The
 * `setIssueToEdit` and `setCreateUpdateIssueModal` props passed to the menu
 * factory are intentional no-op stubs because archived items cannot be edited
 * until restored.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// ui
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { EIssuesStoreType } from "@plane/types";
import { ContextMenu, CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { DeleteIssueModal } from "../../delete-issue-modal";
import type { IQuickActionProps } from "../list/list-view-types";
import type { MenuItemFactoryProps } from "./helper";
import { useArchivedIssueMenuItems } from "./helper";

export const ArchivedIssueQuickActions = observer(function ArchivedIssueQuickActions(props: IQuickActionProps) {
  const {
    issue,
    handleDelete,
    handleRestore,
    customActionButton,
    portalElement,
    readOnly = false,
    placements = "bottom-end",
    parentRef,
  } = props;
  // states
  const [deleteIssueModal, setDeleteIssueModal] = useState(false);
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const { issuesFilter } = useIssues(EIssuesStoreType.ARCHIVED);
  // derived values
  const activeLayout = `${issuesFilter.issueFilters?.displayFilters?.layout} layout`;
  // auth
  const isEditingAllowed =
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT) && !readOnly;
  const isRestoringAllowed =
    handleRestore && allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);

  // Menu items and modals using helper
  const menuItemProps: MenuItemFactoryProps = {
    issue,
    workspaceSlug: workspaceSlug?.toString(),
    activeLayout,
    isEditingAllowed,
    isDeletingAllowed: isEditingAllowed,
    isRestoringAllowed: !!isRestoringAllowed,
    setIssueToEdit: () => {},
    setCreateUpdateIssueModal: () => {},
    setDeleteIssueModal,
    handleRestore,
    handleDelete,
  };

  const MENU_ITEMS = useArchivedIssueMenuItems(menuItemProps);

  const CONTEXT_MENU_ITEMS = MENU_ITEMS.map(function CONTEXT_MENU_ITEMS(item) {
    return {
      ...item,

      onClick: () => {
        item.action();
      },
    };
  });
  return (
    <>
      {/* Modals */}
      <DeleteIssueModal
        data={issue}
        isOpen={deleteIssueModal}
        handleClose={() => setDeleteIssueModal(false)}
        onSubmit={handleDelete}
      />

      <ContextMenu parentRef={parentRef} items={CONTEXT_MENU_ITEMS} />
      <CustomMenu
        ellipsis
        customButton={customActionButton}
        portalElement={portalElement}
        placement={placements}
        menuItemsClassName="z-[14]"
        maxHeight="lg"
        useCaptureForOutsideClick
        closeOnSelect
      >
        {MENU_ITEMS.map((item) => {
          if (item.shouldRender === false) return null;
          return (
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
          );
        })}
      </CustomMenu>
    </>
  );
});
