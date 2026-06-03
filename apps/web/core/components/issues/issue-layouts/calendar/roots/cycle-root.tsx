/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-scoped calendar entry for the cycle context. Adapts the shared
 * BaseCalendarRoot to a specific cycle by sourcing the cycle id from the
 * route, wiring cycle-specific quick actions, freezing editing for completed
 * cycles, and forwarding the add-issue-to-cycle MobX action.
 *
 * Props: none — the component is driven entirely by useParams() and MobX stores.
 *
 * Route params consumed (next/navigation useParams):
 *   - workspaceSlug, projectId, cycleId — required for the addIssuesToView path;
 *     the component renders nothing when cycleId is absent.
 *
 * Stores read:
 *   - useCycle().currentProjectCompletedCycleIds — used to derive isCompletedCycle
 *     so BaseCalendarRoot can render the calendar in read-only mode.
 *   - useIssues(EIssuesStoreType.CYCLE).issues.addIssueToCycle — MobX action that
 *     internally POSTs via IssueService.addIssueToCycle (see
 *     apps/web/core/services/issue/issue.service.ts) and reconciles cycleId on
 *     the affected issues without an extra round-trip.
 *
 * Side effects:
 *   - addIssuesToView (memoized via useCallback) calls
 *     addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds); throws when
 *     any required identifier is missing.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/roots/cycle-layout-root.tsx
 *     — selects this component when the cycle issue layout is "calendar".
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssues } from "@/hooks/store/use-issues";
// components
import { CycleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseCalendarRoot } from "../base-calendar-root";

/** Cycle-scoped calendar layout: binds BaseCalendarRoot to the active cycle and gates editing for completed cycles. */
export const CycleCalendarLayout = observer(function CycleCalendarLayout() {
  const { currentProjectCompletedCycleIds } = useCycle();
  const { workspaceSlug, projectId, cycleId } = useParams();

  const {
    issues: { addIssueToCycle },
  } = useIssues(EIssuesStoreType.CYCLE);

  // Freezes editing when the active cycle has completed (forwarded to BaseCalendarRoot as readOnly).
  const isCompletedCycle =
    cycleId && currentProjectCompletedCycleIds ? currentProjectCompletedCycleIds.includes(cycleId.toString()) : false;

  const addIssuesToView = useCallback(
    (issueIds: string[]) => {
      if (!workspaceSlug || !projectId || !cycleId) throw new Error();
      return addIssueToCycle(workspaceSlug.toString(), projectId.toString(), cycleId.toString(), issueIds);
    },
    [addIssueToCycle, workspaceSlug, projectId, cycleId]
  );

  if (!cycleId) return null;

  return (
    <BaseCalendarRoot
      QuickActions={CycleIssueQuickActions}
      addIssuesToView={addIssuesToView}
      isCompletedCycle={isCompletedCycle}
      viewId={cycleId?.toString()}
    />
  );
});
