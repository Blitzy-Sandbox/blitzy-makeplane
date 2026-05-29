/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact, dismissible chip displaying the currently-selected parent work item inside the issue modal.
 *
 * Rendered purpose: shows a small badge styled with the parent's state color, the parent's project
 * identifier + issue sequence id (via `IssueIdentifier`), a truncated parent name (first 50 characters), and
 * a close (`CloseIcon`) button that clears the parent association. Used by `form.tsx` to render the
 * pre-resolved parent above the work-item title input.
 *
 * Props (`TIssueParentTagProps`):
 *   - control (`Control<TIssue>`, required) — React Hook Form control bound to the parent issue form
 *   - selectedParentIssue (`ISearchIssueResponse`, required) — fully-resolved parent work item from the
 *     `ISearchIssueResponse` shape (carries `name`, `state__color`, `project_id`, `type_id`,
 *     `project__identifier`, `sequence_id`)
 *   - handleFormChange (`() => void`, required) — invoked after the parent is cleared to mark the parent
 *     form as dirty (also triggers debounced duplicate-issue detection upstream)
 *   - setSelectedParentIssue (`(issue: ISearchIssueResponse | null) => void`, required) — modal-context
 *     setter; called with `null` on dismiss to clear the resolved parent snapshot
 *
 * MobX stores read (via hooks):
 *   - `usePlatformOS()` — `isMobile` for `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)` (keyboard tab order)
 *   - No other MobX stores; `selectedParentIssue` is supplied as a prop (resolved upstream in `form.tsx`).
 *
 * Side effects:
 *   - Close button (`onClick` handler):
 *       1. `onChange(null)` — sets `parent_id` in the form to `null` via the `Controller`'s render-prop
 *          field handle.
 *       2. `handleFormChange()` — marks the form dirty (propagates to parent dirty-state tracking).
 *       3. `setSelectedParentIssue(null)` — clears the modal context's resolved parent snapshot so the
 *          `CustomMenu` / "Add parent" branch in `default-properties.tsx` reverts to the "Add parent" state.
 *   - No direct service calls; no navigations; no toasts.
 *
 * Accessibility / keyboard notes:
 *   - The close button has `tabIndex={getIndex("remove_parent")}` to participate in the issue-form tab order.
 *   - The `truncate font-medium` class on the name span limits visible characters; the `substring(0, 50)`
 *     call provides an additional hard cap on the rendered name string (defense in depth against very long
 *     parent issue names).
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively for state (only `usePlatformOS` is consumed here).
 *   - `react-hook-form` `Controller` pattern binds `parent_id`.
 *   - `IssueIdentifier` is imported from `@/plane-web/components/issues/issue-details/issue-identifier`
 *     (EE/CE split — the EE build can swap implementations).
 *   - `CloseIcon` is sourced from `@plane/propel/icons` (the modern design system; this file is one of the
 *     few in the folder that uses `@plane/propel` directly).
 */

import React from "react";
import { observer } from "mobx-react";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { ETabIndices } from "@plane/constants";
import { CloseIcon } from "@plane/propel/icons";
// plane imports
// types
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// helpers
import { getTabIndex } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";

type TIssueParentTagProps = {
  control: Control<TIssue>;
  selectedParentIssue: ISearchIssueResponse;
  handleFormChange: () => void;
  setSelectedParentIssue: (issue: ISearchIssueResponse | null) => void;
};

export const IssueParentTag = observer(function IssueParentTag(props: TIssueParentTagProps) {
  const { control, selectedParentIssue, handleFormChange, setSelectedParentIssue } = props;
  // store hooks
  const { isMobile } = usePlatformOS();

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  return (
    <Controller
      control={control}
      name="parent_id"
      render={({ field: { onChange } }) => (
        <div className="flex w-min items-center gap-2 rounded-sm bg-surface-2 p-2 text-caption-sm-regular whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: selectedParentIssue.state__color,
              }}
            />
            <span className="flex-shrink-0 text-secondary">
              {selectedParentIssue?.project_id && (
                <IssueIdentifier
                  projectId={selectedParentIssue.project_id}
                  issueTypeId={selectedParentIssue.type_id}
                  projectIdentifier={selectedParentIssue?.project__identifier}
                  issueSequenceId={selectedParentIssue.sequence_id}
                  size="xs"
                />
              )}
            </span>
            <span className="truncate font-medium">{selectedParentIssue.name.substring(0, 50)}</span>
            <button
              type="button"
              className="grid place-items-center"
              onClick={() => {
                onChange(null);
                handleFormChange();
                setSelectedParentIssue(null);
              }}
              tabIndex={getIndex("remove_parent")}
            >
              <CloseIcon className="h-3 w-3 cursor-pointer" />
            </button>
          </div>
        </div>
      )}
    />
  );
});
