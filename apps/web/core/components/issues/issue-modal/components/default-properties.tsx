/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composite control block rendering the core issue metadata editors inside the issue modal.
 *
 * Rendered purpose: lays out a flex-wrap row of dropdowns / pickers for state, priority, assignees, labels,
 * start date, due date, cycle (when the project enables cycles), module (when the project enables modules),
 * estimate point (when the project has estimates enabled), and parent work item selection. The parent control
 * is a `CustomMenu` when a parent is selected (offering "change parent" and "remove parent") or a plain
 * "Add parent" button otherwise; it opens `ParentIssuesListModal` for parent picking.
 *
 * Props (`TIssueDefaultPropertiesProps`):
 *   - control (`Control<TIssue>`, required) — React Hook Form control bound to the parent issue form
 *   - id (`string | undefined`, required) — work item id when editing (used to gate `ParentIssuesListModal`
 *     exclusion and `StateDropdown.isForWorkItemCreation`)
 *   - projectId (`string | null`, required) — active project id; gates cycle / module / estimate visibility
 *     and is forwarded to every project-scoped dropdown
 *   - workspaceSlug (`string`, required) — used by `useUserPermissions().allowPermissions` to compute
 *     `canCreateLabel` and forwarded to `ModuleDropdown`
 *   - selectedParentIssue (`ISearchIssueResponse | null`, required) — currently-resolved parent work item;
 *     rendered inside the `CustomMenu` button via `IssueIdentifier`
 *   - startDate (`string | null`, required) — current `start_date` value; used to compute `minDate` for
 *     the target-date picker (target date cannot be before start date)
 *   - targetDate (`string | null`, required) — current `target_date` value; used to compute `maxDate` for
 *     the start-date picker (start date cannot be after target date)
 *   - parentId (`string | null`, required) — current `parent_id`; gates the `CustomMenu`-vs-button branch
 *   - isDraft (`boolean`, required) — when true, the parent-issue picker omits its own id from the
 *     exclusion list so a draft can be linked to itself's resolved parent later
 *   - handleFormChange (`() => void`, required) — invoked after every field change to mark the parent form
 *     as dirty (also triggers debounced duplicate-issue detection upstream)
 *   - setSelectedParentIssue (`(issue: ISearchIssueResponse) => void`, required) — updates the modal
 *     context's `selectedParentIssue` when the user picks a new parent
 *
 * MobX stores read (via hooks):
 *   - `useTranslation()` — `t` for i18n keys (labels, placeholders, menu items)
 *   - `useProjectEstimates()` — `areEstimateEnabledByProjectId` to gate the estimate dropdown
 *   - `useProject()` — `getProjectById` for `projectDetails` (used to gate cycle/module dropdowns by
 *     `projectDetails.cycle_view` / `projectDetails.module_view`)
 *   - `usePlatformOS()` — `isMobile` for `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)` (keyboard tab order)
 *   - `useUserPermissions()` — `allowPermissions` to compute `canCreateLabel` for the label dropdown
 *     (ADMIN at PROJECT level)
 *
 * Side effects:
 *   - For every field, calls `handleFormChange()` after `onChange` propagates the new value to RHF.
 *   - Opens `ParentIssuesListModal` via local state `parentIssueListModalOpen` (set by the "Add parent" button
 *     and the "Change parent" menu item).
 *   - Clears `parent_id` to `null` via the "Remove parent" menu item (calls `handleFormChange()` too).
 *   - Date pickers normalize via `renderFormattedPayloadDate(date)`; `null` is passed when the date is cleared.
 *   - No direct service calls; all persistence flows through the parent form's submit handler.
 *   - No navigations.
 *
 * Derived state / conditional rendering notes:
 *   - `canCreateLabel` is `truthy` only when both `projectId` is set AND the user has ADMIN permission at the
 *     PROJECT level for the active `workspaceSlug` + `projectId` pair.
 *   - `minDate = getDate(startDate); minDate?.setDate(minDate.getDate())` and the symmetrical `maxDate`
 *     computation produce `Date` objects (mutating them in place after construction); these are forwarded to
 *     the date pickers as the open-range bounds.
 *   - The cycle dropdown renders only when `projectDetails?.cycle_view` is truthy.
 *   - The module dropdown renders only when `projectDetails?.module_view` is truthy AND `workspaceSlug` is
 *     non-empty.
 *   - The estimate dropdown renders only when `projectId` is truthy AND
 *     `areEstimateEnabledByProjectId(projectId)` returns true.
 *   - The parent control switches between a `CustomMenu` (when `parentId` is truthy) and a plain "Add parent"
 *     button (when `parentId` is null).
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively — every store read above is via a React-context-injected hook.
 *   - `react-hook-form` Controllers per field; each field is bound to a single `TIssue` key.
 *   - i18n via `@plane/i18n` `useTranslation()`; all user-facing strings are translation keys.
 *   - Tab index: `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)` returns a `getIndex(fieldName)` lookup that
 *     keeps keyboard navigation consistent across desktop and mobile.
 *   - Sub-component `IssueIdentifier` is imported from `@/plane-web/components/issues/issue-details/issue-identifier`
 *     (EE/CE split — the EE build can swap implementations).
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { ETabIndices, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ParentPropertyIcon } from "@plane/propel/icons";
// types
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// ui
import { CustomMenu } from "@plane/ui";
import { getDate, renderFormattedPayloadDate, getTabIndex } from "@plane/utils";
// components
import { CycleDropdown } from "@/components/dropdowns/cycle";
import { DateDropdown } from "@/components/dropdowns/date";
import { EstimateDropdown } from "@/components/dropdowns/estimate";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { ParentIssuesListModal } from "@/components/issues/parent-issues-list-modal";
import { IssueLabelSelect } from "@/components/issues/select";
// helpers
// hooks
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";

type TIssueDefaultPropertiesProps = {
  control: Control<TIssue>;
  id: string | undefined;
  projectId: string | null;
  workspaceSlug: string;
  selectedParentIssue: ISearchIssueResponse | null;
  startDate: string | null;
  targetDate: string | null;
  parentId: string | null;
  isDraft: boolean;
  handleFormChange: () => void;
  setSelectedParentIssue: (issue: ISearchIssueResponse) => void;
};

export const IssueDefaultProperties = observer(function IssueDefaultProperties(props: TIssueDefaultPropertiesProps) {
  const {
    control,
    id,
    projectId,
    workspaceSlug,
    selectedParentIssue,
    startDate,
    targetDate,
    parentId,
    isDraft,
    handleFormChange,
    setSelectedParentIssue,
  } = props;
  // states
  const [parentIssueListModalOpen, setParentIssueListModalOpen] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { areEstimateEnabledByProjectId } = useProjectEstimates();
  const { getProjectById } = useProject();
  const { isMobile } = usePlatformOS();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const projectDetails = getProjectById(projectId);

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  const canCreateLabel =
    projectId && allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  const minDate = getDate(startDate);
  minDate?.setDate(minDate.getDate());

  const maxDate = getDate(targetDate);
  maxDate?.setDate(maxDate.getDate());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Controller
        control={control}
        name="state_id"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <StateDropdown
              value={value}
              onChange={(stateId) => {
                onChange(stateId);
                handleFormChange();
              }}
              projectId={projectId ?? undefined}
              buttonVariant="border-with-text"
              tabIndex={getIndex("state_id")}
              isForWorkItemCreation={!id}
            />
          </div>
        )}
      />
      <Controller
        control={control}
        name="priority"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <PriorityDropdown
              value={value}
              onChange={(priority) => {
                onChange(priority);
                handleFormChange();
              }}
              buttonVariant="border-with-text"
              tabIndex={getIndex("priority")}
            />
          </div>
        )}
      />
      <Controller
        control={control}
        name="assignee_ids"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <MemberDropdown
              projectId={projectId ?? undefined}
              value={value}
              onChange={(assigneeIds) => {
                onChange(assigneeIds);
                handleFormChange();
              }}
              buttonVariant={value?.length > 0 ? "transparent-without-text" : "border-with-text"}
              buttonClassName={value?.length > 0 ? "hover:bg-transparent" : ""}
              placeholder={t("assignees")}
              multiple
              tabIndex={getIndex("assignee_ids")}
            />
          </div>
        )}
      />
      <Controller
        control={control}
        name="label_ids"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <IssueLabelSelect
              value={value}
              onChange={(labelIds) => {
                onChange(labelIds);
                handleFormChange();
              }}
              projectId={projectId ?? undefined}
              tabIndex={getIndex("label_ids")}
              createLabelEnabled={!!canCreateLabel}
            />
          </div>
        )}
      />
      <Controller
        control={control}
        name="start_date"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <DateDropdown
              value={value}
              onChange={(date) => {
                onChange(date ? renderFormattedPayloadDate(date) : null);
                handleFormChange();
              }}
              buttonVariant="border-with-text"
              maxDate={maxDate ?? undefined}
              placeholder={t("start_date")}
              tabIndex={getIndex("start_date")}
            />
          </div>
        )}
      />
      <Controller
        control={control}
        name="target_date"
        render={({ field: { value, onChange } }) => (
          <div className="h-7">
            <DateDropdown
              value={value}
              onChange={(date) => {
                onChange(date ? renderFormattedPayloadDate(date) : null);
                handleFormChange();
              }}
              buttonVariant="border-with-text"
              minDate={minDate ?? undefined}
              placeholder={t("due_date")}
              tabIndex={getIndex("target_date")}
            />
          </div>
        )}
      />
      {projectDetails?.cycle_view && (
        <Controller
          control={control}
          name="cycle_id"
          render={({ field: { value, onChange } }) => (
            <div className="h-7">
              <CycleDropdown
                projectId={projectId ?? undefined}
                onChange={(cycleId) => {
                  onChange(cycleId);
                  handleFormChange();
                }}
                placeholder={t("cycle.label", { count: 1 })}
                value={value}
                buttonVariant="border-with-text"
                tabIndex={getIndex("cycle_id")}
              />
            </div>
          )}
        />
      )}
      {projectDetails?.module_view && workspaceSlug && (
        <Controller
          control={control}
          name="module_ids"
          render={({ field: { value, onChange } }) => (
            <div className="h-7">
              <ModuleDropdown
                projectId={projectId ?? undefined}
                value={value ?? []}
                onChange={(moduleIds) => {
                  onChange(moduleIds);
                  handleFormChange();
                }}
                placeholder={t("modules")}
                buttonVariant="border-with-text"
                tabIndex={getIndex("module_ids")}
                multiple
                showCount
              />
            </div>
          )}
        />
      )}
      {projectId && areEstimateEnabledByProjectId(projectId) && (
        <Controller
          control={control}
          name="estimate_point"
          render={({ field: { value, onChange } }) => (
            <div className="h-7">
              <EstimateDropdown
                value={value || undefined}
                onChange={(estimatePoint) => {
                  onChange(estimatePoint);
                  handleFormChange();
                }}
                projectId={projectId}
                buttonVariant="border-with-text"
                tabIndex={getIndex("estimate_point")}
                placeholder={t("estimate")}
              />
            </div>
          )}
        />
      )}
      <div className="h-7">
        {parentId ? (
          <CustomMenu
            customButton={
              <button
                type="button"
                className="flex h-full cursor-pointer items-center justify-between gap-1 rounded-sm border-[0.5px] border-strong px-2 py-0.5 text-caption-sm-regular hover:bg-layer-1"
              >
                {selectedParentIssue?.project_id && (
                  <IssueIdentifier
                    projectId={selectedParentIssue.project_id}
                    issueTypeId={selectedParentIssue.type_id}
                    projectIdentifier={selectedParentIssue?.project__identifier}
                    issueSequenceId={selectedParentIssue.sequence_id}
                    size="xs"
                  />
                )}
              </button>
            }
            placement="bottom-start"
            className="h-full w-full"
            customButtonClassName="h-full"
            tabIndex={getIndex("parent_id")}
          >
            <>
              <CustomMenu.MenuItem className="!p-1" onClick={() => setParentIssueListModalOpen(true)}>
                {t("change_parent_issue")}
              </CustomMenu.MenuItem>
              <Controller
                control={control}
                name="parent_id"
                render={({ field: { onChange } }) => (
                  <CustomMenu.MenuItem
                    className="!p-1"
                    onClick={() => {
                      onChange(null);
                      handleFormChange();
                    }}
                  >
                    {t("remove_parent_issue")}
                  </CustomMenu.MenuItem>
                )}
              />
            </>
          </CustomMenu>
        ) : (
          <button
            type="button"
            className="flex h-full cursor-pointer items-center justify-between gap-1 rounded-sm border-[0.5px] border-strong px-2 py-0.5 text-caption-sm-regular hover:bg-layer-1"
            onClick={() => setParentIssueListModalOpen(true)}
          >
            <ParentPropertyIcon className="h-3 w-3 flex-shrink-0" />
            <span className="whitespace-nowrap">{t("add_parent")}</span>
          </button>
        )}
      </div>
      <Controller
        control={control}
        name="parent_id"
        render={({ field: { onChange } }) => (
          <ParentIssuesListModal
            isOpen={parentIssueListModalOpen}
            handleClose={() => setParentIssueListModalOpen(false)}
            onChange={(issue) => {
              onChange(issue.id);
              handleFormChange();
              setSelectedParentIssue(issue);
            }}
            projectId={projectId ?? undefined}
            issueId={isDraft ? undefined : id}
          />
        )}
      />
    </div>
  );
});
