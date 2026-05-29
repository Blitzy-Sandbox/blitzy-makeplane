/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `target_date` (due date) issue property with state-aware
 * overdue highlighting.
 *
 * Rendered purpose: renders a `<DateDropdown>` that lets the user inline-edit the due date of an
 * issue. The cell text is tinted with `text-danger-primary` when `shouldHighlightIssueDueDate`
 * determines the issue is overdue — that helper combines the due date with the project state group
 * (open vs. cancelled vs. completed) so completed/cancelled issues are NOT highlighted as overdue
 * even when their target date is in the past. Mounted only when `WithDisplayPropertiesHOC` approves
 * the `due_date` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `target_date`,
 *     `start_date` (for min-date validation), and `state_id` (for highlight derivation)
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`; receives the date serialised through
 *     `renderFormattedPayloadDate` (returns ISO 8601 yyyy-mm-dd) or `null` when cleared
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read:
 *   - `useProjectState()` exposes `getStateById(state_id)` — the resolved `stateDetails.group`
 *     (e.g. `backlog`, `unstarted`, `started`, `completed`, `cancelled`) is what makes the overdue
 *     highlight state-aware
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { target_date }, { changed_property: "target_date",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *   - `minDate={getDate(issue.start_date)}` enforces that the due date cannot precede the start
 *     date (client-side validation; the backend enforces the same invariant in the serializer).
 *
 * Derived state (the WHY for state-aware highlighting):
 *   - `shouldHighlightIssueDueDate(target_date, stateDetails?.group)` returns true when the date
 *     is in the past AND the state group is one that warrants attention (typically open / started).
 *     This is why the cell pulls `useProjectState` even though it doesn't otherwise need it —
 *     red highlighting must NOT appear on completed or cancelled issues whose target date is
 *     historical by design.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `due_date` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
import { DueDatePropertyIcon } from "@plane/propel/icons";
// types
import type { TIssue } from "@plane/types";
import { cn, getDate, renderFormattedPayloadDate, shouldHighlightIssueDueDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
// helpers
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";

/** Props for `SpreadsheetDueDateColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline due-date editor with state-aware overdue highlighting; see the module-level JSDoc for full semantics. */
export const SpreadsheetDueDateColumn = observer(function SpreadsheetDueDateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;
  // store hooks
  const { getStateById } = useProjectState();
  // derived values
  const stateDetails = getStateById(issue.state_id);

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <DateDropdown
        value={issue.target_date}
        minDate={getDate(issue.start_date)}
        onChange={(data) => {
          const targetDate = data ? renderFormattedPayloadDate(data) : null;
          onChange(
            issue,
            { target_date: targetDate },
            {
              changed_property: "target_date",
              change_details: targetDate,
            }
          );
        }}
        disabled={disabled}
        placeholder="Due date"
        icon={<DueDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
        buttonVariant="transparent-with-text"
        buttonContainerClassName="w-full"
        buttonClassName={cn(
          "rounded-none px-page-x text-left group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10",
          {
            "text-danger-primary": shouldHighlightIssueDueDate(issue.target_date, stateDetails?.group),
          }
        )}
        optionsClassName="z-[9]"
        clearIconClassName="!text-primary"
        onClose={onClose}
      />
    </div>
  );
});
