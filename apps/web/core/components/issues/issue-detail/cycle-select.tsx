/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle assignment selector for the issue detail sidebar.
 *
 * Rendered purpose: a single-select `CycleDropdown` (variant `transparent-with-text`) that shows the
 * work item's current cycle and lets the user assign/clear it. Disables itself during in-flight
 * updates to prevent double-submission.
 *
 * Props (TIssueCycleSelect):
 *   - className (string, optional, default=""): wrapper class overrides
 *   - workspaceSlug (string, required): scopes the cycle mutation
 *   - projectId (string, required): scopes the cycle mutation and bounds the dropdown options
 *   - issueId (string, required): the work item being assigned
 *   - issueOperations (TIssueOperations, required): the issue-update contract exposed from `./root`
 *     — specifically the optional `addCycleToIssue` and `removeIssueFromCycle` methods
 *   - disabled (boolean, optional, default=false): disables both the dropdown and the local
 *     `isUpdating` lock (the dropdown becomes uninteractive when either is true)
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` to resolve the current `cycle_id`
 *
 * Side effects:
 *   - Mutations via the `issueOperations` contract:
 *       - `addCycleToIssue(workspaceSlug, projectId, cycleId, issueId)` when a non-null cycle is picked
 *       - `removeIssueFromCycle(workspaceSlug, projectId, issue.cycle_id ?? "", issueId)` when cleared
 *   - These contract methods in turn route through the issue-detail store (which calls
 *     `CycleService.addCycleToIssue` / `removeIssueFromCycle` against `apps/api`).
 *   - Toast emissions are handled INSIDE the `issueOperations` contract in `root.tsx`, not here.
 *
 * Derived state notes:
 *   - Early-exit guard: skips the mutation when the cycle id is unchanged (`issue.cycle_id === cycleId`).
 *   - `disableSelect = disabled || isUpdating` so the dropdown stays uninteractive between optimistic
 *     UI submission and the mutation resolving.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// hooks
// components
import { cn } from "@plane/utils";
import { CycleDropdown } from "@/components/dropdowns/cycle";
// ui
// helpers
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TIssueOperations } from "./root";

type TIssueCycleSelect = {
  className?: string;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  disabled?: boolean;
};

export const IssueCycleSelect = observer(function IssueCycleSelect(props: TIssueCycleSelect) {
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

  const handleIssueCycleChange = async (cycleId: string | null) => {
    if (!issue || issue.cycle_id === cycleId) return;
    setIsUpdating(true);
    if (cycleId) await issueOperations.addCycleToIssue?.(workspaceSlug, projectId, cycleId, issueId);
    else await issueOperations.removeIssueFromCycle?.(workspaceSlug, projectId, issue.cycle_id ?? "", issueId);
    setIsUpdating(false);
  };

  return (
    <div className={cn("flex h-full items-center gap-1", className)}>
      <CycleDropdown
        value={issue?.cycle_id ?? null}
        onChange={handleIssueCycleChange}
        projectId={projectId}
        disabled={disableSelect}
        buttonVariant="transparent-with-text"
        className="group w-full"
        buttonContainerClassName="w-full text-left h-7.5 rounded-sm"
        buttonClassName={`text-body-xs-medium justify-between ${issue?.cycle_id ? "" : "text-placeholder"}`}
        placeholder={t("cycle.no_cycle")}
        hideIcon
        dropdownArrow
        dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
      />
    </div>
  );
});
