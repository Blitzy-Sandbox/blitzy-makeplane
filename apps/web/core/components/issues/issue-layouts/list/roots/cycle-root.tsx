/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `CycleListLayout` route root for the cycle-scoped issue list.
 *
 * Rendered purpose: cycle-scoped issue list entry point with two notable
 * behaviors beyond the standard scoped-root pattern: (1) completed-cycle
 * detection that locks editing for any cycle in the project's completed
 * set, and (2) a cycle-specific `addIssuesToView` mutation that calls
 * `issues.addIssueToCycle` to bulk-attach existing issues to the active
 * cycle.
 *
 * Props: none — route context is read via `useParams()`.
 *
 * MobX stores read directly:
 *   - `useIssues(EIssuesStoreType.CYCLE)` → `issues.addIssueToCycle` for
 *     the cycle-scope bulk-attach mutation.
 *   - `useCycle()` → `currentProjectCompletedCycleIds` — the completed-cycle
 *     set used to compute the read-only edit lock.
 *   - `useUserPermissions()` → `allowPermissions` for workspace-level
 *     ADMIN/MEMBER authorization at `EUserPermissionsLevel.PROJECT`.
 *
 * Side effects:
 *   - Reads `workspaceSlug`, `projectId`, and `cycleId` from `useParams()` — imported from
 *     `next/navigation`, which Vite aliases to the in-repo React Router compatibility shim at
 *     `apps/web/app/compat/next/navigation.ts`; this resolves to React Router's `useParams`.
 *   - `addIssuesToView(issueIds)` (memoized via `useCallback`) calls
 *     `issues.addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds)`
 *     — fires an API call to `apps/api` to persist the membership.
 *     Throws `Error` if any route parameter is missing (fail-loud design).
 *
 * Derived state:
 *   - `isCompletedCycle` — `true` when the active `cycleId` is present in
 *     `currentProjectCompletedCycleIds`; reactive to the MobX cycle store.
 *   - `isEditingAllowed` — workspace-level ADMIN/MEMBER permission check at
 *     `EUserPermissionsLevel.PROJECT`.
 *   - `canEditIssueProperties` — memoized via `useCallback`; AND-combines
 *     the completed-cycle lock with the workspace permission check so
 *     editing is disabled on completed cycles regardless of role. The
 *     dependency array `[isCompletedCycle, isEditingAllowed]` ensures the
 *     callback identity is stable across re-renders that do not change
 *     either flag.
 *
 * Quick actions: `CycleIssueQuickActions` (cycle-scope menu — includes
 * remove-from-cycle and transfer-to-next-cycle in addition to project-scope
 * actions).
 *
 * Architectural notes:
 *   - Per AAP §0.2.2, MobX stores are the source of truth for component
 *     behavior — both the completed-cycle set and the issue mutations
 *     flow through MobX rather than direct API calls or React state.
 *   - The `isCompletedCycle` flag is also forwarded to `BaseListRoot` as a
 *     prop so downstream layouts can render the read-only banner.
 */

import React, { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// types
import { CycleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the cycle-scoped issue list layout — combines the
 * completed-cycle read-only lock (from `useCycle().currentProjectCompletedCycleIds`)
 * with the standard workspace-level ADMIN/MEMBER edit gate, memoizes a
 * cycle-specific add-to-cycle mutation, and forwards `isCompletedCycle` plus
 * the active `cycleId` to `BaseListRoot`. Wrapped in MobX `observer`.
 */
export const CycleListLayout = observer(function CycleListLayout() {
  const { workspaceSlug, projectId, cycleId } = useParams();
  // store
  const { issues } = useIssues(EIssuesStoreType.CYCLE);
  const { currentProjectCompletedCycleIds } = useCycle(); // mobx store
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
    <BaseListRoot
      QuickActions={CycleIssueQuickActions}
      addIssuesToView={addIssuesToView}
      canEditPropertiesBasedOnProject={canEditIssueProperties}
      isCompletedCycle={isCompletedCycle}
      viewId={cycleId?.toString()}
    />
  );
});
