/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied priority filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied priority value in the issue
 * layout's applied-filters bar. Each chip shows the priority icon (`PriorityIcon`) and the priority
 * string literal.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the priority string that should
 *     be removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { priority: <next> })`.
 *   - `values` (`string[]`, required): currently-applied priority strings — values from the
 *     `TIssuePriorities` union (`"urgent" | "high" | "medium" | "low" | "none"`).
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read: none — priority is an enum-backed filter (no entity resolution required). The
 * `observer` wrapper is retained for consistency with the rest of the applied-filter chips and to
 * preserve re-render behavior if the parent passes MobX-observable arrays.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(priority)` on click.
 */

import { observer } from "mobx-react";

// icons
import { CloseIcon, PriorityIcon } from "@plane/propel/icons";
import type { TIssuePriorities } from "@plane/types";
// types

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedPriorityFilters = observer(function AppliedPriorityFilters(props: Props) {
  const { handleRemove, values, editable } = props;

  return (
    <>
      {values.map((priority) => (
        <div key={priority} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
          <PriorityIcon priority={priority as TIssuePriorities} className={`h-3 w-3`} />
          {priority}
          {editable && (
            <button
              type="button"
              className="grid place-items-center text-tertiary hover:text-secondary"
              onClick={() => handleRemove(priority)}
            >
              <CloseIcon height={10} width={10} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
    </>
  );
});
