/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `assignee_ids` issue property.
 *
 * Rendered purpose: renders a multi-select `<MemberDropdown>` that lets the user inline-edit the
 * assignees of an issue from a spreadsheet row. Mounted only when `WithDisplayPropertiesHOC` (in
 * the parent `issue-column.tsx`) approves the `assignees` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; `assignee_ids` is read for the
 *     current value and `project_id` is used to scope the member list
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback that the parent
 *     `<IssueColumn>` wraps as `(issue, data) => updateIssue(issue.project_id, issue.id, data)`;
 *     the third `updates` argument carries `{ changed_property, change_details }` for activity tracking
 *   - onClose (() => void, required): invoked when the dropdown closes; the parent restores focus
 *     to the cell `<td>` so keyboard navigation stays intact
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only (cascaded from
 *     `canEditProperties` upstream)
 *
 * MobX stores read: none directly. The embedded `<MemberDropdown>` consumes member rosters from
 * the workspace / project member stores internally.
 *
 * Side effects:
 *   - On selection change, invokes `onChange(issue, { assignee_ids }, { changed_property: "assignees",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream in
 *     `BaseSpreadsheetRoot`'s `updateIssue` handler.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry in `@/plane-web/components/issues/issue-layouts/utils`,
 *     instantiated by `../issue-column.tsx` when the `assignees` property is enabled.
 */
import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// components
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";

/** Props for `SpreadsheetAssigneeColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline assignee selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetAssigneeColumn = observer(function SpreadsheetAssigneeColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <MemberDropdown
        value={issue?.assignee_ids ?? []}
        onChange={(data) => {
          onChange(
            issue,
            { assignee_ids: data },
            {
              changed_property: "assignees",
              change_details: data,
            }
          );
        }}
        projectId={issue?.project_id ?? undefined}
        disabled={disabled}
        multiple
        placeholder="Assignees"
        buttonVariant={
          issue?.assignee_ids && issue.assignee_ids.length > 1 ? "transparent-without-text" : "transparent-with-text"
        }
        buttonClassName="text-left rounded-none group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonContainerClassName="w-full"
        optionsClassName="z-[9]"
        onClose={onClose}
      />
    </div>
  );
});
