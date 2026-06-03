/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubWorkItemTitleActions` — action strip embedded in the sub-issues collapsible header that composes the display-filter dropdown,
 * the filter dropdown, and the conditional quick-action button. Derives layout/filter options from constants + the parent project's
 * states and member ids, exposes memoized handlers that dispatch updates through the `issue-detail` filters slice, and stops click
 * propagation on its wrapper so the collapsible parent does not toggle when the embedded controls are interacted with.
 *
 * Props (TSubWorkItemTitleActionsProps):
 *   - disabled (boolean, required): When true, suppresses the trailing `SubIssuesActionButton` (no add-sub-work-item affordance).
 *   - issueServiceType (TIssueServiceType, optional, default `EIssueServiceType.ISSUES`): Selects `issue-detail` store slice (ISSUES vs. EPICS).
 *   - parentId (string, required): Issue id whose sub-issue filters are read and updated; used as the `parentIssueId` key in `getSubIssueFilters` / `updateSubWorkItemFilters`.
 *   - projectId (string, required): Active project id; drives `getProjectStates` and `getProjectMemberIds` lookups so the embedded filter controls have project-scoped options.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType).subIssues.filters.getSubIssueFilters(parentId)`: selector — returns the current `{ filters, displayFilters, displayProperties }` bag for this parent issue.
 *   - `useIssueDetail(issueServiceType).subIssues.filters.updateSubWorkItemFilters(filterType, value, parentId)`: action — dispatches one of `EIssueFilterType.DISPLAY_FILTERS`, `DISPLAY_PROPERTIES`, or `FILTERS` updates through the store.
 *   - `useProjectState().getProjectStates(projectId)`: returns project states feeding the `state` filter dropdown.
 *   - `useMember().project.getProjectMemberIds(projectId, false)`: returns project members feeding the assignees filter dropdown (second positional arg is the `includeGuest` flag, set to `false` to exclude guests).
 *
 * Side effects:
 *   - `handleDisplayFilters(updatedDisplayFilter)` / `handleDisplayPropertiesUpdate(updatedDisplayProperties)` / `handleFiltersUpdate(key, value)` — all dispatch MobX actions on the `subIssues.filters` slice. No direct API calls; the store layer is responsible for any persistence.
 *   - `handleFiltersUpdate` non-obviously toggles individual values inside an existing array (using `cloneDeep` to avoid in-place MobX mutation) and supports array-valued inputs (e.g. `start_date` custom values that arrive as `[value, otherValue]`). See the inline comment inside the `handleFiltersUpdate` callback in this file.
 *   - Wrapper `onClick` calls `e.stopPropagation()` and `e.preventDefault()` so click events inside this action strip do not bubble into the parent `CollapsibleButton` and accidentally toggle the collapsible.
 *
 * Layout options:
 *   - `layoutDisplayFiltersOptions` is `ISSUE_DISPLAY_FILTERS_BY_PAGE["sub_work_items"].layoutOptions.list` — the canonical sub-work-item layout option set from `@plane/constants`.
 *   - Available filter keys are `SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE` from `@plane/constants`.
 *
 * Consumers: rendered by `./title.tsx` (`SubIssuesCollapsibleTitle`) as the action
 * strip inside the sub-issues collapsible header on the issue-detail widget shell.
 */

import { useCallback } from "react";
import { cloneDeep } from "lodash-es";
import { observer } from "mobx-react";
import {
  EIssueFilterType,
  ISSUE_DISPLAY_FILTERS_BY_PAGE,
  SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE,
} from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IIssueFilterOptions,
  TIssueServiceType,
} from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProjectState } from "@/hooks/store/use-project-state";
import { SubIssueDisplayFilters } from "./display-filters";
import { SubIssueFilters } from "./filters";
import { SubIssuesActionButton } from "./quick-action-button";

type TSubWorkItemTitleActionsProps = {
  disabled: boolean;
  issueServiceType?: TIssueServiceType;
  parentId: string;
  projectId: string;
};

export const SubWorkItemTitleActions = observer(function SubWorkItemTitleActions(props: TSubWorkItemTitleActionsProps) {
  const { disabled, issueServiceType = EIssueServiceType.ISSUES, parentId, projectId } = props;

  // store hooks
  const {
    subIssues: {
      filters: { getSubIssueFilters, updateSubWorkItemFilters },
    },
  } = useIssueDetail(issueServiceType);
  const { getProjectStates } = useProjectState();
  const {
    project: { getProjectMemberIds },
  } = useMember();

  // derived values
  const projectStates = getProjectStates(projectId);
  const projectMemberIds = getProjectMemberIds(projectId, false);
  const subIssueFilters = getSubIssueFilters(parentId);
  const layoutDisplayFiltersOptions = ISSUE_DISPLAY_FILTERS_BY_PAGE["sub_work_items"].layoutOptions.list;

  const handleDisplayFilters = useCallback(
    (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
      updateSubWorkItemFilters(EIssueFilterType.DISPLAY_FILTERS, updatedDisplayFilter, parentId);
    },
    [updateSubWorkItemFilters, parentId]
  );

  const handleDisplayPropertiesUpdate = useCallback(
    (updatedDisplayProperties: Partial<IIssueDisplayProperties>) => {
      updateSubWorkItemFilters(EIssueFilterType.DISPLAY_PROPERTIES, updatedDisplayProperties, parentId);
    },
    [updateSubWorkItemFilters, parentId]
  );

  const handleFiltersUpdate = useCallback(
    (key: keyof IIssueFilterOptions, value: string | string[]) => {
      const newValues = cloneDeep(subIssueFilters?.filters?.[key]) ?? [];

      if (Array.isArray(value)) {
        // this validation is majorly for the filter start_date, target_date custom
        value.forEach((val) => {
          if (!newValues.includes(val)) newValues.push(val);
          else newValues.splice(newValues.indexOf(val), 1);
        });
      } else {
        if (subIssueFilters?.filters?.[key]?.includes(value)) newValues.splice(newValues.indexOf(value), 1);
        else newValues.push(value);
      }
      updateSubWorkItemFilters(EIssueFilterType.FILTERS, { [key]: newValues }, parentId);
    },
    [subIssueFilters?.filters, updateSubWorkItemFilters, parentId]
  );

  return (
    // prevent click everywhere
    <div
      className="flex items-center gap-2"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <SubIssueDisplayFilters
        isEpic={issueServiceType === EIssueServiceType.EPICS}
        layoutDisplayFiltersOptions={layoutDisplayFiltersOptions}
        displayProperties={subIssueFilters?.displayProperties ?? {}}
        displayFilters={subIssueFilters?.displayFilters ?? {}}
        handleDisplayPropertiesUpdate={handleDisplayPropertiesUpdate}
        handleDisplayFiltersUpdate={handleDisplayFilters}
      />
      <SubIssueFilters
        handleFiltersUpdate={handleFiltersUpdate}
        filters={subIssueFilters?.filters ?? {}}
        memberIds={projectMemberIds ?? undefined}
        states={projectStates}
        availableFilters={SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE}
      />
      {!disabled && (
        <SubIssuesActionButton issueId={parentId} disabled={disabled} issueServiceType={issueServiceType} />
      )}
    </div>
  );
});
