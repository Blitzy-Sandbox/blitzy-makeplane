/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `start_date` issue property.
 *
 * Rendered purpose: renders a `<DateDropdown>` that lets the user inline-edit the start date of an
 * issue. Caps the maximum selectable date at the issue's `target_date` (when set) so the start
 * date can never exceed the due date. Mounted only when `WithDisplayPropertiesHOC` approves the
 * `start_date` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `start_date` and
 *     `target_date` (for max-date validation)
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`; receives the date serialised through
 *     `renderFormattedPayloadDate` (returns ISO 8601 yyyy-mm-dd) or `null` when cleared
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read: none — start date has no state-aware highlighting (unlike `due-date-column.tsx`
 * which consults `useProjectState` to decide overdue styling).
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { start_date }, { changed_property: "start_date",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *   - `maxDate={getDate(issue.target_date)}` enforces that the start date cannot exceed the due
 *     date (client-side validation; the backend enforces the same invariant in the serializer).
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `start_date` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
import { StartDatePropertyIcon } from "@plane/propel/icons";
// types
import type { TIssue } from "@plane/types";
// components
import { getDate, renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
// helpers

/** Props for `SpreadsheetStartDateColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline start-date editor cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetStartDateColumn = observer(function SpreadsheetStartDateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <DateDropdown
        value={issue.start_date}
        maxDate={getDate(issue.target_date)}
        onChange={(data) => {
          const startDate = data ? renderFormattedPayloadDate(data) : null;
          onChange(
            issue,
            { start_date: startDate },
            {
              changed_property: "start_date",
              change_details: startDate,
            }
          );
        }}
        disabled={disabled}
        placeholder="Start date"
        icon={<StartDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
        buttonVariant="transparent-with-text"
        buttonClassName="text-left rounded-none group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonContainerClassName="w-full"
        optionsClassName="z-[9]"
        onClose={onClose}
      />
    </div>
  );
});
