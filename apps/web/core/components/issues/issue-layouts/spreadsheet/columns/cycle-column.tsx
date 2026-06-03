/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `cycle_id` issue property.
 *
 * Rendered purpose: renders a `<CycleDropdown>` that lets the user assign or remove the cycle for
 * an issue from a spreadsheet row. Unlike most editor cells this one bypasses the parent `onChange`
 * callback and calls the issues-store actions directly because cycle assignment is a separate
 * relation (it triggers a dedicated POST/DELETE endpoint rather than a PATCH on the issue body).
 * Mounted only when `WithDisplayPropertiesHOC` approves the `cycle` property AND the project has
 * cycles enabled (the latter gate is enforced upstream in `SpreadsheetView`).
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `cycle_id`, `project_id`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read:
 *   - `useIssuesStore()` exposes the active issues slice's `addCycleToIssue` and
 *     `removeCycleFromIssue` actions; the active store is resolved from React context (varies
 *     between project / module / cycle / view contexts)
 *
 * Side effects:
 *   - When the user selects a cycle, calls `addCycleToIssue(workspaceSlug, projectId, cycleId,
 *     issueId)` which POSTs to `/api/workspaces/<slug>/projects/<id>/cycles/<cycleId>/cycle-issues/`
 *     via the cycle service.
 *   - When the user clears the cycle, calls `removeCycleFromIssue(workspaceSlug, projectId, issueId)`
 *     which DELETEs the relation.
 *   - Both calls are short-circuited when `issue.cycle_id === cycleId` (idempotent no-op).
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `cycle` property is enabled.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import type { TIssue } from "@plane/types";
// components
import { CycleDropdown } from "@/components/dropdowns/cycle";
// hooks
import { useIssuesStore } from "@/hooks/use-issue-layout-store";

/** Props for `SpreadsheetCycleColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  disabled: boolean;
};

/** Inline cycle selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetCycleColumn = observer(function SpreadsheetCycleColumn(props: Props) {
  const { issue, disabled, onClose } = props;
  // router
  const { workspaceSlug } = useParams();
  // hooks
  const {
    issues: { addCycleToIssue, removeCycleFromIssue },
  } = useIssuesStore();

  const handleCycle = useCallback(
    async (cycleId: string | null) => {
      if (!workspaceSlug || !issue || !issue.project_id || issue.cycle_id === cycleId) return;
      if (cycleId) await addCycleToIssue(workspaceSlug.toString(), issue.project_id, cycleId, issue.id);
      else await removeCycleFromIssue(workspaceSlug.toString(), issue.project_id, issue.id);
    },
    [workspaceSlug, issue, addCycleToIssue, removeCycleFromIssue]
  );

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <CycleDropdown
        projectId={issue.project_id ?? undefined}
        value={issue.cycle_id}
        onChange={handleCycle}
        disabled={disabled}
        placeholder="Select cycle"
        buttonVariant="transparent-with-text"
        buttonContainerClassName="w-full relative flex items-center p-2 group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonClassName="relative leading-4 h-4.5 bg-transparent hover:bg-transparent px-0"
        onClose={onClose}
      />
    </div>
  );
});
