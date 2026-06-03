/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Inline editable property strip rendered on a sub-issue row — state, priority,
 * start/due-date (or a merged date-range when both are visible), and assignee
 * dropdowns — that persists every change through `updateSubIssue`. This is the
 * ONLY file in the `sub-issues/` folder that mutates sub-issue state directly on
 * row interaction; all other row actions (edit, delete) route through the modal
 * flow owned by `../content.tsx` via `handleIssueCrudState`.
 *
 * Props (see the `Props` declaration below):
 * - `workspaceSlug` (required) — workspace slug from the URL.
 * - `parentIssueId` (required) — id of the parent issue; used as the
 *   second-to-last segment of the update URL.
 * - `issueId` (required) — id of the sub-issue whose properties are being
 *   edited.
 * - `canEdit` (required) — gates every dropdown's `disabled` flag; when
 *   `false` the dropdowns render in read-only mode.
 * - `updateSubIssue` (required) — row-level mutation callback bound to
 *   `subIssueOperations.updateSubIssue` (see the `updateSubIssue` definition inside
 *   `useSubIssueOperations` in `../helper.ts`) via
 *   `list-item.tsx` (`SubIssuesListItem` passes `subIssueOperations.updateSubIssue` to
 *   `<SubIssuesListItemProperties>` as the `updateSubIssue` prop). The wrapper sets
 *   `issue_loader` helpers and emits
 *   success/error toasts; the raw store action does not — which is why
 *   row-level edits show loading state and toast feedback automatically.
 *   The inline-edit path here NEVER supplies `fromModal = true` (the seventh
 *   positional argument); the modal path in `../content.tsx` DOES.
 * - `displayProperties` (optional) — display-property visibility flags
 *   (`state`, `priority`, `start_date`, `due_date`, `assignee`) read from
 *   the sub-issue filter snapshot. If `undefined`, the component
 *   short-circuits and renders nothing.
 * - `issue` (required) — `TIssue` record whose fields drive every dropdown's
 *   current value. Issue data is passed in via this prop; the component does
 *   NOT read it from the issue store.
 *
 * MobX stores read:
 * - `useProjectState().getStateById` — resolves the `IState` record for
 *   `issue.state_id`, used only to compute `shouldHighlight` (whether the
 *   due-date renders in red via `shouldHighlightIssueDueDate`). The state
 *   dropdown itself does NOT consume this lookup; `StateDropdown` resolves
 *   its own state from `issue.state_id` + the supplied `projectId`.
 *
 * Side effects — direct row-level mutations:
 * Every dropdown's `onChange` (or `onSelect`) callback invokes
 * `updateSubIssue(workspaceSlug, issue.project_id, parentIssueId, issueId,
 * <Partial<TIssue>>, <oldIssue?>)`. All mutations are guarded by
 * `if (issue.project_id)` to skip the call when project context is missing.
 * - State dropdown: payload `{ state_id: val }` and `{ ...issue }` as the
 *   sixth `oldIssue` argument for downstream diff tracking — this is the
 *   ONLY dropdown that supplies `oldIssue`; every other dropdown leaves it
 *   as the wrapper's default `{}`.
 * - Priority dropdown: payload `{ priority: val }`.
 * - Date-range select (merged path): two sequential `updateSubIssue` calls
 *   via `handleStartDate` and `handleTargetDate` with `{ start_date }` and
 *   `{ target_date }` respectively.
 * - Start-date / target-date select (split path): single `updateSubIssue`
 *   call with `{ start_date }` or `{ target_date }`. Dates are serialized
 *   via `renderFormattedPayloadDate` for the payload and parsed via
 *   `getDate` for `minDate`/`maxDate` constraints — these two `@plane/utils`
 *   helpers round-trip the date format between dropdown state and API payload.
 * - Member dropdown: payload `{ assignee_ids: val }`.
 *
 * Date-range merging logic:
 * When both `displayProperties.start_date` AND `displayProperties.due_date`
 * are enabled AND both `issue.start_date` AND `issue.target_date` have
 * values (the `isDateRangeEnabled` derivation), the two separate
 * `DateDropdown` controls are replaced by a single `DateRangeDropdown`. The
 * individual `DateDropdown` cells are then conditionally suppressed via
 * `shouldRenderProperty={() => !isDateRangeEnabled}`. This is a UX choice
 * only — both code paths persist to the same `start_date`/`target_date`
 * fields through `updateSubIssue`.
 *
 * Display-property visibility:
 * Every property cell is wrapped in `WithDisplayPropertiesHOC` with the
 * appropriate `displayPropertyKey`. When the corresponding flag in
 * `displayProperties` is `false`, the cell renders `null`. If
 * `displayProperties` itself is `undefined` the entire component
 * short-circuits to `null`.
 *
 * Consumers:
 * - `apps/web/core/components/issues/issue-detail-widgets/sub-issues/issues-list/list-item.tsx`
 *   (`SubIssuesListItem` renders `<SubIssuesListItemProperties>` inside the row's center
 *   property column) — rendered inside the row's center column. Not referenced elsewhere in
 *   the codebase.
 */

// plane imports
import type { SyntheticEvent } from "react";
import { useMemo } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { StartDatePropertyIcon, DueDatePropertyIcon } from "@plane/propel/icons";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { getDate, renderFormattedPayloadDate, shouldHighlightIssueDueDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { WithDisplayPropertiesHOC } from "@/components/issues/issue-layouts/properties/with-display-properties-HOC";
import { useProjectState } from "@/hooks/store/use-project-state";

type Props = {
  workspaceSlug: string;
  parentIssueId: string;
  issueId: string;
  canEdit: boolean;
  updateSubIssue: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue?: Partial<TIssue>
  ) => Promise<void>;
  displayProperties?: IIssueDisplayProperties;
  issue: TIssue;
};

export const SubIssuesListItemProperties = observer(function SubIssuesListItemProperties(props: Props) {
  const { workspaceSlug, parentIssueId, issueId, canEdit, updateSubIssue, displayProperties, issue } = props;
  const { t } = useTranslation();
  const { getStateById } = useProjectState();

  const handleEventPropagation = (e: SyntheticEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleStartDate = (date: Date | null) => {
    if (issue.project_id) {
      updateSubIssue(workspaceSlug, issue.project_id, parentIssueId, issueId, {
        start_date: date ? renderFormattedPayloadDate(date) : null,
      });
    }
  };

  const handleTargetDate = (date: Date | null) => {
    if (issue.project_id) {
      updateSubIssue(workspaceSlug, issue.project_id, parentIssueId, issueId, {
        target_date: date ? renderFormattedPayloadDate(date) : null,
      });
    }
  };

  //derived values
  const stateDetails = useMemo(() => getStateById(issue.state_id), [getStateById, issue.state_id]);
  const shouldHighlight = useMemo(
    () => shouldHighlightIssueDueDate(issue.target_date, stateDetails?.group),
    [issue.target_date, stateDetails?.group]
  );
  // date range is enabled only when both dates are available and both dates are enabled
  const isDateRangeEnabled: boolean = Boolean(
    issue.start_date && issue.target_date && displayProperties?.start_date && displayProperties?.due_date
  );

  if (!displayProperties) return <></>;

  const maxDate = getDate(issue.target_date);
  const minDate = getDate(issue.start_date);

  return (
    <div className="relative flex items-center gap-2">
      <WithDisplayPropertiesHOC displayProperties={displayProperties} displayPropertyKey="state">
        <div className="h-5 flex-shrink-0">
          <StateDropdown
            value={issue.state_id}
            projectId={issue.project_id ?? undefined}
            onChange={(val) =>
              issue.project_id &&
              updateSubIssue(
                workspaceSlug,
                issue.project_id,
                parentIssueId,
                issueId,
                {
                  state_id: val,
                },
                { ...issue }
              )
            }
            disabled={!canEdit}
            buttonVariant="transparent-without-text"
            buttonClassName="hover:bg-transparent px-0"
            iconSize="size-5"
            showTooltip
          />
        </div>
      </WithDisplayPropertiesHOC>

      <WithDisplayPropertiesHOC displayProperties={displayProperties} displayPropertyKey="priority">
        <div className="h-5 flex-shrink-0">
          <PriorityDropdown
            value={issue.priority}
            onChange={(val) =>
              issue.project_id &&
              updateSubIssue(workspaceSlug, issue.project_id, parentIssueId, issueId, {
                priority: val,
              })
            }
            disabled={!canEdit}
            buttonVariant="border-without-text"
            showTooltip
          />
        </div>
      </WithDisplayPropertiesHOC>

      {/* merged dates */}
      <WithDisplayPropertiesHOC
        displayProperties={displayProperties}
        displayPropertyKey={["start_date", "due_date"]}
        shouldRenderProperty={() => isDateRangeEnabled}
      >
        <div className="h-5" onFocus={handleEventPropagation} onClick={handleEventPropagation}>
          <DateRangeDropdown
            value={{
              from: getDate(issue.start_date) || undefined,
              to: getDate(issue.target_date) || undefined,
            }}
            placement="top-end"
            onSelect={(range) => {
              handleStartDate(range?.from ?? null);
              handleTargetDate(range?.to ?? null);
            }}
            hideIcon={{
              from: false,
            }}
            isClearable
            mergeDates
            buttonVariant={issue.start_date || issue.target_date ? "border-with-text" : "border-without-text"}
            buttonClassName={shouldHighlight ? "text-danger-primary" : ""}
            disabled={!canEdit}
            showTooltip
            customTooltipHeading="Date Range"
            renderPlaceholder={false}
            renderInPortal
          />
        </div>
      </WithDisplayPropertiesHOC>

      {/* start date */}
      <WithDisplayPropertiesHOC
        displayProperties={displayProperties}
        displayPropertyKey="start_date"
        shouldRenderProperty={() => !isDateRangeEnabled}
      >
        <div className="h-5">
          <DateDropdown
            value={issue.start_date ?? null}
            onChange={handleStartDate}
            maxDate={maxDate}
            placeholder={t("common.order_by.start_date")}
            icon={<StartDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
            buttonVariant={issue.start_date ? "border-with-text" : "border-without-text"}
            optionsClassName="z-30"
            disabled={!canEdit}
            showTooltip
          />
        </div>
      </WithDisplayPropertiesHOC>

      {/* target/due date */}
      <WithDisplayPropertiesHOC
        displayProperties={displayProperties}
        displayPropertyKey="due_date"
        shouldRenderProperty={() => !isDateRangeEnabled}
      >
        <div className="h-5">
          <DateDropdown
            value={issue?.target_date ?? null}
            onChange={handleTargetDate}
            minDate={minDate}
            placeholder={t("common.order_by.due_date")}
            icon={<DueDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
            buttonVariant={issue.target_date ? "border-with-text" : "border-without-text"}
            buttonClassName={shouldHighlight ? "text-danger-primary" : ""}
            clearIconClassName="text-primary"
            optionsClassName="z-30"
            disabled={!canEdit}
            showTooltip
          />
        </div>
      </WithDisplayPropertiesHOC>

      <WithDisplayPropertiesHOC displayProperties={displayProperties} displayPropertyKey="assignee">
        <div className="h-5 flex-shrink-0">
          <MemberDropdown
            value={issue.assignee_ids}
            projectId={issue.project_id ?? undefined}
            onChange={(val) =>
              issue.project_id &&
              updateSubIssue(workspaceSlug, issue.project_id, parentIssueId, issueId, {
                assignee_ids: val,
              })
            }
            disabled={!canEdit}
            multiple
            buttonVariant={(issue?.assignee_ids || []).length > 0 ? "transparent-without-text" : "border-without-text"}
            buttonClassName={(issue?.assignee_ids || []).length > 0 ? "hover:bg-transparent px-0" : ""}
          />
        </div>
      </WithDisplayPropertiesHOC>
    </div>
  );
});
