/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle-scope Kanban issue board root.
 *
 * Rendered purpose:
 *   Route-aware wrapper that binds cycle-issue store mutations, completed-cycle
 *   read-only enforcement, and PROJECT-level permission gating into the shared
 *   `BaseKanBanRoot` for cycle-scope issue boards.
 *
 * Props:
 *   None — all inputs are derived from route params via `useParams` (from
 *   `next/navigation`): `workspaceSlug`, `projectId`, `cycleId`.
 *
 * MobX stores read:
 *   - `useIssues(EIssuesStoreType.CYCLE)` — exposes the cycle issues store
 *     whose `addIssueToCycle` mutator is wired into the add-to-view callback.
 *   - `useCycle()` — exposes `currentProjectCompletedCycleIds`, used to detect
 *     read-only completed cycles.
 *   - `useUserPermissions()` — exposes `allowPermissions` for ADMIN/MEMBER
 *     PROJECT-scope gating.
 *
 * Side effects:
 *   - `addIssuesToView(issueIds: string[])` — memoized via `useCallback`. Calls
 *     `issues.addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds)` to
 *     attach existing issues to the active cycle (PATCH to apps/api). Throws
 *     when any required route param is missing.
 *
 * Permission gating:
 *   - `isCompletedCycle` derives from
 *     `currentProjectCompletedCycleIds.includes(cycleId)`; disables editing for
 *     completed cycles regardless of role.
 *   - `canEditIssueProperties` (memoized via `useCallback`) returns
 *     `!isCompletedCycle && isEditingAllowed` where `isEditingAllowed` is
 *     `allowPermissions([ADMIN, MEMBER], PROJECT)`; forwarded as the
 *     `canEditPropertiesBasedOnProject` prop to `BaseKanBanRoot`.
 *   - `isCompletedCycle` is also forwarded as a prop so downstream components
 *     can render read-only affordances.
 *
 * Consumers:
 *   Mounted by the cycle-issues page route in `apps/web/app/**` whenever the
 *   user selects the Kanban layout for a cycle.
 */

import React, { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { CycleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseKanBanRoot } from "../base-kanban-root";

/**
 * Cycle-scope Kanban board root — see module-level JSDoc for the full contract
 * (stores read, add-to-cycle side effect, completed-cycle and PROJECT-level
 * permission gating).
 */
export const CycleKanBanLayout = observer(function CycleKanBanLayout() {
  const { workspaceSlug, projectId, cycleId } = useParams();

  // store
  const { issues } = useIssues(EIssuesStoreType.CYCLE);
  const { currentProjectCompletedCycleIds } = useCycle();
  const { allowPermissions } = useUserPermissions();

  const isCompletedCycle =
    cycleId && currentProjectCompletedCycleIds ? currentProjectCompletedCycleIds.includes(cycleId.toString()) : false;
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const canEditIssueProperties = useCallback(
    () => !isCompletedCycle && isEditingAllowed,
    [isCompletedCycle, isEditingAllowed]
  );

  const addIssuesToView = useCallback(
    (issueIds: string[]) => {
      if (!workspaceSlug || !projectId || !cycleId) throw new Error();
      return issues.addIssueToCycle(workspaceSlug.toString(), projectId.toString(), cycleId.toString(), issueIds);
    },
    [issues?.addIssueToCycle, workspaceSlug, projectId, cycleId]
  );

  return (
    <BaseKanBanRoot
      QuickActions={CycleIssueQuickActions}
      addIssuesToView={addIssuesToView}
      canEditPropertiesBasedOnProject={canEditIssueProperties}
      isCompletedCycle={isCompletedCycle}
      viewId={cycleId?.toString()}
    />
  );
});
