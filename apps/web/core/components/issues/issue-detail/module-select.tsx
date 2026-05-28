/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Multi-select module assignment control for the issue detail sidebar.
 *
 * Rendered purpose: a multi-select `ModuleDropdown` (variant `transparent-with-text`) that shows the
 * work item's current module memberships and lets the user add or remove modules. Diffs the
 * incoming selection against the current `module_ids` so the persistence call carries only the
 * delta (additions + removals), not the full set.
 *
 * Props (TIssueModuleSelect):
 *   - className (string, optional, default=""): wrapper class overrides
 *   - workspaceSlug (string, required): scopes the module mutation
 *   - projectId (string, required): scopes the module mutation and bounds the dropdown options
 *   - issueId (string, required): the work item being assigned
 *   - issueOperations (TIssueOperations, required): the issue-update contract exposed from `./root`
 *     — specifically the optional `changeModulesInIssue` method
 *   - disabled (boolean, optional, default=false): disables both the dropdown and the local
 *     `isUpdating` lock
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` to resolve the current `module_ids`
 *
 * Side effects:
 *   - Mutation via `issueOperations.changeModulesInIssue(workspaceSlug, projectId, issueId,
 *     modulesToAdd, modulesToRemove)` — the contract routes this through the issue-detail store
 *     which calls `ModuleService.addModulesToIssue` / `removeModulesFromIssue` against `apps/api`.
 *   - No toast emissions here; the contract layer is responsible for user feedback.
 *
 * Derived state notes:
 *   - `updatedModuleIds = xor(issue.module_ids, moduleIds)` computes the symmetric difference of the
 *     existing and incoming module sets — this is then split into `modulesToAdd` and
 *     `modulesToRemove` by checking which side each diff entry came from. Using `xor` instead of two
 *     full-set comparisons keeps the payload minimal and lets the backend persist a single bulk update.
 *   - Early-exit guard: bails when `issue` is missing or `module_ids` is undefined.
 *   - `disableSelect = disabled || isUpdating` so the dropdown stays uninteractive during the mutation.
 */

import React, { useState } from "react";
import { xor } from "lodash-es";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// hooks
// components
import { cn } from "@plane/utils";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
// ui
// helpers
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TIssueOperations } from "./root";

type TIssueModuleSelect = {
  className?: string;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  disabled?: boolean;
};

export const IssueModuleSelect = observer(function IssueModuleSelect(props: TIssueModuleSelect) {
  const { className = "", workspaceSlug, projectId, issueId, issueOperations, disabled = false } = props;
  const { t } = useTranslation();
  // states
  const [isUpdating, setIsUpdating] = useState(false);
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  // derived values
  const issue = getIssueById(issueId);
  const disableSelect = disabled || isUpdating;

  const handleIssueModuleChange = async (moduleIds: string[]) => {
    if (!issue || !issue.module_ids) return;

    setIsUpdating(true);
    const updatedModuleIds = xor(issue.module_ids, moduleIds);
    const modulesToAdd: string[] = [];
    const modulesToRemove: string[] = [];

    for (const moduleId of updatedModuleIds) {
      if (issue.module_ids.includes(moduleId)) {
        modulesToRemove.push(moduleId);
      } else {
        modulesToAdd.push(moduleId);
      }
    }

    await issueOperations.changeModulesInIssue?.(workspaceSlug, projectId, issueId, modulesToAdd, modulesToRemove);

    setIsUpdating(false);
  };

  return (
    <div className={cn(`flex h-full items-center gap-1`, className)}>
      <ModuleDropdown
        projectId={projectId}
        value={issue?.module_ids ?? []}
        onChange={handleIssueModuleChange}
        placeholder={t("module.no_module")}
        disabled={disableSelect}
        className="group h-full w-full"
        buttonContainerClassName="w-full text-left rounded-sm"
        buttonClassName={`text-body-xs-medium justify-between ${issue?.module_ids?.length ? "" : "text-placeholder"}`}
        buttonVariant="transparent-with-text"
        hideIcon
        dropdownArrow
        dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
        multiple
        itemClassName="px-2"
      />
    </div>
  );
});
