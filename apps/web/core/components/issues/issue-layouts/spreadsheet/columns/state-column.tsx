/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `state_id` issue property.
 *
 * Rendered purpose: renders a `<StateDropdown>` that lets the user inline-edit the workflow state
 * of an issue. The dropdown reads the project's configured states (`backlog`, `unstarted`,
 * `started`, `completed`, `cancelled` groups) from the project-state store internally. Mounted
 * only when `WithDisplayPropertiesHOC` approves the `state` property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `state_id` and
 *     `project_id` (the latter scopes the state dropdown to the project's states)
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read: none directly. The embedded `<StateDropdown>` consumes the project-state
 * store internally to render the configured states with their icons + colours.
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { state_id }, { changed_property: "state",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *   - Changing the state may trigger downstream effects in the backend (e.g. state-change signal
 *     handlers fire automation tasks, notification tasks) but those are not visible at this layer.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `state` property is enabled.
 */
import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// components
import { StateDropdown } from "@/components/dropdowns/state/dropdown";

/** Props for `SpreadsheetStateColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline state selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetStateColumn = observer(function SpreadsheetStateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <StateDropdown
        projectId={issue.project_id ?? undefined}
        value={issue.state_id}
        onChange={(data) => onChange(issue, { state_id: data }, { changed_property: "state", change_details: data })}
        disabled={disabled}
        buttonVariant="transparent-with-text"
        buttonClassName="text-left rounded-none group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonContainerClassName="w-full"
        onClose={onClose}
        showTooltip
      />
    </div>
  );
});
