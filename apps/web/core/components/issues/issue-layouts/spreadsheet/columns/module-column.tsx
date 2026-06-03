/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet cell editor for the `module_ids` (multi-module assignment) issue property.
 *
 * Rendered purpose: renders a multi-select `<ModuleDropdown>` that lets the user inline-edit the
 * modules an issue belongs to. Unlike most editor cells this one bypasses the parent `onChange`
 * callback and invokes the issues-store action directly because module membership is a many-to-many
 * relation (it triggers dedicated POST/DELETE endpoints rather than a PATCH on the issue body).
 * Computes the symmetric difference between the previous and next selection sets to derive separate
 * add / remove lists for the API call. Mounted only when `WithDisplayPropertiesHOC` approves the
 * `modules` property AND the project has modules enabled (the latter gate is enforced upstream in
 * `SpreadsheetView`).
 *
 * Props (Props):
 *   - issue (TIssue, required): the issue row this cell belongs to; reads `module_ids`, `project_id`, `id`
 *   - onClose (() => void, required): focus-restoration callback invoked when the dropdown closes
 *   - disabled (boolean, required): when true, the dropdown is rendered read-only
 *
 * MobX stores read:
 *   - `useIssuesStore()` exposes the active issues slice's `changeModulesInIssue` action which
 *     accepts separate `modulesToAdd` and `modulesToRemove` lists
 *
 * Side effects (the WHY for symmetric-difference partitioning):
 *   - `lodash-es/xor(oldModuleIds, newModuleIds)` returns the symmetric difference — i.e. every id
 *     that is in exactly one of the two arrays. The local loop then partitions those ids into
 *     `modulesToAdd` (ids in newModuleIds but not oldModuleIds) and `modulesToRemove` (ids in
 *     oldModuleIds but not newModuleIds). This partitioning is required because the modules API
 *     exposes separate POST (add) and DELETE (remove) endpoints — the wrapper must tell the store
 *     which subset of the diff is an addition vs. a removal.
 *   - `changeModulesInIssue(workspaceSlug, projectId, issueId, modulesToAdd, modulesToRemove)`
 *     ultimately fans out to module-issue POST and DELETE calls via the module service.
 *
 * Consumers:
 *   - Indirectly via the `SPREADSHEET_COLUMNS` registry, instantiated by `../issue-column.tsx`
 *     when the `modules` property is enabled.
 */

import { useCallback } from "react";
import { xor } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import type { TIssue } from "@plane/types";
// components
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
// hooks
import { useIssuesStore } from "@/hooks/use-issue-layout-store";

/** Props for `SpreadsheetModuleColumn`. */
type Props = {
  issue: TIssue;
  onClose: () => void;
  disabled: boolean;
};

/** Inline module multi-selector cell; see the module-level JSDoc for full semantics. */
export const SpreadsheetModuleColumn = observer(function SpreadsheetModuleColumn(props: Props) {
  const { issue, disabled, onClose } = props;
  // router
  const { workspaceSlug } = useParams();
  // hooks
  const {
    issues: { changeModulesInIssue },
  } = useIssuesStore();

  const handleModule = useCallback(
    async (moduleIds: string[] | null) => {
      if (!workspaceSlug || !issue || !issue.project_id || !issue.module_ids || !moduleIds) return;

      const updatedModuleIds = xor(issue.module_ids, moduleIds);
      const modulesToAdd: string[] = [];
      const modulesToRemove: string[] = [];
      for (const moduleId of updatedModuleIds) {
        if (issue.module_ids.includes(moduleId)) modulesToRemove.push(moduleId);
        else modulesToAdd.push(moduleId);
      }
      changeModulesInIssue(workspaceSlug.toString(), issue.project_id, issue.id, modulesToAdd, modulesToRemove);
    },
    [workspaceSlug, issue, changeModulesInIssue]
  );

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <ModuleDropdown
        projectId={issue?.project_id ?? undefined}
        value={issue?.module_ids ?? []}
        onChange={handleModule}
        disabled={disabled}
        placeholder="Select modules"
        buttonVariant="transparent-with-text"
        buttonContainerClassName="w-full relative flex items-center p-2 group-[.selected-issue-row]:bg-accent-primary/5 group-[.selected-issue-row]:hover:bg-accent-primary/10 px-page-x"
        buttonClassName="relative leading-4 h-4.5 bg-transparent hover:bg-transparent !px-0"
        onClose={onClose}
        multiple
        showCount
        showTooltip
      />
    </div>
  );
});
