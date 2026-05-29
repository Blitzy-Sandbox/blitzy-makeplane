/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Controlled project picker for the issue modal, bound to the form's `project_id` field.
 *
 * Rendered purpose: wraps `ProjectDropdown` in a React Hook Form `Controller` for the `project_id` field on
 * `TIssue`, restricting the selectable options to projects allowed by the modal context
 * (`allowedProjectIds` from `useIssueModal()`) and propagating changes to the parent via
 * `handleFormChange()`. Used at the top of `form.tsx` to choose which project the new/edited work item
 * belongs to.
 *
 * Props (`TIssueProjectSelectProps`):
 *   - control (`Control<TIssue>`, required) — React Hook Form control bound to the parent issue form
 *   - disabled (`boolean`, optional, default=false) — disables the underlying dropdown (e.g. when a project
 *     is preselected and cannot be changed, such as when the modal is launched from inside a project page
 *     with `isProjectSelectionDisabled` set)
 *   - handleFormChange (`() => void`, required) — invoked after `onChange` propagates the new project id to
 *     RHF; marks the form dirty (and triggers debounced duplicate-issue detection upstream)
 *
 * MobX stores read (via hooks):
 *   - `usePlatformOS()` — `isMobile` for `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)` (keyboard tab order)
 *   - `useIssueModal()` (issue-modal React context, not a MobX store per se but the directive-scope context
 *     hook) — `allowedProjectIds` used by `ProjectDropdown.renderCondition` to filter the dropdown options
 *
 * Side effects:
 *   - Calls `onChange(projectId)` to propagate the new project id to RHF, then `handleFormChange()` to mark
 *     the form dirty. The parent (`form.tsx`) reacts to this change by:
 *       1. Resetting the form with new project defaults
 *       2. Re-fetching cycles for the newly selected project
 *       3. Resolving `getIssueTypeIdOnProjectChange` for the new project
 *   - No direct service calls; no navigations; no toasts.
 *
 * Validation:
 *   - Field is required at the RHF level (`rules={{ required: true }}`). The error UI for this is handled
 *     elsewhere in the form (the submit handler shows a toast if `project_id` is missing).
 *
 * Accessibility / keyboard notes:
 *   - `tabIndex={getIndex("project_id")}` participates in the consistent issue-form tab order.
 *   - The dropdown button variant is `"border-with-text"` (visible bordered control); when `disabled` is
 *     true, the underlying `ProjectDropdown` renders its disabled visual state and stops responding to
 *     pointer / keyboard events.
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively for state; the modal-scope context (`useIssueModal`) is a React context wrapper
 *     around modal-only state derived from MobX stores.
 *   - `react-hook-form` `Controller` for form binding.
 *   - `ProjectDropdown` from `@/components/dropdowns/project/dropdown` handles the actual dropdown UX
 *     (multiselect=false here because a work item belongs to exactly one project).
 *   - `renderCondition` is the dropdown's per-option filter callback; `allowedProjectIds.includes(projectId)`
 *     enforces the caller-supplied project allowlist at render time.
 */

import React from "react";
import { observer } from "mobx-react";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
// plane imports
import { ETabIndices } from "@plane/constants";
// types
import type { TIssue } from "@plane/types";
import { getTabIndex } from "@plane/utils";
// components
import { ProjectDropdown } from "@/components/dropdowns/project/dropdown";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueProjectSelectProps = {
  control: Control<TIssue>;
  disabled?: boolean;
  handleFormChange: () => void;
};

export const IssueProjectSelect = observer(function IssueProjectSelect(props: TIssueProjectSelectProps) {
  const { control, disabled = false, handleFormChange } = props;
  // store hooks
  const { isMobile } = usePlatformOS();
  // context hooks
  const { allowedProjectIds } = useIssueModal();

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  return (
    <Controller
      control={control}
      name="project_id"
      rules={{
        required: true,
      }}
      render={({ field: { value, onChange } }) => (
        <div className="h-7">
          <ProjectDropdown
            value={value}
            onChange={(projectId) => {
              onChange(projectId);
              handleFormChange();
            }}
            multiple={false}
            buttonVariant="border-with-text"
            renderCondition={(projectId) => allowedProjectIds.includes(projectId)}
            tabIndex={getIndex("project_id")}
            disabled={disabled}
          />
        </div>
      )}
    />
  );
});
