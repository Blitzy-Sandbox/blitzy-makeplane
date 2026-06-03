/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssuesListRoot` — top-level orchestrator for the sub-issues list inside the issue-detail widget. Derives grouping
 * and filter context, decides whether to render the localized empty state or map grouped results into
 * `SubIssuesListGroup` children, and forwards the full context (workspace, project, root/parent issue ids, spacing,
 * CRUD handlers, sub-issue operations, service type, store type) down into the nested rendering pipeline. Wrapped with
 * MobX `observer`, so any change to the observable slices below automatically triggers a re-render.
 *
 * Props (Props):
 *   - workspaceSlug (string, required): Workspace slug from the URL.
 *   - projectId (string, required): Id of the project that owns the root issue.
 *   - parentIssueId (string, required): Id of the immediate parent in the recursion; equals `rootIssueId` at the top level and is drilled deeper inside `SubIssuesListItem`.
 *   - rootIssueId (string, required): Id of the topmost issue; used for filter scoping and the root-level check `isRootLevel = rootIssueId === parentIssueId`.
 *   - spacingLeft (number, required, default `0`): Pixel indent applied to nested groups; incremented by `+22` at each deeper recursion level by `SubIssuesListItem`.
 *   - canEdit (boolean, required): Gates mutation affordances; forwarded from `disabled = !canEdit` at `../content.tsx`.
 *   - handleIssueCrudState ((key: "create" | "existing" | "update" | "delete", issueId: string, issue?: TIssue | null) => void, required): Callback that toggles upstream CRUD modal state in `../content.tsx`.
 *   - subIssueOperations (TSubIssueOperations, required): Bundle of sub-issue mutation operations produced by `useSubIssueOperations` in `../helper.ts` (copyLink, fetchSubIssues, addSubIssue, updateSubIssue, removeSubIssue, deleteSubIssue).
 *   - issueServiceType (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`): Selects whether the issue-detail store is accessed for issues or epics.
 *   - storeType (EIssuesStoreType, required, default `EIssuesStoreType.PROJECT`): Passed in from `../content.tsx` HARD-CODED as `EIssuesStoreType.PROJECT` — the sub-issues list always queries project-scoped issues. WARNING: engineers MUST NOT change this without revisiting filter scoping across the entire sub-issues subsystem.
 *
 * MobX stores read (via `useIssueDetail(issueServiceType)`):
 *   - `subIssues.subIssuesByIssueId(parentIssueId)`: selector — accessor map of sub-issue id arrays keyed by parent issue id; used for the flat (non-grouped) render path.
 *   - `subIssues.filters.getSubIssueFilters(rootIssueId)`: selector — reads the per-root filter snapshot (`displayFilters`, `filters`, `displayProperties`).
 *   - `subIssues.filters.getGroupedSubWorkItems(rootIssueId)`: selector — returns the pre-grouped sub-issue id map (keyed by group id) when `group_by` is active.
 *   - `subIssues.filters.getFilteredSubWorkItems(rootIssueId, filters)`: selector — returns the filtered sub-issue id list for the visible-count computation that gates the empty state.
 *   - `subIssues.filters.resetFilters(rootIssueId)`: action — clears filter selections; invoked by the empty-state action button.
 *
 * Side effects:
 *   - Calls `resetFilters(rootIssueId)` when the user clicks the empty-state action button.
 *   - No direct service calls; mutation and navigation side effects flow downstream via `subIssueOperations` and `handleIssueCrudState` props.
 *
 * Empty-state branch:
 *   - When `isRootLevel && filteredSubWorkItemsCount === 0`, renders `SectionEmptyState` with a translated title/description tuple, the `ListFilter` icon, and a `Button` that calls `resetFilters(rootIssueId)`. Title/description copy keys switch between `sub_work_item.empty_state.list_filters.*` (epics) and `sub_work_item.empty_state.sub_list_filters.*` (issues) based on `issueServiceType`.
 *
 * Grouping logic:
 *   - `isRootLevel` is true when `rootIssueId === parentIssueId` (top of the recursion); the linchpin that switches between grouped rendering at the top and flat rendering at nested depths.
 *   - `group_by` is taken from `filters?.displayFilters?.group_by` only at the root level; nested recursions ignore grouping and render a single `ALL_ISSUES` group.
 *   - `getGroupByColumns({ groupBy, includeNone: true, isWorkspaceLevel, isEpic, projectId })` returns the list of group buckets to render.
 *   - For each bucket, `getWorkItemIds(group.id)` returns either grouped ids (root level with `group_by` set) or the flat `subIssuesByIssueId(parentIssueId)` list (nested levels).
 *
 * Consumers:
 *   - Mounted from `apps/web/core/components/issues/issue-detail-widgets/sub-issues/content.tsx` when `subIssueHelpers.issue_visibility.includes(parentIssueId)` is true.
 *   - Mounted recursively from `apps/web/core/components/issues/issue-detail-widgets/sub-issues/issues-list/list-item.tsx` for nested sub-issue expansion.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { ListFilter } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { GroupByColumnTypes, TIssue, TIssueServiceType, TSubIssueOperations } from "@plane/types";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
// hooks
import { SectionEmptyState } from "@/components/empty-state/section-empty-state-root";
import { getGroupByColumns, isWorkspaceLevel } from "@/components/issues/issue-layouts/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

import { SubIssuesListGroup } from "./list-group";
type Props = {
  workspaceSlug: string;
  projectId: string;
  parentIssueId: string;
  rootIssueId: string;
  spacingLeft: number;
  canEdit: boolean;
  handleIssueCrudState: (
    key: "create" | "existing" | "update" | "delete",
    issueId: string,
    issue?: TIssue | null
  ) => void;
  subIssueOperations: TSubIssueOperations;
  issueServiceType?: TIssueServiceType;
  storeType: EIssuesStoreType;
};

export const SubIssuesListRoot = observer(function SubIssuesListRoot(props: Props) {
  const {
    workspaceSlug,
    projectId,
    parentIssueId,
    rootIssueId,
    canEdit,
    handleIssueCrudState,
    subIssueOperations,
    issueServiceType = EIssueServiceType.ISSUES,
    storeType = EIssuesStoreType.PROJECT,
    spacingLeft = 0,
  } = props;
  const { t } = useTranslation();
  // store hooks
  const {
    subIssues: {
      subIssuesByIssueId,
      filters: { getSubIssueFilters, getGroupedSubWorkItems, getFilteredSubWorkItems, resetFilters },
    },
  } = useIssueDetail(issueServiceType);

  // derived values
  const filters = getSubIssueFilters(rootIssueId);
  const isRootLevel = useMemo(() => rootIssueId === parentIssueId, [rootIssueId, parentIssueId]);
  const group_by = isRootLevel ? (filters?.displayFilters?.group_by ?? null) : null;
  /** Count only sub-issues that match the active filter predicate, not the full unfiltered set. */
  const filteredSubWorkItemsCount = (getFilteredSubWorkItems(rootIssueId, filters.filters ?? {}) ?? []).length;

  const groups = getGroupByColumns({
    groupBy: group_by as GroupByColumnTypes,
    includeNone: true,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
    isEpic: issueServiceType === EIssueServiceType.EPICS,
    projectId,
  });

  const getWorkItemIds = useCallback(
    (groupId: string) => {
      if (isRootLevel) {
        const groupedSubIssues = getGroupedSubWorkItems(rootIssueId);
        return groupedSubIssues?.[groupId] ?? [];
      }
      const subIssueIds = subIssuesByIssueId(parentIssueId);
      return subIssueIds ?? [];
    },
    [isRootLevel, subIssuesByIssueId, rootIssueId, getGroupedSubWorkItems, parentIssueId]
  );

  const isSubWorkItems = issueServiceType === EIssueServiceType.ISSUES;

  return (
    <div className="relative">
      {isRootLevel && filteredSubWorkItemsCount === 0 ? (
        <SectionEmptyState
          title={
            !isSubWorkItems
              ? t("sub_work_item.empty_state.list_filters.title")
              : t("sub_work_item.empty_state.sub_list_filters.title")
          }
          description={
            !isSubWorkItems
              ? t("sub_work_item.empty_state.list_filters.description")
              : t("sub_work_item.empty_state.sub_list_filters.description")
          }
          icon={<ListFilter />}
          customClassName={storeType !== EIssuesStoreType.EPIC ? "border-none" : ""}
          actionElement={
            <Button variant="secondary" onClick={() => resetFilters(rootIssueId)}>
              {t("sub_work_item.empty_state.list_filters.action")}
            </Button>
          }
        />
      ) : (
        groups?.map((group) => (
          <SubIssuesListGroup
            key={group.id}
            workItemIds={getWorkItemIds(group.id)}
            projectId={projectId}
            workspaceSlug={workspaceSlug}
            group={group}
            serviceType={issueServiceType}
            canEdit={canEdit}
            parentIssueId={parentIssueId}
            rootIssueId={rootIssueId}
            handleIssueCrudState={handleIssueCrudState}
            subIssueOperations={subIssueOperations}
            storeType={storeType}
            spacingLeft={spacingLeft}
          />
        ))
      )}
    </div>
  );
});
