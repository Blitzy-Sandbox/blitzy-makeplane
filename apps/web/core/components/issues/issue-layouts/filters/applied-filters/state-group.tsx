/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied state-group filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied state-group value in the issue
 * layout's applied-filters bar. State groups are the coarse categorization of issue lifecycle stages.
 * Each chip shows the group icon (`StateGroupIcon`) and the group key text.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the state-group string that
 *     should be removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { state_group: <next> })`.
 *   - `values` (`string[]`, required): currently-applied state-group strings — values from the
 *     `TStateGroups` union (`"backlog" | "unstarted" | "started" | "completed" | "cancelled"`).
 *
 * NOTE: unlike most chips in this folder, `AppliedStateGroupFilters` has NO `editable` prop — the
 * close button is always rendered. (State-group filter chips do not appear in read-only contexts.)
 *
 * MobX stores read: none — state group is an enum-backed filter (no entity resolution required). The
 * `observer` wrapper is retained for consistency with the rest of the applied-filter chips and to
 * preserve re-render behavior if the parent passes MobX-observable arrays.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(stateGroup)` on click.
 */

import { observer } from "mobx-react";

// icons
import { EIconSize } from "@plane/constants";
import { CloseIcon, StateGroupIcon } from "@plane/propel/icons";
import type { TStateGroups } from "@plane/types";

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
};

export const AppliedStateGroupFilters = observer(function AppliedStateGroupFilters(props: Props) {
  const { handleRemove, values } = props;

  return (
    <>
      {values.map((stateGroup) => (
        <div key={stateGroup} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
          <StateGroupIcon stateGroup={stateGroup as TStateGroups} size={EIconSize.SM} />
          {stateGroup}
          <button
            type="button"
            className="grid place-items-center text-tertiary hover:text-secondary"
            onClick={() => handleRemove(stateGroup)}
          >
            <CloseIcon height={10} width={10} strokeWidth={2} />
          </button>
        </div>
      ))}
    </>
  );
});
