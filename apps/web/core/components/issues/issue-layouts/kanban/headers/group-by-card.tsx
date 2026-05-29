/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky column header for a primary `group_by` Kanban column.
 *
 * Rendered purpose: renders the title, count, optional icon, collapse/expand affordance, the
 * inline workflow group tree, and the create-or-attach affordances for issue creation at the head
 * of one Kanban lane.
 *
 * Props (`IHeaderGroupByCard`):
 *   - column_id (string, required): the group's canonical id (state id, label id, priority enum,
 *     assignee id, etc.) used by collapse-state lookups and the workflow tree.
 *   - title (string, required): the human-readable group label rendered in the header.
 *   - count (number, required): the issue count to display next to the title; falls back to 0 if
 *     falsy at render time.
 *   - icon (React.ReactNode, optional): custom icon for this group; when absent falls back to
 *     `Circle` from `lucide-react`.
 *   - group_by (TIssueGroupByOptions | undefined, required): the active primary grouping mode.
 *   - sub_group_by (TIssueGroupByOptions | undefined, required): the active sub-grouping mode;
 *     when truthy the header switches to a compact vertical layout and the collapse button is
 *     hidden (collapse only applies to the flat-board variant).
 *   - collapsedGroups (TIssueKanbanFilters, required): the collapsed-group state slice from the
 *     kanban filters, consulted to determine chevron/collapse direction.
 *   - handleCollapsedGroups ((toggle, value) => void, required): collapse toggle callback wired up
 *     by `base-kanban-root.tsx` which persists the toggle via `updateFilters`.
 *   - issuePayload (Partial<TIssue>, required): pre-populated issue defaults passed into
 *     `CreateUpdateIssueModal` / `CreateUpdateEpicModal` so a new issue lands inside this column.
 *   - disableIssueCreation (boolean, optional): when true, hides the "+" affordance entirely (used
 *     for read-only contexts such as completed cycles or unprivileged users).
 *   - addIssuesToView ((issueIds: string[]) => Promise<TIssue>, optional): mutation invoked when
 *     existing issues are attached to the current scope from the header; only meaningful for
 *     cycle/module/view routes.
 *   - isEpic (boolean, optional, default=false): swaps the create modal from
 *     `CreateUpdateIssueModal` to `CreateUpdateEpicModal` so epic-specific fields are presented.
 *
 * MobX stores read (via React-context hooks):
 *   - `useIssueStoreType()` exposes the active `EIssuesStoreType` which is forwarded to the
 *     issue-creation modal so the new issue is registered with the correct store slice.
 *   - `useParams()` from `next/navigation` is the route-param reader (not a MobX store) used to
 *     derive `workspaceSlug`, `projectId`, `moduleId`, and `cycleId`; these determine whether the
 *     "Add an existing work item" affordance is available.
 *
 * Side effects:
 *   - Clicking the "+" button (or the `CustomMenu` "Create work item" item) opens
 *     `CreateUpdateEpicModal` when `isEpic` is true OR `CreateUpdateIssueModal` otherwise, both
 *     hydrated with `issuePayload`.
 *   - When the route exposes `moduleId` OR `cycleId`, the `CustomMenu` also exposes "Add an
 *     existing work item" which opens `ExistingIssuesListModal`.
 *   - On existing-issue submission, calls `addIssuesToView(selectedIds)` and emits a
 *     `TOAST_TYPE.SUCCESS` toast via `setToast` on resolve, or a `TOAST_TYPE.ERROR` toast on reject.
 *   - Clicking the collapse button (visible only when `sub_group_by === null`) invokes
 *     `handleCollapsedGroups("group_by", column_id)` which is ultimately persisted via
 *     `updateFilters(EIssueFilterType.KANBAN_FILTERS, …)` upstream.
 *
 * Conditional rendering details (the WHY):
 *   - `verticalAlignPosition` is true only when `sub_group_by` is falsy AND the column id is in
 *     `collapsedGroups.group_by`; the column then renders as a 44px-wide vertical strip with
 *     vertical-lr text orientation so collapsed columns still show a readable label.
 *   - The collapse button is rendered only when `sub_group_by === null` because collapsing primary
 *     columns has no visual meaning inside the swimlane variant (the sub-group rows govern
 *     vertical collapse there instead).
 *   - The "+" affordance branches: when `renderExistingIssueModal` is truthy (cycle/module
 *     context), it expands into a `CustomMenu` with both "Create" and "Add existing" items;
 *     otherwise it is a single plain button that directly opens the create modal.
 *
 * Consumers:
 *   - `../default.tsx` (`KanBan`) — instantiates one `HeaderGroupByCard` per primary group column
 *     in the flat-board path.
 *   - `../swimlanes.tsx` (`SubGroupSwimlaneHeader`) — instantiates one `HeaderGroupByCard` per
 *     primary group column in the swimlane header strip.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// lucide icons
import { Minimize2, Maximize2, Circle } from "lucide-react";
import { PlusIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue, ISearchIssueResponse, TIssueKanbanFilters, TIssueGroupByOptions } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
// constants
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { CreateUpdateEpicModal } from "@/plane-web/components/epics/epic-modal";
// types
// Plane-web
import { WorkFlowGroupTree } from "@/plane-web/components/workflow";

/**
 * Props for `HeaderGroupByCard`.
 *
 * The `issuePayload`, `addIssuesToView`, and `disableIssueCreation` fields collectively govern the
 * header's issue-creation affordances; the remaining fields drive presentation and collapse state.
 */
interface IHeaderGroupByCard {
  sub_group_by: TIssueGroupByOptions | undefined;
  group_by: TIssueGroupByOptions | undefined;
  column_id: string;
  icon?: React.ReactNode;
  title: string;
  count: number;
  collapsedGroups: TIssueKanbanFilters;
  handleCollapsedGroups: (toggle: "group_by" | "sub_group_by", value: string) => void;
  issuePayload: Partial<TIssue>;
  disableIssueCreation?: boolean;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  isEpic?: boolean;
}

/** Sticky column header for a primary `group_by` Kanban column; see the module-level JSDoc for full semantics. */
export const HeaderGroupByCard = observer(function HeaderGroupByCard(props: IHeaderGroupByCard) {
  const {
    group_by,
    sub_group_by,
    column_id,
    icon,
    title,
    count,
    collapsedGroups,
    handleCollapsedGroups,
    issuePayload,
    disableIssueCreation,
    addIssuesToView,
    isEpic = false,
  } = props;
  const verticalAlignPosition = sub_group_by ? false : collapsedGroups?.group_by.includes(column_id);
  // states
  const [isOpen, setIsOpen] = React.useState(false);
  const [openExistingIssueListModal, setOpenExistingIssueListModal] = React.useState(false);
  // hooks
  const storeType = useIssueStoreType();
  // router
  const { workspaceSlug, projectId, moduleId, cycleId } = useParams();

  const renderExistingIssueModal = moduleId || cycleId;
  const ExistingIssuesListModalPayload = moduleId ? { module: moduleId.toString() } : { cycle: true };

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
          searchParams={ExistingIssuesListModalPayload}
          handleOnSubmit={handleAddIssuesToView}
        />
      )}
      <div
        className={`relative flex flex-shrink-0 gap-1 py-1.5 ${
          verticalAlignPosition ? `w-[44px] flex-col items-center` : `w-full flex-row items-center`
        }`}
      >
        <div className="flex size-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-xs">
          {icon ? icon : <Circle width={14} strokeWidth={2} />}
        </div>

        <div
          className={`relative flex gap-1 ${
            verticalAlignPosition ? `flex-col items-center` : `w-full flex-row items-baseline overflow-hidden`
          }`}
        >
          <div
            className={`line-clamp-1 inline-block truncate overflow-hidden font-medium text-primary ${
              verticalAlignPosition ? `max-h-[400px] vertical-lr` : ``
            }`}
          >
            {title}
          </div>
          <div
            className={`flex-shrink-0 text-13 font-medium text-tertiary ${verticalAlignPosition ? `pr-0.5` : `pl-2`}`}
          >
            {count || 0}
          </div>
        </div>

        <WorkFlowGroupTree groupBy={group_by} groupId={column_id} />

        {sub_group_by === null && (
          <button
            className="flex h-[20px] w-[20px] flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm bg-layer-transparent transition-all hover:bg-layer-transparent-hover"
            onClick={() => handleCollapsedGroups("group_by", column_id)}
          >
            {verticalAlignPosition ? (
              <Maximize2 width={14} strokeWidth={2} />
            ) : (
              <Minimize2 width={14} strokeWidth={2} />
            )}
          </button>
        )}

        {!disableIssueCreation &&
          (renderExistingIssueModal ? (
            <CustomMenu
              customButton={
                <span className="flex h-[20px] w-[20px] flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm bg-layer-transparent transition-all hover:bg-layer-transparent-hover">
                  <PlusIcon height={14} width={14} strokeWidth={2} />
                </span>
              }
              placement="bottom-end"
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
            <button
              className="flex h-[20px] w-[20px] flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm bg-layer-transparent transition-all hover:bg-layer-transparent-hover"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              <PlusIcon width={14} strokeWidth={2} />
            </button>
          ))}
      </div>
    </>
  );
});
