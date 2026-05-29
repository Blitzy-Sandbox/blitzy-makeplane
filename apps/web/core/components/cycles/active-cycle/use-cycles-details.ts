/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom hook module that coordinates data fetching and filter-routing for the active
 * cycle detail experience. Centralizes the SWR fetch wiring (cycle progress, work-item
 * vs. estimate-points duration analytics, paginated priority-issue list) and exposes a
 * single `handleFiltersUpdate` callback that converts filter-condition arrays into
 * cycle-scoped store mutations plus a router push back to the canonical cycle URL.
 *
 * Architectural context (AAP §0.2.2):
 *   - MobX exclusively: stores accessed via React context through Plane hook wrappers,
 *     never Redux.
 *   - Service layer: SWR fetcher functions delegate to MobX store actions, which in
 *     turn call CycleService and IssueService (HTTP clients targeting apps/api).
 *   - The `useRouter` hook is imported from `next/navigation`; the underlying router
 *     stack is React Router v7 + Vite per AAP §0.2.6 C3 — the import MUST be preserved
 *     as-is.
 *
 * Consumers: progress.tsx, productivity.tsx, and cycle-stats.tsx in this folder
 * compose the hook's return value with their own props.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
// plane imports
import type { TWorkItemFilterCondition } from "@plane/shared-state";
import { EIssuesStoreType } from "@plane/types";
// constants
import { CYCLE_ISSUES_WITH_PARAMS } from "@/constants/fetch-keys";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssues } from "@/hooks/store/use-issues";
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";

interface IActiveCycleDetails {
  workspaceSlug: string;
  projectId: string;
  cycleId: string | null | undefined;
}

/**
 * Resolves the active cycle, triggers the four SWR fetchers it depends on, and returns
 * a stable bundle of cycle data, router handle, paginated issue details, and a
 * memoized filter-update callback for the active cycle detail experience.
 *
 * Inputs (IActiveCycleDetails):
 *   - workspaceSlug (string, required): workspace slug used for every fetch and for
 *     the post-filter router push target.
 *   - projectId (string, required): project ID used for every fetch and for the
 *     post-filter router push target.
 *   - cycleId (string | null | undefined, required): the active cycle ID; when falsy
 *     all SWR keys evaluate to null and no fetches fire.
 *
 * Return value:
 *   - cycle (ICycle | null): the resolved cycle from `useCycle().getCycleById(cycleId)`,
 *     null when cycleId is falsy.
 *   - cycleId (string | null | undefined): echoed straight from props for convenience.
 *   - router (ReturnType<typeof useRouter>): the next/navigation router handle so
 *     consumers can compose additional navigations without re-importing.
 *   - handleFiltersUpdate (async (conditions: TWorkItemFilterCondition[]) => void):
 *     memoized callback that mutates the cycle's filter expression and routes back to
 *     `/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`.
 *   - cycleIssueDetails (ActiveCycleIssueDetails | { nextPageResults: false }): the
 *     paginated issue payload from the cycle issues store; falls back to a sentinel
 *     `{ nextPageResults: false }` object when cycle.id is missing so downstream
 *     components can rely on its shape without null-guarding.
 *
 * SWR keys (all keyed off `workspaceSlug && projectId && cycle?.id`):
 *   - `PROJECT_ACTIVE_CYCLE_${projectId}_PROGRESS_${cycle.id}` → fetchActiveCycleProgress;
 *     options `{ revalidateIfStale: false, revalidateOnFocus: false }` keep the
 *     progress data cached for the session.
 *   - `PROJECT_ACTIVE_CYCLE_${projectId}_DURATION_${cycle.id}` → fetchActiveCycleAnalytics
 *     with mode `"issues"`; gated on `!cycle?.distribution` so the call is skipped once
 *     the distribution slice is already hydrated.
 *   - `PROJECT_ACTIVE_CYCLE_${projectId}_ESTIMATE_DURATION_${cycle.id}` →
 *     fetchActiveCycleAnalytics with mode `"points"`; gated on
 *     `!cycle?.estimate_distribution` for the same reason.
 *   - `CYCLE_ISSUES_WITH_PARAMS(cycle.id, { priority: "urgent,high" })` →
 *     fetchActiveCycleIssues(workspaceSlug, projectId, 30, cycle.id) returning the
 *     first 30 urgent/high priority work items for the priority tab; options
 *     `{ revalidateIfStale: false, revalidateOnFocus: false }`.
 *
 * MobX stores read:
 *   - useIssues(EIssuesStoreType.CYCLE): destructures `issuesFilter.updateFilterExpression`
 *     (bound inside handleFiltersUpdate), `issues.getActiveCycleById` (used to derive
 *     cycleIssueDetails), and `issues.fetchActiveCycleIssues` (the priority-list fetcher).
 *   - useWorkItemFilters: destructures `updateFilterExpressionFromConditions` — the
 *     adapter that turns `TWorkItemFilterCondition[]` into the cycle store's filter
 *     expression shape before applying it via the bound `updateFilterExpression`.
 *   - useCycle: destructures `fetchActiveCycleProgress`, `getCycleById`,
 *     `fetchActiveCycleAnalytics`.
 *
 * Side effects inside handleFiltersUpdate:
 *   - Mutation: updateFilterExpressionFromConditions(EIssuesStoreType.CYCLE, cycleId,
 *     conditions, updateFilterExpression.bind(updateFilterExpression, workspaceSlug,
 *     projectId, cycleId)) — async, awaits the store-side filter update + API persist.
 *   - Navigation: router.push(`/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`)
 *     immediately after the filter mutation resolves, routing the user back to the
 *     canonical cycle URL even if they navigated to active-cycle from elsewhere.
 *   - Early-return guard when any of workspaceSlug / projectId / cycleId is falsy.
 *
 * Notes:
 *   - The hook returns a `cycle` derived value on every render; when cycleId is falsy
 *     it is `null` (NOT undefined) so consumers can rely on a strict null check.
 *   - `default export` shape is preserved — consumers import as default.
 */
const useCyclesDetails = (props: IActiveCycleDetails) => {
  // props
  const { workspaceSlug, projectId, cycleId } = props;
  // router
  const router = useRouter();
  // store hooks
  const {
    issuesFilter: { updateFilterExpression },
    issues: { getActiveCycleById: getActiveCycleByIdFromIssue, fetchActiveCycleIssues },
  } = useIssues(EIssuesStoreType.CYCLE);
  const { updateFilterExpressionFromConditions } = useWorkItemFilters();

  const { fetchActiveCycleProgress, getCycleById, fetchActiveCycleAnalytics } = useCycle();
  // derived values
  const cycle = cycleId ? getCycleById(cycleId) : null;

  // fetch cycle details
  useSWR(
    workspaceSlug && projectId && cycle?.id ? `PROJECT_ACTIVE_CYCLE_${projectId}_PROGRESS_${cycle.id}` : null,
    workspaceSlug && projectId && cycle?.id ? () => fetchActiveCycleProgress(workspaceSlug, projectId, cycle.id) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );
  useSWR(
    workspaceSlug && projectId && cycle?.id && !cycle?.distribution
      ? `PROJECT_ACTIVE_CYCLE_${projectId}_DURATION_${cycle.id}`
      : null,
    workspaceSlug && projectId && cycle?.id && !cycle?.distribution
      ? () => fetchActiveCycleAnalytics(workspaceSlug, projectId, cycle.id, "issues")
      : null
  );
  useSWR(
    workspaceSlug && projectId && cycle?.id && !cycle?.estimate_distribution
      ? `PROJECT_ACTIVE_CYCLE_${projectId}_ESTIMATE_DURATION_${cycle.id}`
      : null,
    workspaceSlug && projectId && cycle?.id && !cycle?.estimate_distribution
      ? () => fetchActiveCycleAnalytics(workspaceSlug, projectId, cycle.id, "points")
      : null
  );
  useSWR(
    workspaceSlug && projectId && cycle?.id ? CYCLE_ISSUES_WITH_PARAMS(cycle?.id, { priority: "urgent,high" }) : null,
    workspaceSlug && projectId && cycle?.id
      ? () => fetchActiveCycleIssues(workspaceSlug, projectId, 30, cycle?.id)
      : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const cycleIssueDetails = cycle?.id ? getActiveCycleByIdFromIssue(cycle?.id) : { nextPageResults: false };

  const handleFiltersUpdate = useCallback(
    async (conditions: TWorkItemFilterCondition[]) => {
      if (!workspaceSlug || !projectId || !cycleId) return;

      await updateFilterExpressionFromConditions(
        EIssuesStoreType.CYCLE,
        cycleId,
        conditions,
        updateFilterExpression.bind(updateFilterExpression, workspaceSlug, projectId, cycleId)
      );

      router.push(`/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`);
    },
    [workspaceSlug, projectId, cycleId, updateFilterExpressionFromConditions, updateFilterExpression, router]
  );
  return {
    cycle,
    cycleId,
    router,
    handleFiltersUpdate,
    cycleIssueDetails,
  };
};
export default useCyclesDetails;
