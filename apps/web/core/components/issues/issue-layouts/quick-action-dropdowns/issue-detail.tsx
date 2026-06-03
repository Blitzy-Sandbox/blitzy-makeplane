/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-action dropdown menu for the work-item detail and peek-overview surface, exposing
 * Edit, Make-a-copy, Open-in-new-tab, Copy-link, Archive, Restore, and Delete actions, and
 * wiring its internal modal state to optional parent-supplied toggle callbacks so the parent
 * peek/detail panel can coordinate its own UI when modals open or close.
 *
 * Props — `TWorkItemDetailQuickActionProps = IQuickActionProps & extras`
 *   Inherited from `IQuickActionProps` (see `../list/list-view-types`):
 *     - `issue: TIssue` (required) — work item being acted on.
 *     - `parentRef: React.RefObject<HTMLElement>` (required) — anchor element for `ContextMenu`.
 *     - `handleDelete: () => Promise<void>` (required) — caller delete mutation; passed to `DeleteIssueModal.onSubmit`.
 *     - `handleUpdate?: (data: TIssue) => Promise<void>` — caller update mutation; invoked on `CreateUpdateIssueModal.onSubmit`.
 *     - `handleArchive?: () => Promise<void>` — caller archive mutation; passed to `ArchiveIssueModal.onSubmit`.
 *     - `handleRestore?: () => Promise<void>` — caller restore mutation; invoked from the Restore menu item.
 *     - `customActionButton?: React.ReactElement` — accepted by the shared contract but unused here because this surface injects its own `IconButton` ellipsis trigger directly into `CustomMenu`.
 *     - `portalElement?: HTMLDivElement | null` — portal target for the floating menu surface.
 *     - `readOnly?: boolean` — when `true`, forces `isEditingAllowed` to `false` regardless of permissions.
 *     - `placements?: TPlacement` (default `"bottom-end"`) — anchor placement for the `CustomMenu`.
 *   Detail/peek extras:
 *     - `toggleEditIssueModal?: (value: boolean) => void` — parent-side mirror of local `createUpdateIssueModal`; called on every open and close.
 *     - `toggleDeleteIssueModal?: (value: boolean) => void` — parent-side mirror of `deleteIssueModal`.
 *     - `toggleDuplicateIssueModal?: (value: boolean) => void` — parent-side mirror of `duplicateWorkItemModal`.
 *     - `toggleArchiveIssueModal?: (value: boolean) => void` — parent-side mirror of `archiveIssueModal`.
 *     - `isPeekMode?: boolean` (default `false`) — when `true`, hides the Edit and Copy-link items so the peek panel does not surface duplicate controls.
 *
 * MobX stores read (via React context hooks — MobX is the exclusive frontend state model):
 *   - `useUserPermissions()` → `allowPermissions` — gates `isEditingAllowed` on `ADMIN`/`MEMBER` at `EUserPermissionsLevel.PROJECT` scoped to `workspaceSlug` and `issue.project_id`.
 *   - `useIssues(EIssuesStoreType.PROJECT)` → `issuesFilter` — reads `displayFilters.layout` to derive `activeLayout` passed into the menu-item context.
 *   - `useProjectState()` → `getStateById` — resolves the issue's state to test membership in `ARCHIVABLE_STATE_GROUPS`.
 *   - `useProject()` → `getProjectIdentifierById` — resolves the project key used to build the work-item link.
 *   Router-only (not a MobX store): `useParams()` for `workspaceSlug`. `EIssuesStoreType.PROJECT` is used even on the detail surface because the underlying issue's parent slice is the project store regardless of whether the peek opened from a cycle/module/global layout.
 *
 * Side effects:
 *   - Opens local `ArchiveIssueModal`, `DeleteIssueModal`, `CreateUpdateIssueModal` (with `fetchIssueDetails={false}` because the peek panel already owns detail loading), and `DuplicateWorkItemModal` via `useState` flags.
 *   - Every local modal open/close mirrors to the matching `toggle*` callback so the parent's peek/detail view stays in sync (the peek header can dim or yield focus while a modal is active).
 *   - Edit / delete / duplicate / archive actions are rerouted through `customEditAction` / `customDeleteAction` / `customDuplicateAction` / `customArchiveAction` so the local and parent state machines update together.
 *   - Restore proxies to the caller's `handleRestore`.
 *   - Builds `duplicateIssuePayload` by spreading the issue with a "(copy)" name suffix and stripping `id` via `lodash-es#omit` so the duplicate modal creates a fresh record.
 *   - NO direct API calls — all mutations route through caller-supplied handlers (`handleDelete` / `handleUpdate` / `handleArchive` / `handleRestore`) and the embedded modal components.
 *
 * Peek-mode rendering (non-obvious conditional rendering):
 *   When `isPeekMode === true`, the post-processing pipeline applied to items returned by
 *   `useWorkItemDetailMenuItems` flips `shouldRender` to `false` for Edit
 *   (`isEditingAllowed && !isPeekMode`) and Copy-link (`!isPeekMode`). This is intentional: the
 *   peek surface already provides an inline edit affordance and exposes the link on the peek
 *   header, so menu duplicates would confuse users.
 *
 * Consumed by: work-item peek-overview and detail surfaces under
 * `apps/web/core/components/issues/peek-overview/**` and `apps/web/core/components/issues/issue-detail/**`.
 */

import { useState } from "react";
import { omit } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Ellipsis } from "lucide-react";
// plane imports
import { ARCHIVABLE_STATE_GROUPS, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { ContextMenu, CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
// plane-web components
import { DuplicateWorkItemModal } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns/duplicate-modal";
// helper
import { ArchiveIssueModal } from "../../archive-issue-modal";
import { DeleteIssueModal } from "../../delete-issue-modal";
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import type { IQuickActionProps } from "../list/list-view-types";
import type { MenuItemFactoryProps } from "./helper";
import { useWorkItemDetailMenuItems } from "./helper";
import { IconButton } from "@plane/propel/icon-button";

/**
 * Props contract for {@link WorkItemDetailQuickActions}. Extends `IQuickActionProps` with
 * optional parent-coordinated modal toggle callbacks and a peek-mode rendering flag so the
 * containing peek/detail panel can keep its UI synchronized with the dropdown's local modal
 * state.
 *
 * @property toggleEditIssueModal      Parent-side mirror of the local `createUpdateIssueModal` state; invoked whenever the inner Edit modal opens or closes.
 * @property toggleDeleteIssueModal    Parent-side mirror of the local `deleteIssueModal` state.
 * @property toggleDuplicateIssueModal Parent-side mirror of the local `duplicateWorkItemModal` state.
 * @property toggleArchiveIssueModal   Parent-side mirror of the local `archiveIssueModal` state.
 * @property isPeekMode                When `true`, hides the Edit and Copy-link items because the peek panel already surfaces those controls.
 */
type TWorkItemDetailQuickActionProps = IQuickActionProps & {
  toggleEditIssueModal?: (value: boolean) => void;
  toggleDeleteIssueModal?: (value: boolean) => void;
  toggleDuplicateIssueModal?: (value: boolean) => void;
  toggleArchiveIssueModal?: (value: boolean) => void;
  isPeekMode?: boolean;
};

export const WorkItemDetailQuickActions = observer(function WorkItemDetailQuickActions(
  props: TWorkItemDetailQuickActionProps
) {
  const {
    issue,
    handleDelete,
    handleUpdate,
    handleArchive,
    handleRestore,
    portalElement,
    readOnly = false,
    placements = "bottom-end",
    parentRef,
    toggleEditIssueModal,
    toggleDeleteIssueModal,
    toggleDuplicateIssueModal,
    toggleArchiveIssueModal,
    isPeekMode = false,
  } = props;
  // router
  const { workspaceSlug } = useParams();
  // states
  const [createUpdateIssueModal, setCreateUpdateIssueModal] = useState(false);
  const [issueToEdit, setIssueToEdit] = useState<TIssue | undefined>(undefined);
  const [deleteIssueModal, setDeleteIssueModal] = useState(false);
  const [archiveIssueModal, setArchiveIssueModal] = useState(false);
  const [duplicateWorkItemModal, setDuplicateWorkItemModal] = useState(false);
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { issuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  const { getStateById } = useProjectState();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const activeLayout = `${issuesFilter.issueFilters?.displayFilters?.layout} layout`;
  const stateDetails = getStateById(issue.state_id);
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);
  // auth
  const isEditingAllowed =
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug?.toString(),
      issue.project_id ?? undefined
    ) && !readOnly;

  const isArchivingAllowed = !issue.archived_at && isEditingAllowed;
  const isInArchivableGroup = !!stateDetails && ARCHIVABLE_STATE_GROUPS.includes(stateDetails?.group);
  const isRestoringAllowed = !!issue.archived_at && isEditingAllowed;

  const isDeletingAllowed = isEditingAllowed;

  const duplicateIssuePayload = omit(
    {
      ...issue,
      name: `${issue.name} (copy)`,
      sourceIssueId: issue.id,
    },
    ["id"]
  );

  const customEditAction = () => {
    setCreateUpdateIssueModal(true);
    if (toggleEditIssueModal) toggleEditIssueModal(true);
  };

  const customDeleteAction = async () => {
    setDeleteIssueModal(true);
    if (toggleDeleteIssueModal) toggleDeleteIssueModal(true);
  };

  const customDuplicateAction = async () => {
    setDuplicateWorkItemModal(true);
    if (toggleDuplicateIssueModal) {
      toggleDuplicateIssueModal(true);
    }
  };

  const customArchiveAction = async () => {
    setArchiveIssueModal(true);
    if (toggleArchiveIssueModal) toggleArchiveIssueModal(true);
  };

  const customRestoreAction = async () => {
    if (handleRestore) await handleRestore();
  };

  // Menu items and modals using helper
  const menuItemProps: MenuItemFactoryProps = {
    issue,
    workspaceSlug: workspaceSlug?.toString(),
    projectIdentifier,
    activeLayout,
    isEditingAllowed,
    isArchivingAllowed,
    isRestoringAllowed,
    isDeletingAllowed,
    isInArchivableGroup,
    setIssueToEdit,
    setCreateUpdateIssueModal: customEditAction,
    setDeleteIssueModal: customDeleteAction,
    setArchiveIssueModal: customArchiveAction,
    setDuplicateWorkItemModal: customDuplicateAction,
    handleDelete: customDeleteAction,
    handleUpdate,
    handleArchive: customArchiveAction,
    handleRestore: customRestoreAction,
    storeType: EIssuesStoreType.PROJECT,
  };

  //   const MENU_ITEMS = useWorkItemDetailMenuItems(menuItemProps);
  const baseMenuItems = useWorkItemDetailMenuItems(menuItemProps);

  const MENU_ITEMS = baseMenuItems
    .map((item) => {
      // Customize edit action for work item
      if (item.key === "edit") {
        return {
          ...item,
          shouldRender: isEditingAllowed && !isPeekMode,
        };
      }
      // Customize delete action for work item
      if (item.key === "delete") {
        return {
          ...item,
        };
      }
      // Hide copy link in peek mode
      if (item.key === "copy-link") {
        return {
          ...item,
          shouldRender: !isPeekMode,
        };
      }
      return item;
    })
    .filter(function MENU_ITEMS(item) {
      return item.shouldRender !== false;
    });

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
        handleClose={() => {
          setArchiveIssueModal(false);
          if (toggleArchiveIssueModal) toggleArchiveIssueModal(false);
        }}
        onSubmit={handleArchive}
      />
      <DeleteIssueModal
        data={issue}
        isOpen={deleteIssueModal}
        handleClose={() => {
          setDeleteIssueModal(false);
          if (toggleDeleteIssueModal) toggleDeleteIssueModal(false);
        }}
        onSubmit={handleDelete}
      />
      <CreateUpdateIssueModal
        isOpen={createUpdateIssueModal}
        onClose={() => {
          setCreateUpdateIssueModal(false);
          setIssueToEdit(undefined);
          if (toggleEditIssueModal) toggleEditIssueModal(false);
        }}
        data={issueToEdit ?? duplicateIssuePayload}
        onSubmit={async (data) => {
          if (issueToEdit && handleUpdate) await handleUpdate(data);
        }}
        storeType={EIssuesStoreType.PROJECT}
        fetchIssueDetails={false}
      />
      {issue.project_id && workspaceSlug && (
        <DuplicateWorkItemModal
          workItemId={issue.id}
          isOpen={duplicateWorkItemModal}
          onClose={() => {
            setDuplicateWorkItemModal(false);
            if (toggleDuplicateIssueModal) toggleDuplicateIssueModal(false);
          }}
          workspaceSlug={workspaceSlug.toString()}
          projectId={issue.project_id}
        />
      )}

      <ContextMenu parentRef={parentRef} items={CONTEXT_MENU_ITEMS} />
      <CustomMenu
        ellipsis
        placement={placements}
        customButton={<IconButton size="lg" variant="secondary" icon={Ellipsis} />}
        portalElement={portalElement}
        menuItemsClassName="z-[14]"
        maxHeight="lg"
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
