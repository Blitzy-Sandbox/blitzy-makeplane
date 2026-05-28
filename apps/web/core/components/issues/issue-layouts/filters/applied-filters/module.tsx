/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied module filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied module ID in the issue layout's
 * applied-filters bar. Each chip shows the module's icon (`ModuleIcon`) and name (truncated when the
 * name overflows the chip width).
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the module ID that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { module: <next> })`.
 *   - `values` (`string[]`, required): currently-applied module IDs.
 *   - `editable` (`boolean | undefined`, required): when truthy, renders the close button; when
 *     falsy/undefined, the chip is read-only (used in read-only views such as archived issues or
 *     shared spaces).
 *
 * MobX stores read:
 *   - `useModule().getModuleById(moduleId)` → resolves `IModule` for the module name. Wrapped with
 *     `observer` from `mobx-react` so re-renders react to module-map mutations (e.g., module rename).
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(moduleId)` on click.
 */

import { observer } from "mobx-react";
// hooks
import { CloseIcon, ModuleIcon } from "@plane/propel/icons";
import { useModule } from "@/hooks/store/use-module";
// ui

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedModuleFilters = observer(function AppliedModuleFilters(props: Props) {
  const { handleRemove, values, editable } = props;
  // store hooks
  const { getModuleById } = useModule();

  return (
    <>
      {values.map((moduleId) => {
        const moduleDetails = getModuleById(moduleId) ?? null;

        // Skip rendering when the module has not loaded yet OR has been deleted — prevents stale chip UI.
        if (!moduleDetails) return null;

        return (
          <div key={moduleId} className="flex items-center gap-1 truncate rounded-sm bg-layer-1 p-1 text-11">
            <ModuleIcon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate normal-case">{moduleDetails.name}</span>
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(moduleId)}
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
