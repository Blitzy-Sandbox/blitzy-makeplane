/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-action dropdown menu for rows in the cycle-scoped issues layout, exposing
 * edit (with the active `cycleId` pre-applied to the work item), make-a-copy,
 * open-in-new-tab, copy-link, remove-from-cycle, archive, and delete actions.
 *
 * @remarks
 * Props (from `IQuickActionProps` in `../list/list-view-types`):
 *   - `issue: TIssue` (required) — work item this menu acts on.
 *   - `handleDelete: () => Promise<void>` (required) — caller-provided delete handler.
 *   - `handleUpdate?: (data: TIssue) => Promise<void>` (optional) — caller-provided update handler.
 *   - `handleRemoveFromView?: () => Promise<void>` (optional) — invoked by the "Remove from cycle" menu item
 *     (the factory in `helper.tsx` maps this action to the `XCircle` icon).
 *   - `handleArchive?: () => Promise<void>` (optional) — caller-provided archive handler.
 *   - `customActionButton?: React.ReactElement` (optional) — custom trigger element for the menu.
 *   - `portalElement?: HTMLDivElement | null` (optional) — portal mount target for the popup.
 *   - `readOnly?: boolean` (optional, default `false`) — disables editing/deleting actions when `true`.
 *   - `placements?: TPlacement` (optional, default `"bottom-start"`) — menu placement relative to the trigger.
 *   - `parentRef: React.RefObject<HTMLElement>` (required) — anchor element for the context-menu listener.
 *
 * MobX stores read (via React context hooks — MobX is the exclusive frontend state layer per AAP §0.2.2):
 *   - `useIssues(EIssuesStoreType.CYCLE)` → `issuesFilter` — reads the current display filter layout label,
 *     surfaced through `activeLayout` so menu builders can branch on layout context.
 *   - `useUserPermissions()` → `allowPermissions` — gates `isEditingAllowed` on ADMIN/MEMBER at the PROJECT level.
 *   - `useProjectState()` → `getStateById` — checks `ARCHIVABLE_STATE_GROUPS` membership to gate archive.
 *   - `useProject()` → `getProjectIdentifierById` — resolves the project key for the work-item link.
 *   - `useParams()` from `next/navigation` — reads `workspaceSlug` and `cycleId` from the URL (see AAP §0.2.6 C3
 *     for note on the underlying router framework).
 *
 * Side effects:
 *   - Opens `ArchiveIssueModal`, `DeleteIssueModal`, `CreateUpdateIssueModal`, and
 *     `DuplicateWorkItemModal` via local `useState` flags.
 *   - The edit action injects `cycle_id: cycleId ?? null` into the edit payload via
 *     `useCycleIssueMenuItems`' custom edit action so the edited issue retains its cycle
 *     association on the round-trip through the edit modal (distinct from `module-issue.tsx`
 *     which uses a `module_ids` array; cycle membership is a scalar one-to-one relation).
 *   - "Remove from cycle" delegates to the caller's `handleRemoveFromView`.
 *   - `duplicateIssuePayload` is built by spreading the issue with a `(copy)` suffix on `name`
 *     and stripping `id` via `lodash-es#omit` so the duplicate is treated as a new work item.
 *   - Passes `storeType: EIssuesStoreType.CYCLE` to the menu factory to scope mutations to the
 *     cycle-issues store slice.
 *   - No direct API calls — all mutations flow through caller-provided handlers and modals
 *     (service-layer pattern per AAP §0.2.2).
 */

import { useState } from "react";
import { omit } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
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
import { DuplicateWorkItemModal } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns";
// types
// helper
import { ArchiveIssueModal } from "../../archive-issue-modal";
import { DeleteIssueModal } from "../../delete-issue-modal";
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import type { IQuickActionProps } from "../list/list-view-types";
import type { MenuItemFactoryProps } from "./helper";
import { useCycleIssueMenuItems } from "./helper";

export const CycleIssueQuickActions = observer(function CycleIssueQuickActions(props: IQuickActionProps) {
  const {
    issue,
    handleDelete,
    handleUpdate,
    handleRemoveFromView,
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
  const { workspaceSlug, cycleId } = useParams();
  const { issuesFilter } = useIssues(EIssuesStoreType.CYCLE);
  const { allowPermissions } = useUserPermissions();
  const { getStateById } = useProjectState();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const stateDetails = getStateById(issue.state_id);
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);
  // auth
  const isEditingAllowed =
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT) && !readOnly;
  const isArchivingAllowed = handleArchive && isEditingAllowed;
  const isInArchivableGroup = !!stateDetails && ARCHIVABLE_STATE_GROUPS.includes(stateDetails?.group);
  const isDeletingAllowed = isEditingAllowed;

  const activeLayout = `${issuesFilter.issueFilters?.displayFilters?.layout} layout`;

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
    activeLayout,
    isEditingAllowed,
    isArchivingAllowed,
    isDeletingAllowed,
    isInArchivableGroup,
    setIssueToEdit,
    setCreateUpdateIssueModal,
    setDeleteIssueModal,
    setArchiveIssueModal,
    setDuplicateWorkItemModal,
    handleRemoveFromView,
    cycleId: cycleId?.toString(),
    handleDelete,
    handleUpdate,
    handleArchive,
    storeType: EIssuesStoreType.CYCLE,
  };

  const MENU_ITEMS = useCycleIssueMenuItems(menuItemProps);

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
        storeType={EIssuesStoreType.CYCLE}
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
        placement={placements}
        customButton={customActionButton}
        portalElement={portalElement}
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
