/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `priority` issue property.
 *
 * Rendered purpose: renders a `<PriorityDropdown>` that lets the user inline-edit the priority of
 * an issue. Priority is a fixed enum (urgent / high / medium / low / none) defined in
 * `@plane/types`; the dropdown renders the canonical icon + label for each option. Mounted only
 * when `WithDisplayPropertiesHOC` approves the `priority` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `priority`
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read: none — priority enum values are static.
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { priority }, { changed_property: "priority",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `priority` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// components
import { PriorityDropdown } from "@/components/dropdowns/priority";

/** Props for `SpreadsheetPriorityColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline priority selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetPriorityColumn = observer(function SpreadsheetPriorityColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <PriorityDropdown
        value={issue.priority}
        onChange={(data) => onChange(issue, { priority: data }, { changed_property: "priority", change_details: data })}
        disabled={disabled}
        buttonVariant="transparent-with-text"
        buttonClassName="text-left rounded-none group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonContainerClassName="w-full"
        onClose={onClose}
      />
    </div>
  );
});
