/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cycle estimate-type dropdown.
 *
 * Renders an interactive `CustomSelect` that lets the user toggle a cycle's
 * analytics/burndown view between "issues" (count-based) and "points"
 * (estimate-value-based). The control is only made interactive when the
 * project's estimate system supports point estimates and is not
 * `EEstimateSystem.CATEGORIES` — categorical estimates have no numeric
 * magnitude and therefore cannot be plotted on a burndown.
 *
 * Props (TProps):
 *   - `value` (`TCycleEstimateType`, required): currently selected estimate
 *     mode displayed in the trigger label.
 *   - `onChange` (`(value: TCycleEstimateType) => Promise<void>`, required):
 *     async callback fired when the user picks a new option. The parent owns
 *     the actual mutation (e.g., the cycle store's `setEstimateType` action)
 *     and any persistence side effect; this component does not write to any
 *     store directly.
 *   - `showDefault` (`boolean`, optional, default `false`): controls the
 *     fallback render when the interactive branch is suppressed.
 *     `true` shows a read-only capitalized `<span>` label; `false` renders
 *     `null` so the parent can omit the slot entirely without an empty shell.
 *   - `projectId` (`string`, required): project context used for the
 *     estimate-enablement lookup.
 *   - `cycleId` (`string`, required): cycle context used for the point-data
 *     availability lookup.
 *
 * MobX stores read (no writes):
 *   - `useCycle()` → `getIsPointsDataAvailable(cycleId)` — whether the cycle
 *     has any point-distribution data ingested.
 *   - `useProjectEstimates()` → `areEstimateEnabledByProjectId(projectId)`
 *     and `currentProjectEstimateType` — project-level estimate
 *     configuration.
 *
 * Side effects: none direct. The component is pure-render with respect to
 * MobX state and only invokes the `onChange` prop on user selection; the
 * parent (e.g., `apps/web/core/components/cycles/active-cycle/productivity.tsx`)
 * is responsible for the store mutation and any downstream API call that
 * persists the new estimate mode.
 *
 * Option labels are sourced from `cycleEstimateOptions` re-exported from
 * `../analytics-sidebar/issue-progress` — the single source of truth shared
 * with the analytics-sidebar progress card.
 *
 * Consumer:
 *   - `apps/web/core/components/cycles/active-cycle/productivity.tsx` (the
 *     burndown/productivity card uses this dropdown to switch between
 *     issues-based and points-based completion charts).
 */

import React from "react";
import { observer } from "mobx-react";
import type { TCycleEstimateType } from "@plane/types";
import { EEstimateSystem } from "@plane/types";
import { CustomSelect } from "@plane/ui";
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useCycle } from "@/hooks/store/use-cycle";
// local imports
import { cycleEstimateOptions } from "../analytics-sidebar/issue-progress";

type TProps = {
  value: TCycleEstimateType;
  onChange: (value: TCycleEstimateType) => Promise<void>;
  showDefault?: boolean;
  projectId: string;
  cycleId: string;
};

export const EstimateTypeDropdown = observer(function EstimateTypeDropdown(props: TProps) {
  const { value, onChange, projectId, cycleId, showDefault = false } = props;
  const { getIsPointsDataAvailable } = useCycle();
  const { areEstimateEnabledByProjectId, currentProjectEstimateType } = useProjectEstimates();
  const isCurrentProjectEstimateEnabled = projectId && areEstimateEnabledByProjectId(projectId) ? true : false;
  return (getIsPointsDataAvailable(cycleId) || isCurrentProjectEstimateEnabled) &&
    currentProjectEstimateType !== EEstimateSystem.CATEGORIES ? (
    <div className="relative flex items-center gap-2">
      <CustomSelect
        value={value}
        label={<span>{cycleEstimateOptions.find((v) => v.value === value)?.label ?? "None"}</span>}
        onChange={onChange}
        maxHeight="lg"
        buttonClassName="bg-surface-2 border-none rounded-sm text-13 font-medium "
      >
        {cycleEstimateOptions.map((item) => (
          <CustomSelect.Option key={item.value} value={item.value}>
            {item.label}
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    </div>
  ) : showDefault ? (
    <span className="capitalize">{cycleEstimateOptions.find((v) => v.value === value)?.label ?? value}</span>
  ) : null;
});
