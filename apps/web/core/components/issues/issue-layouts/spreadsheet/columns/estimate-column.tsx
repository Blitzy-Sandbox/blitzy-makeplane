/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `estimate_point` issue property.
 *
 * Rendered purpose: renders an `<EstimateDropdown>` that lets the user inline-edit the estimate
 * value for an issue. The dropdown reads the project's configured estimate scale (story points,
 * t-shirt sizes, hours, etc.) from the project-estimate store internally. Mounted only when
 * `WithDisplayPropertiesHOC` approves the `estimate` property AND the project has an estimate
 * scale enabled (the latter is gated upstream via `isEstimateEnabled` in `SpreadsheetView`).
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `estimate_point` and
 *     `project_id` (for resolving the project's estimate scale)
 *   - onChange ((issue, data, updates) => void, required): inline-edit callback wrapped upstream as
 *     `updateIssue(issue.project_id, issue.id, data)`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read: none directly. The embedded `<EstimateDropdown>` consumes the project-estimate
 * store internally to render the configured scale.
 *
 * Side effects:
 *   - On selection, invokes `onChange(issue, { estimate_point }, { changed_property: "estimate_point",
 *     change_details })` — the actual PATCH to `/api/.../issues/{id}/` happens upstream.
 *   - `value={issue.estimate_point || undefined}` coerces null to undefined so the dropdown's
 *     placeholder renders when no estimate is set.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `estimate` property is enabled.
 */

import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// components
import { EstimateDropdown } from "@/components/dropdowns/estimate";

/** Props for `SpreadsheetEstimateColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

/** Inline estimate selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetEstimateColumn = observer(function SpreadsheetEstimateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <EstimateDropdown
        value={issue.estimate_point || undefined}
        onChange={(data) =>
          onChange(issue, { estimate_point: data }, { changed_property: "estimate_point", change_details: data })
        }
        placeholder="Estimate"
        projectId={issue.project_id ?? undefined}
        disabled={disabled}
        buttonVariant="transparent-with-text"
        buttonClassName="text-left rounded-none group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonContainerClassName="w-full"
        onClose={onClose}
      />
    </div>
  );
});
