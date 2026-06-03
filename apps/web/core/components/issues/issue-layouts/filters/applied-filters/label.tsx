/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied label filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied label ID in the issue layout's
 * applied-filters bar. Each chip shows the label's color swatch and name.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the label ID that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { labels: <next> })`.
 *   - `labels` (`IIssueLabel[] | undefined`, required): the full set of labels available in the current
 *     context (project- or workspace-scoped). Used to resolve `labelId → { name, color }`. Passed by the
 *     parent rather than read from a store so the same component can serve both project- and
 *     workspace-level label sets.
 *   - `values` (`string[]`, required): currently-applied label IDs.
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read: none directly — labels arrive via the `labels` prop. (The parent aggregator
 * resolves the appropriate label set, typically via `useLabel` or `useProjectLabel`, and forwards it.)
 * The component is still wrapped with `observer` from `mobx-react` because the label objects passed in
 * are MobX observables and may mutate (e.g., a label being renamed) after first render.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(labelId)` on click.
 */

import { observer } from "mobx-react";

// icons
import { CloseIcon } from "@plane/propel/icons";
import type { IIssueLabel } from "@plane/types";
// types

type Props = {
  handleRemove: (val: string) => void;
  labels: IIssueLabel[] | undefined;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedLabelsFilters = observer(function AppliedLabelsFilters(props: Props) {
  const { handleRemove, labels, values, editable } = props;

  return (
    <>
      {values.map((labelId) => {
        const labelDetails = labels?.find((l) => l.id === labelId);

        // Skip rendering when the label has not loaded yet OR has been deleted — prevents stale chip UI.
        if (!labelDetails) return null;

        return (
          <div key={labelId} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: labelDetails.color,
              }}
            />
            <span className="normal-case">{labelDetails.name}</span>
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(labelId)}
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
