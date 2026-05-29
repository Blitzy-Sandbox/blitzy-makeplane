/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `label_ids` issue property.
 *
 * Rendered purpose: renders an `<IssuePropertyLabels>` multi-select that lets the user inline-edit
 * the labels of an issue. Pre-resolves the current label objects from the workspace's `labelMap`
 * and passes them as `defaultOptions` so the dropdown can render selected labels even before its
 * own data fetch completes. Mounted only when `WithDisplayPropertiesHOC` approves the `labels`
 * property.
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `label_ids` and
 *     `project_id` (the latter scopes the label dropdown to the project's labels)
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read:
 *   - `useLabel()` exposes `labelMap` — keyed by label id; used to pre-resolve the current
 *     `label_ids` into `ILabel` objects so the dropdown can render the chips immediately
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { label_ids }, { changed_property: "labels",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *
 * Derived state (the WHY for the `defaultLabelOptions` map):
 *   - `defaultLabelOptions = issue?.label_ids?.map((id) => labelMap[id]) || []` resolves the
 *     selected ids into full `ILabel` objects. Passing this to the dropdown's `defaultOptions`
 *     ensures the selected chips are rendered immediately even if the dropdown's internal label
 *     fetch is still in-flight (or if the label list is paginated and the selected ones are not
 *     on the first page).
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `labels` property is enabled.
 */

import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// hooks
import { useLabel } from "@/hooks/store/use-label";
// components
import { IssuePropertyLabels } from "../../properties";

/** Props for `SpreadsheetLabelColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline label selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetLabelColumn = observer(function SpreadsheetLabelColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;
  // hooks
  const { labelMap } = useLabel();

  const defaultLabelOptions = issue?.label_ids?.map((id) => labelMap[id]) || [];

  return (
    <div className="h-11 w-full border-b-[0.5px] border-subtle">
      <IssuePropertyLabels
        projectId={issue.project_id ?? null}
        value={issue.label_ids || []}
        defaultOptions={defaultLabelOptions}
        onChange={(data) => onChange(issue, { label_ids: data }, { changed_property: "labels", change_details: data })}
        className="h-full w-full"
        buttonClassName="px-page-x w-full h-full group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 rounded-none"
        hideDropdownArrow
        maxRender={1}
        disabled={disabled}
        placeholderText="Select labels"
        onClose={onClose}
        noLabelBorder
        fullWidth
        fullHeight
      />
    </div>
  );
});
