/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-action dropdown menu for rows in the global / all-issues (workspace-wide) layout —
 * exposes edit, make-a-copy, open-in-new-tab, copy-link, archive, and delete actions on work
 * items that may span multiple projects.
 *
 * Workspace-spanning dropdown variant: unlike `project-issue.tsx`, `cycle-issue.tsx`, and
 * `module-issue.tsx`, this file does NOT call `useUserPermissions` because the global view
 * crosses project boundaries where permissions may be heterogeneous — gating is delegated to
 * the caller-provided `readOnly` prop. Hard-codes `activeLayout: "Global issues"` and
 * `storeType: EIssuesStoreType.GLOBAL` so the menu factory in `./helper` binds actions to the
 * workspace-wide MobX store slice.
 *
 * Exposed component: `AllIssueQuickActions(props: IQuickActionProps)` (observer).
 *
 * Props (consumed subset of `IQuickActionProps` from `../list/list-view-types`):
 *   - `issue: TIssue` (required) — work item the menu acts on.
 *   - `handleDelete: () => Promise<void>` (required) — caller-provided delete handler bound to `DeleteIssueModal.onSubmit`.
 *   - `handleUpdate?: (data: TIssue) => Promise<void>` (optional) — caller-provided update handler invoked by `CreateUpdateIssueModal.onSubmit` when editing an existing issue.
 *   - `handleArchive?: () => Promise<void>` (optional) — caller-provided archive handler bound to `ArchiveIssueModal.onSubmit`; when absent the Archive item is hidden via `isArchivingAllowed = handleArchive && isEditingAllowed`.
 *   - `customActionButton?: React.ReactElement` (optional) — element rendered in place of the default ellipsis trigger.
 *   - `portalElement?: HTMLDivElement | null` (optional) — portal mount node for the `CustomMenu` overlay.
 *   - `readOnly?: boolean` (optional, default `false`) — when `true`, forces every editing affordance off (edit, archive, delete).
 *   - `placements?: TPlacement` (optional, default `"bottom-start"`) — Floating-UI placement for the dropdown.
 *   - `parentRef: React.RefObject<HTMLElement>` (required) — ref to the row element that anchors the right-click `ContextMenu`.
 *
 * MobX stores read (state injected via React context per AAP §0.2.2):
 *   - `useProjectState()` → `getStateById`: resolves `issue.state_id` to check
 *     `ARCHIVABLE_STATE_GROUPS` membership before enabling the archive action.
 *   - `useProject()` → `getProjectIdentifierById`: resolves the project key (e.g., "PLN") for
 *     the work-item URL built inside `helper.tsx`.
 *   - `useParams()` returns `workspaceSlug` from the router (not a MobX store).
 *   - NOTE: Does NOT call `useUserPermissions` — permission gating is delegated to the caller
 *     via `readOnly` because the global view spans projects with potentially heterogeneous
 *     permissions.
 *
 * Side effects:
 *   - Toggles local `useState` flags to open `ArchiveIssueModal`, `DeleteIssueModal`,
 *     `CreateUpdateIssueModal`, and `DuplicateWorkItemModal` (the latter only when both
 *     `issue.project_id` and `workspaceSlug` are present).
 *   - Builds `duplicateIssuePayload` by spreading `issue`, appending `" (copy)"` to `name`,
 *     attaching `sourceIssueId`, and stripping `id` via `lodash-es#omit` so the modal opens
 *     in create mode.
 *   - Copy-link writes the work-item URL to the clipboard via `copyUrlToClipboard`; open-in-
 *     new-tab calls `window.open(workItemLink, "_blank")` (both action handlers built in
 *     `./helper`'s `useIssueActionHandlers`).
 *   - Passes `storeType: EIssuesStoreType.GLOBAL` to `useAllIssueMenuItems` so the menu
 *     factory binds actions to the workspace-wide MobX store slice.
 *   - No direct API calls — every mutation flows through caller-provided handlers and modal
 *     submit callbacks (service-layer separation per AAP §0.2.2).
 */

import { useState } from "react";
import { omit } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ARCHIVABLE_STATE_GROUPS } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { ContextMenu, CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
// plane-web components
import { DuplicateWorkItemModal } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns";
// helper
import { ArchiveIssueModal } from "../../archive-issue-modal";
import { DeleteIssueModal } from "../../delete-issue-modal";
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import type { IQuickActionProps } from "../list/list-view-types";
import type { MenuItemFactoryProps } from "./helper";
import { useAllIssueMenuItems } from "./helper";

export const AllIssueQuickActions = observer(function AllIssueQuickActions(props: IQuickActionProps) {
  const {
    issue,
    handleDelete,
    handleUpdate,
    handleArchive,
    customActionButton,
    portalElement,
    readOnly = false,
    placements = "bottom-start",
    parentRef,
  } = props;
  // states
  const [createUpdateIssueModal, setCreateUpdateIssueModal] = useState(false);
  const [issueToEdit, setIssueToEdit] = useState<TIssue | undefined>(undefined);
  const [deleteIssueModal, setDeleteIssueModal] = useState(false);
  const [archiveIssueModal, setArchiveIssueModal] = useState(false);
  const [duplicateWorkItemModal, setDuplicateWorkItemModal] = useState(false);
  // router
  const { workspaceSlug } = useParams();
  const { getStateById } = useProjectState();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const stateDetails = getStateById(issue.state_id);
  const isEditingAllowed = !readOnly;
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);
  // auth
  const isArchivingAllowed = handleArchive && isEditingAllowed;
  const isInArchivableGroup = !!stateDetails && ARCHIVABLE_STATE_GROUPS.includes(stateDetails?.group);

  const duplicateIssuePayload = omit(
    {
      ...issue,
      name: `${issue.name} (copy)`,
      sourceIssueId: issue.id,
    },
    ["id"]
  );

  // Menu items and modals using helper
  const menuItemProps: MenuItemFactoryProps = {
    issue,
    workspaceSlug: workspaceSlug?.toString(),
    projectIdentifier,
    activeLayout: "Global issues",
    isEditingAllowed,
    isArchivingAllowed,
    isDeletingAllowed: isEditingAllowed,
    isInArchivableGroup,
    setIssueToEdit,
    setCreateUpdateIssueModal,
    setDeleteIssueModal,
    setArchiveIssueModal,
    setDuplicateWorkItemModal,
    handleDelete,
    handleUpdate,
    handleArchive,
    storeType: EIssuesStoreType.GLOBAL,
  };

  const MENU_ITEMS = useAllIssueMenuItems(menuItemProps);

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
      <ArchiveIssueModal
        data={issue}
        isOpen={archiveIssueModal}
        handleClose={() => setArchiveIssueModal(false)}
        onSubmit={handleArchive}
      />
      <DeleteIssueModal
        data={issue}
        isOpen={deleteIssueModal}
        handleClose={() => setDeleteIssueModal(false)}
        onSubmit={handleDelete}
      />
      <CreateUpdateIssueModal
        isOpen={createUpdateIssueModal}
        onClose={() => {
          setCreateUpdateIssueModal(false);
          setIssueToEdit(undefined);
        }}
        data={issueToEdit ?? duplicateIssuePayload}
        onSubmit={async (data) => {
          if (issueToEdit && handleUpdate) await handleUpdate(data);
        }}
        storeType={EIssuesStoreType.GLOBAL}
      />
      {issue.project_id && workspaceSlug && (
        <DuplicateWorkItemModal
          workItemId={issue.id}
          isOpen={duplicateWorkItemModal}
          onClose={() => setDuplicateWorkItemModal(false)}
          workspaceSlug={workspaceSlug.toString()}
          projectId={issue.project_id}
        />
      )}

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

          // Render submenu if nestedMenuItems exist
          if (item.nestedMenuItems && item.nestedMenuItems.length > 0) {
            return (
              <CustomMenu.SubMenu
                key={item.key}
                trigger={
                  <div className="flex items-center gap-2">
                    {item.icon && <item.icon className={cn("h-3 w-3", item.iconClassName)} />}
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
                }
                disabled={item.disabled}
                className={cn(
                  "flex items-center gap-2",
                  {
                    "text-placeholder": item.disabled,
                  },
                  item.className
                )}
              >
                {item.nestedMenuItems.map((nestedItem) => (
                  <CustomMenu.MenuItem
                    key={nestedItem.key}
                    onClick={() => {
                      nestedItem.action();
                    }}
                    className={cn(
                      "flex items-center gap-2",
                      {
                        "text-placeholder": nestedItem.disabled,
                      },
                      nestedItem.className
                    )}
                    disabled={nestedItem.disabled}
                  >
                    {nestedItem.icon && <nestedItem.icon className={cn("h-3 w-3", nestedItem.iconClassName)} />}
                    <div>
                      <h5>{nestedItem.title}</h5>
                      {nestedItem.description && (
                        <p
                          className={cn("whitespace-pre-line text-tertiary", {
                            "text-placeholder": nestedItem.disabled,
                          })}
                        >
                          {nestedItem.description}
                        </p>
                      )}
                    </div>
                  </CustomMenu.MenuItem>
                ))}
              </CustomMenu.SubMenu>
            );
          }

          // Render regular menu item
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
