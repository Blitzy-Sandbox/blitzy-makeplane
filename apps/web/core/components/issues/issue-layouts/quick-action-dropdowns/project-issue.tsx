/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-action dropdown menu for rows in the project-scoped issues layout (the default issues
 * layout for a project) — exposes edit, make-a-copy, open-in-new-tab, copy-link, archive, and
 * delete actions for a single work item.
 *
 * Baseline dropdown variant: no cycle/module pre-population and no remove-from-view action.
 * Sibling layout variants (`module-issue.tsx`, `cycle-issue.tsx`) extend this shape via the
 * `useXxxMenuItems` factory hooks in `./helper`. Permission checks pass all four
 * `allowPermissions` arguments (actions, level, workspaceSlug, projectId) because the project
 * URL does not implicitly scope the project ID — unlike the cycle/module variants where the
 * route alone determines project context.
 *
 * Exposed component: `ProjectIssueQuickActions(props: IQuickActionProps)` (observer).
 *
 * Props (consumed subset of `IQuickActionProps` from `../list/list-view-types`):
 *   - `issue: TIssue` (required) — work item the menu acts on.
 *   - `handleDelete: () => Promise<void>` (required) — caller-provided delete handler invoked from `DeleteIssueModal`.
 *   - `handleUpdate?: (data: TIssue) => Promise<void>` (optional) — caller-provided update handler invoked from `CreateUpdateIssueModal`.
 *   - `handleArchive?: () => Promise<void>` (optional) — caller-provided archive handler invoked from `ArchiveIssueModal`.
 *   - `customActionButton?: React.ReactElement` (optional) — element rendered in place of the default ellipsis trigger.
 *   - `portalElement?: HTMLDivElement | null` (optional) — portal mount node for the dropdown overlay.
 *   - `readOnly?: boolean` (optional, default `false`) — when `true`, suppresses every editing affordance.
 *   - `placements?: TPlacement` (optional, default `"bottom-end"`) — Floating-UI placement for the dropdown.
 *   - `parentRef: React.RefObject<HTMLElement>` (required) — ref to the row element that anchors the right-click `ContextMenu`.
 *
 * MobX stores read (state injected via React context per AAP §0.2.2):
 *   - `useUserPermissions()` → `allowPermissions`: gates `isEditingAllowed` on
 *     `[ADMIN, MEMBER]` permissions scoped to (`workspaceSlug`, `issue.project_id`).
 *   - `useIssues(EIssuesStoreType.PROJECT)` → `issuesFilter`: reads the active display-filter
 *     layout label so menu copy reflects the current view.
 *   - `useProjectState()` → `getStateById`: resolves the issue's state to check
 *     `ARCHIVABLE_STATE_GROUPS` membership before enabling the archive action.
 *   - `useProject()` → `getProjectIdentifierById`: resolves the project key for the
 *     open-in-new-tab work-item link.
 *   - `useParams()` returns `workspaceSlug` from the router (not a MobX store).
 *
 * Side effects:
 *   - Toggles local `useState` flags to open `ArchiveIssueModal`, `DeleteIssueModal`,
 *     `CreateUpdateIssueModal`, and `DuplicateWorkItemModal`.
 *   - Builds `duplicateIssuePayload` by spreading `issue`, appending `(copy)` to `name`, and
 *     stripping `id` via `lodash-es#omit` so the modal opens in create mode.
 *   - Passes `storeType: EIssuesStoreType.PROJECT` to `useProjectIssueMenuItems` so the menu
 *     factory binds actions to the project-scoped MobX store slice.
 *   - No direct API calls — every mutation flows through caller-provided handlers and modal
 *     submit callbacks (service-layer separation per AAP §0.2.2).
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
// plane-web imports
import { DuplicateWorkItemModal } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns/duplicate-modal";
// helper
import { ArchiveIssueModal } from "../../archive-issue-modal";
import { DeleteIssueModal } from "../../delete-issue-modal";
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import type { IQuickActionProps } from "../list/list-view-types";
import type { MenuItemFactoryProps } from "./helper";
import { useProjectIssueMenuItems } from "./helper";

export const ProjectIssueQuickActions = observer(function ProjectIssueQuickActions(props: IQuickActionProps) {
  const {
    issue,
    handleDelete,
    handleUpdate,
    handleArchive,
    customActionButton,
    portalElement,
    readOnly = false,
    placements = "bottom-end",
    parentRef,
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
  const isArchivingAllowed = handleArchive && isEditingAllowed;
  const isInArchivableGroup = !!stateDetails && ARCHIVABLE_STATE_GROUPS.includes(stateDetails?.group);
  const isDeletingAllowed = isEditingAllowed;

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
    handleDelete,
    handleUpdate,
    handleArchive,
    storeType: EIssuesStoreType.PROJECT,
  };

  const MENU_ITEMS = useProjectIssueMenuItems(menuItemProps);

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
        storeType={EIssuesStoreType.PROJECT}
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
