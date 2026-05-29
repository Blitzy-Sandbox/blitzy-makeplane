/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed progress card for the active cycle screen — renders a segmented linear
 * progress indicator (backlog / unstarted / started / completed) sourced from
 * PROGRESS_STATE_GROUPS_DETAILS, a closed-vs-total work-item summary chip, per-group
 * clickable rows that push a `state_group` filter back to the parent, and a footer note
 * when the cycle has cancelled work items. Falls back to a themed empty state when the
 * cycle has no issues and to a Loader skeleton until the cycle's `started_issues` field
 * has been populated.
 *
 * Props (ActiveCycleProgressProps):
 *   - cycle (ICycle | null, required): the active cycle whose `total_issues`,
 *     `completed_issues`, `started_issues`, `unstarted_issues`, `backlog_issues`, and
 *     `cancelled_issues` counts drive the indicator and summary copy.
 *   - workspaceSlug (string, required): present in the props contract but not directly
 *     used inside this card — reserved for forward-compatibility with row-click filter
 *     routing handled by the parent via `handleFiltersUpdate`.
 *   - projectId (string, required): present in the props contract; same reservation as
 *     workspaceSlug.
 *   - handleFiltersUpdate ((conditions: TWorkItemFilterCondition[]) => void, required):
 *     callback used to push a `state_group` filter into the cycle-scoped issue filter
 *     store when the user clicks a non-zero state-group row; typically supplied by
 *     `useCyclesDetails`.
 *
 * MobX stores read:
 *   - None directly on a Plane store. The component is wrapped in `observer` so reads
 *     of the observable `cycle` prop (forwarded from the cycle store upstream) trigger
 *     re-renders.
 *   - useTheme (next-themes): `resolvedTheme` selects the light/dark empty-state webp.
 *   - useTranslation (@plane/i18n): `t` resolves the section heading and empty-state
 *     title.
 *
 * Side effects:
 *   - Mutations: handleFiltersUpdate([{ property: "state_group", operator: "in",
 *     value: [group] }]) on a row click for any non-zero state group ("completed",
 *     "started", "unstarted", "backlog"). Cancelled-issue rows are display-only.
 *   - No direct API calls, no navigations, no toasts — this card is purely presentational
 *     over the cycle prop and delegates filter routing to the caller.
 *
 * Conditional rendering:
 *   - Renders the populated card only when `cycle` is non-null AND has its
 *     `started_issues` field defined (i.e., the active-cycle progress fetch has resolved).
 *   - Inside the populated card, renders the per-group rows + chart ONLY when
 *     `cycle.total_issues > 0`; otherwise falls back to a SimpleEmptyState.
 *   - Falls back to a Loader skeleton whenever cycle is null or `started_issues` is not
 *     yet defined on the cycle object.
 *
 * Consumers: the active cycle detail experience under apps/web/app/[workspaceSlug]/projects/
 * [projectId]/cycles/(detail)/[cycleId]/active-cycle.
 */

import { observer } from "mobx-react";
import { useTheme } from "next-themes";
// plane imports
import { PROGRESS_STATE_GROUPS_DETAILS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkItemFilterCondition } from "@plane/shared-state";
import type { ICycle } from "@plane/types";
import { LinearProgressIndicator, Loader } from "@plane/ui";
// assets
import darkProgressAsset from "@/app/assets/empty-state/active-cycle/progress-dark.webp?url";
import lightProgressAsset from "@/app/assets/empty-state/active-cycle/progress-light.webp?url";
// components
import { SimpleEmptyState } from "@/components/empty-state/simple-empty-state-root";

export type ActiveCycleProgressProps = {
  cycle: ICycle | null;
  workspaceSlug: string;
  projectId: string;
  handleFiltersUpdate: (conditions: TWorkItemFilterCondition[]) => void;
};

export const ActiveCycleProgress = observer(function ActiveCycleProgress(props: ActiveCycleProgressProps) {
  const { handleFiltersUpdate, cycle } = props;
  // theme hook
  const { resolvedTheme } = useTheme();
  // plane hooks
  const { t } = useTranslation();
  // derived values
  const progressIndicatorData = PROGRESS_STATE_GROUPS_DETAILS.map((group, index) => ({
    id: index,
    name: group.title,
    value: cycle && cycle.total_issues > 0 ? (cycle[group.key as keyof ICycle] as number) : 0,
    color: group.color,
  }));
  const groupedIssues: any = cycle
    ? {
        completed: cycle?.completed_issues,
        started: cycle?.started_issues,
        unstarted: cycle?.unstarted_issues,
        backlog: cycle?.backlog_issues,
      }
    : {};
  const resolvedPath = resolvedTheme === "light" ? lightProgressAsset : darkProgressAsset;

  return cycle && cycle.hasOwnProperty("started_issues") ? (
    <div className="flex min-h-[17rem] flex-col gap-5 rounded-lg border border-subtle bg-surface-1 px-3.5 py-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-14 font-semibold text-tertiary">{t("project_cycles.active_cycle.progress")}</h3>
          {cycle.total_issues > 0 && (
            <span className="flex gap-1 rounded-xs px-3 py-1 text-13 font-medium whitespace-nowrap text-placeholder">
              {`${cycle.completed_issues + cycle.cancelled_issues}/${cycle.total_issues - cycle.cancelled_issues} ${
                cycle.completed_issues + cycle.cancelled_issues > 1 ? "Work items" : "Work item"
              } closed`}
            </span>
          )}
        </div>
        {cycle.total_issues > 0 && <LinearProgressIndicator size="lg" data={progressIndicatorData} />}
      </div>

      {cycle.total_issues > 0 ? (
        <div className="flex flex-col gap-5">
          {Object.keys(groupedIssues).map((group, index) => (
            <>
              {groupedIssues[group] > 0 && (
                <div key={index}>
                  <div
                    className="flex cursor-pointer items-center justify-between gap-2 text-13"
                    onClick={() => {
                      handleFiltersUpdate([{ property: "state_group", operator: "in", value: [group] }]);
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="block h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: PROGRESS_STATE_GROUPS_DETAILS[index].color,
                        }}
                      />
                      <span className="w-16 font-medium text-tertiary capitalize">{group}</span>
                    </div>
                    <span className="text-tertiary">{`${groupedIssues[group]} ${
                      groupedIssues[group] > 1 ? "Work items" : "Work item"
                    }`}</span>
                  </div>
                </div>
              )}
            </>
          ))}
          {cycle.cancelled_issues > 0 && (
            <span className="flex items-center gap-2 text-13 text-tertiary">
              <span>
                {`${cycle.cancelled_issues} cancelled ${
                  cycle.cancelled_issues > 1 ? "work items are" : "work item is"
                } excluded from this report.`}{" "}
              </span>
            </span>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <SimpleEmptyState title={t("active_cycle.empty_state.progress.title")} assetPath={resolvedPath} />
        </div>
      )}
    </div>
  ) : (
    <Loader className="flex min-h-[17rem] flex-col gap-5 rounded-lg border border-subtle bg-surface-1">
      <Loader.Item width="100%" height="100%" />
    </Loader>
  );
});
