/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle route adapter for the spreadsheet issue layout.
 *
 * Rendered purpose: reads `cycleId` from the route, determines whether the active cycle is
 * completed, derives a permission-aware editability callback, and forwards them plus
 * `CycleIssueQuickActions` into `<BaseSpreadsheetRoot>`. Returns `null` if no `cycleId` is present
 * in the route so the parent route can render its own empty / error state.
 *
 * Props: none — fully driven by route context and MobX stores.
 *
 * MobX stores read:
 *   - `useParams()` exposes the `cycleId` route param. The hook is imported from `next/navigation`,
 *     which Vite aliases to the in-repo React Router compatibility shim at
 *     `apps/web/app/compat/next/navigation.ts`; this resolves to React Router's `useParams`.
 *   - `useCycle()` exposes `currentProjectCompletedCycleIds` — the list of cycle ids that have
 *     reached the COMPLETED status for the current project; checked to decide whether the cycle is
 *     read-only
 *   - `useUserPermissions()` exposes `allowPermissions(roles, level)` — checked with
 *     `[ADMIN, MEMBER]` at `PROJECT` level to gate inline issue-property editing
 *
 * Side effects:
 *   - Forwards `<CycleIssueQuickActions>` (cycle-specific quick-action menu) into
 *     `<BaseSpreadsheetRoot>`; that component handles the actual remove / update / archive /
 *     remove-from-view mutations when the user invokes a quick action.
 *   - Passes `isCompletedCycle` and `canEditIssueProperties` into `<BaseSpreadsheetRoot>` which
 *     cascades the read-only state into every row + cell editor.
 *   - No direct API calls in this file.
 *
 * Derived state (the WHY for non-obvious computations):
 *   - `isCompletedCycle`: true when both `cycleId` and `currentProjectCompletedCycleIds` are
 *     present AND `cycleId` is in the completed list. The defensive coalescing to `false` (rather
 *     than undefined) ensures the downstream `<BaseSpreadsheetRoot>` always sees a deterministic
 *     boolean regardless of hydration ordering.
 *   - `canEditIssueProperties`: combines two gates — the cycle must NOT be completed AND the user
 *     must hold ADMIN or MEMBER permission at the PROJECT level. Memoised via `useCallback` keyed
 *     on both inputs so referential identity is stable across renders (downstream `useMemo`s
 *     compare by reference). This is the WHY for the dual-gate: completed cycles are read-only
 *     even for admins, and non-admin/member users are read-only even for active cycles.
 *
 * Consumers:
 *   - `apps/web/app/.../cycles/[cycleId]/page.tsx` — the cycle route mounts this directly
 *     when the cycle's selected layout is `EIssueLayoutTypes.SPREADSHEET`.
 */

import React, { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// hooks
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useCycle } from "@/hooks/store/use-cycle";
import { useUserPermissions } from "@/hooks/store/user";
// components
import { CycleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseSpreadsheetRoot } from "../base-spreadsheet-root";

/** Cycle spreadsheet route adapter; see the module-level JSDoc for full semantics. */
export const CycleSpreadsheetLayout = observer(function CycleSpreadsheetLayout() {
  // router
  const { cycleId } = useParams();
  // store hooks
  const { currentProjectCompletedCycleIds } = useCycle();
  const { allowPermissions } = useUserPermissions();
  // auth
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

  if (!cycleId) return null;

  return (
    <BaseSpreadsheetRoot
      QuickActions={CycleIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditIssueProperties}
      isCompletedCycle={isCompletedCycle}
      viewId={cycleId.toString()}
    />
  );
});
