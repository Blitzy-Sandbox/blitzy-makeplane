/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Interactive group-header card rendered above each grouped section in the list layout.
 *
 * Rendered purpose: shows the group icon + title + count, exposes a multi-select group action,
 * toggles the group's collapsed state on click, and conditionally renders a "+" affordance to either
 * (a) open the create-issue / create-epic modal pre-populated with the group's payload, or (b) (for
 * module / cycle scopes) open the existing-issues picker to attach existing issues to the current view.
 *
 * Props (IHeaderGroupByCard):
 *   - groupID (string, required): the group identifier (used for selection, collapse, and existing-issues attach)
 *   - groupBy (TIssueGroupByOptions, required): the active group key — forwarded into `WorkFlowGroupTree`
 *   - icon (React.ReactNode, optional): custom group icon; falls back to a dashed circle when absent
 *   - title (string, required): the group's display name
 *   - count (number, required): the group's issue count (rendered next to the title; "0" when undefined)
 *   - issuePayload (Partial<TIssue>, required): the partial issue used to pre-fill the create modal
 *   - canEditProperties ((projectId) => boolean, required): permission predicate combined with
 *     `selectionHelpers.isSelectionDisabled` to gate multi-select visibility
 *   - disableIssueCreation (boolean, optional): hides the "+" affordance and all create flows
 *   - addIssuesToView ((issueIds: string[]) => Promise<TIssue>, optional): the attach-existing callback
 *     forwarded into the existing-issues picker submit handler; only invoked for module/cycle scopes
 *   - selectionHelpers (TSelectionHelper, required): multi-select context (group selection state + actions)
 *   - handleCollapsedGroups ((value: string) => void, required): toggles this group's collapsed state
 *     in the kanban-filters slice of the filter store
 *   - isEpic (boolean, optional, default=false): swaps the create modal between issue and epic variants
 *
 * MobX stores read:
 *   - `useIssueStoreType()` resolves the active store type from React context; forwarded as `storeType`
 *     into the create-issue modal so it knows which store action to dispatch
 *
 * Side effects:
 *   - `handleAddIssuesToView(data)` extracts issue ids from `ISearchIssueResponse[]`, validates that
 *     `workspaceSlug` and `projectId` are present, calls `addIssuesToView?.(issueIds)`, and emits a
 *     SUCCESS or ERROR toast via `setToast(...)` from `@plane/propel/toast`.
 *   - Opens `CreateUpdateIssueModal` or `CreateUpdateEpicModal` (per `isEpic`) with the group's
 *     pre-populated payload — the modal performs the create API call via its own store action.
 *   - Opens `ExistingIssuesListModal` (module/cycle only) to pick issues to attach.
 *
 * Derived state (non-obvious):
 *   - `renderExistingIssueModal = moduleId || cycleId` — only module and cycle scopes can attach
 *     existing issues; project / archived / profile / project-view scopes cannot
 *   - `existingIssuesListModalPayload = moduleId ? { module: moduleId.toString() } : { cycle: true }`
 *     — the picker's filter param differs by scope: modules need the explicit module id, cycles use
 *     a boolean flag (the backend resolves the active cycle from the route)
 *   - `isGroupSelectionEmpty = selectionHelpers.isGroupSelected(groupID) === "empty"` — the
 *     `MultipleSelectGroupAction` affordance becomes always-visible when the group is partially or
 *     fully selected, but hides on hover-only when nothing is selected
 *
 * Consumers: `../list-group.tsx` (renders one `HeaderGroupByCard` per group inside its sticky header row).
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { CircleDashed } from "lucide-react";
import { PlusIcon } from "@plane/propel/icons";
// types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue, ISearchIssueResponse, TIssueGroupByOptions } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
// components
import { cn } from "@plane/utils";
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { MultipleSelectGroupAction } from "@/components/core/multiple-select";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
// constants
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// plane-web
import { CreateUpdateEpicModal } from "@/plane-web/components/epics/epic-modal";
// Plane-web
import { WorkFlowGroupTree } from "@/plane-web/components/workflow";

/** Props for `HeaderGroupByCard`. See the module-level JSDoc for full semantics. */
interface IHeaderGroupByCard {
  groupID: string;
  groupBy: TIssueGroupByOptions;
  icon?: React.ReactNode;
  title: string;
  count: number;
  issuePayload: Partial<TIssue>;
  canEditProperties: (projectId: string | undefined) => boolean;
  disableIssueCreation?: boolean;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  selectionHelpers: TSelectionHelper;
  handleCollapsedGroups: (value: string) => void;
  isEpic?: boolean;
}

/** Interactive group-header card; see the module-level JSDoc for full semantics. */
export const HeaderGroupByCard = observer(function HeaderGroupByCard(props: IHeaderGroupByCard) {
  const {
    groupID,
    groupBy,
    icon,
    title,
    count,
    issuePayload,
    canEditProperties,
    disableIssueCreation,
    addIssuesToView,
    selectionHelpers,
    handleCollapsedGroups,
    isEpic = false,
  } = props;
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [openExistingIssueListModal, setOpenExistingIssueListModal] = useState(false);
  // router
  const { workspaceSlug, projectId, moduleId, cycleId } = useParams();
  const storeType = useIssueStoreType();
  // derived values
  const renderExistingIssueModal = moduleId || cycleId;
  const existingIssuesListModalPayload = moduleId ? { module: moduleId.toString() } : { cycle: true };
  const isGroupSelectionEmpty = selectionHelpers.isGroupSelected(groupID) === "empty";
  // auth
  const canSelectIssues = canEditProperties(projectId?.toString()) && !selectionHelpers.isSelectionDisabled;

  const handleAddIssuesToView = async (data: ISearchIssueResponse[]) => {
    if (!workspaceSlug || !projectId) return;

    const issues = data.map((i) => i.id);

    try {
      await addIssuesToView?.(issues);

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: "Work items added to the cycle successfully.",
      });
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: "Selected work items could not be added to the cycle. Please try again.",
      });
    }
  };

  return (
    <>
      <div className="group/list-header flex w-full flex-shrink-0 items-center gap-2 py-1.5">
        {canSelectIssues && (
          <div className="absolute left-1 flex w-3.5 flex-shrink-0 items-center">
            <MultipleSelectGroupAction
              className={cn(
                "pointer-events-none size-3.5 opacity-0 !outline-none group-hover/list-header:pointer-events-auto group-hover/list-header:opacity-100",
                {
                  "pointer-events-auto opacity-100": !isGroupSelectionEmpty,
                }
              )}
              groupID={groupID}
              selectionHelpers={selectionHelpers}
              disabled={count === 0}
            />
          </div>
        )}
        <div className="grid flex-shrink-0 place-items-center overflow-hidden">
          {icon ?? <CircleDashed className="size-3.5" strokeWidth={2} />}
        </div>

        <div
          className="relative flex w-full cursor-pointer flex-row items-center gap-1 overflow-hidden"
          onClick={() => handleCollapsedGroups(groupID)}
        >
          <div className="line-clamp-1 inline-block truncate font-medium text-primary">{title}</div>
          <div className="pl-2 text-13 font-medium text-tertiary">{count || 0}</div>
          <div className="px-2.5">
            <WorkFlowGroupTree groupBy={groupBy} groupId={groupID} />
          </div>
        </div>

        {/* "+" affordance: when the existing-issues modal is available (module / cycle scopes), surface a
            CustomMenu with two options (create / attach existing); otherwise show a direct plus-icon trigger
            that opens the create modal immediately. */}
        {!disableIssueCreation &&
          (renderExistingIssueModal ? (
            <CustomMenu
              customButton={
                <span className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xs transition-all hover:bg-layer-1">
                  <PlusIcon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              }
            >
              <CustomMenu.MenuItem
                onClick={() => {
                  setIsOpen(true);
                }}
              >
                <span className="flex items-center justify-start gap-2">Create work item</span>
              </CustomMenu.MenuItem>
              <CustomMenu.MenuItem
                onClick={() => {
                  setOpenExistingIssueListModal(true);
                }}
              >
                <span className="flex items-center justify-start gap-2">Add an existing work item</span>
              </CustomMenu.MenuItem>
            </CustomMenu>
          ) : (
            <div
              className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xs transition-all hover:bg-layer-1"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              <PlusIcon width={14} strokeWidth={2} />
            </div>
          ))}

        {isEpic ? (
          <CreateUpdateEpicModal isOpen={isOpen} onClose={() => setIsOpen(false)} data={issuePayload} />
        ) : (
          <CreateUpdateIssueModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            data={issuePayload}
            storeType={storeType}
          />
        )}

        {renderExistingIssueModal && (
          <ExistingIssuesListModal
            workspaceSlug={workspaceSlug?.toString()}
            projectId={projectId?.toString()}
            isOpen={openExistingIssueListModal}
            handleClose={() => setOpenExistingIssueListModal(false)}
            searchParams={existingIssuesListModalPayload}
            handleOnSubmit={handleAddIssuesToView}
          />
        )}
      </div>
    </>
  );
});
