/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied state filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied state ID in the issue layout's
 * applied-filters bar. Each chip shows the state's group icon (`StateGroupIcon` colored by the state's
 * configured color and ordered by `state.order`) and the state name.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the state ID that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { state: <next> })`.
 *   - `states` (`IState[]`, required): the full set of states available in the current project. Used to
 *     resolve `stateId → IState` for color, group, order, and name. Passed by the parent rather than
 *     read from a store so the parent can select the right project's state collection.
 *   - `values` (`string[]`, required): currently-applied state IDs.
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read: none directly — states arrive via the `states` prop. (The parent aggregator
 * resolves the appropriate state set, typically via `useProjectState`, and forwards it.) The
 * component is still wrapped with `observer` from `mobx-react` because the `IState` objects passed in
 * are MobX observables and may mutate (e.g., a state being renamed or recolored) after first render.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(stateId)` on click.
 */

import { observer } from "mobx-react";
// icons
// plane imports
import { EIconSize } from "@plane/constants";
import { CloseIcon, StateGroupIcon } from "@plane/propel/icons";
import type { IState } from "@plane/types";

type Props = {
  handleRemove: (val: string) => void;
  states: IState[];
  values: string[];
  editable: boolean | undefined;
};

export const AppliedStateFilters = observer(function AppliedStateFilters(props: Props) {
  const { handleRemove, states, values, editable } = props;

  return (
    <>
      {values.map((stateId) => {
        const stateDetails = states?.find((s) => s.id === stateId);

        // Skip rendering when the state has not loaded yet OR has been deleted — prevents stale chip UI.
        if (!stateDetails) return null;

        return (
          <div key={stateId} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
            <StateGroupIcon
              color={stateDetails.color}
              stateGroup={stateDetails.group}
              size={EIconSize.SM}
              percentage={stateDetails?.order}
            />
            {stateDetails.name}
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(stateId)}
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
