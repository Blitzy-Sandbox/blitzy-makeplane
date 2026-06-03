/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied cycle filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied cycle ID in the issue layout's
 * applied-filters bar. Each chip shows the cycle's status icon (via `CycleGroupIcon`) and name.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the cycle ID that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { cycle: <next> })`.
 *   - `values` (`string[]`, required): currently-applied cycle IDs.
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read:
 *   - `useCycle().getCycleById(cycleId)` → resolves `ICycle` for name + status. Wrapped with `observer`
 *     from `mobx-react` so re-renders react to cycle map mutations.
 *
 * Derived state (inline):
 *   - `cycleStatus`: defaults to `"draft"` when the resolved cycle has no `status`; otherwise lowercases
 *     the status for `CycleGroupIcon`'s `TCycleGroups` union.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(cycleId)` on click.
 */

import { observer } from "mobx-react";
import { CloseIcon, CycleGroupIcon } from "@plane/propel/icons";
import type { TCycleGroups } from "@plane/types";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
// ui
// types

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedCycleFilters = observer(function AppliedCycleFilters(props: Props) {
  const { handleRemove, values, editable } = props;
  // store hooks
  const { getCycleById } = useCycle();

  return (
    <>
      {values.map((cycleId) => {
        const cycleDetails = getCycleById(cycleId) ?? null;

        // Skip rendering when the cycle has not loaded yet OR has been deleted — prevents stale chip UI.
        if (!cycleDetails) return null;

        const cycleStatus = (cycleDetails?.status ? cycleDetails?.status.toLocaleLowerCase() : "draft") as TCycleGroups;

        return (
          <div key={cycleId} className="flex items-center gap-1 truncate rounded-sm bg-layer-1 p-1 text-11">
            <CycleGroupIcon cycleGroup={cycleStatus} className="h-3 w-3 flex-shrink-0" />
            <span className="truncate normal-case">{cycleDetails.name}</span>
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(cycleId)}
              >
                <CloseIcon height={10} width={10} strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
});
