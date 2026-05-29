/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed route shell for the project archived-cycles page; reads workspace
 * and project slugs from the route, lazily fetches archived cycles via SWR, and
 * selects between a loader, an empty-state, or the `ArchivedCyclesView` list view
 * with an applied-filters strip above it.
 *
 * Props: NONE — workspace and project context are pulled from `useParams()` rather
 * than passed in. This component is rendered as a sibling of `ArchivedCyclesHeader`
 * by the page route (`apps/web/app/.../archives/cycles/page.tsx`).
 *
 * MobX stores read:
 *   - useCycle (cycle store): `fetchArchivedCycles` action, `currentProjectArchivedCycleIds`
 *     observable, and the boolean `loader` flag.
 *   - useCycleFilter (cycle filter store): `clearAllFilters` and `updateFilters`
 *     actions plus the `currentProjectArchivedFilters` observable used to detect
 *     whether any filters are applied for the current project.
 *   - useTranslation (`@plane/i18n`): `t` function for the empty-state title and
 *     description copy.
 *
 * Side effects:
 *   - API call (via store action wired to CycleArchiveService): `fetchArchivedCycles(workspaceSlug, projectId)`
 *     triggered by `useSWR` keyed on `ARCHIVED_CYCLES_${workspaceSlug}_${projectId}`.
 *     The SWR config disables `revalidateIfStale` and `revalidateOnFocus`, so the
 *     fetch fires once per route mount per workspace/project pair.
 *   - Store mutations:
 *       - `clearAllFilters(projectId, "archived")` when the user clicks "Clear all"
 *         on the applied filters strip.
 *       - `updateFilters(projectId, { [key]: newValues }, "archived")` from
 *         `handleRemoveFilter` when an individual filter chip is dismissed.
 *   - No direct navigation, no toasts — the route page owns navigation and toasting
 *     happens in child modals.
 *
 * Conditional rendering:
 *   - When `workspaceSlug` or `projectId` is missing → renders nothing (`<></>`).
 *   - When `loader` is truthy or `currentProjectArchivedCycleIds` is undefined →
 *     `CycleModuleListLayoutLoader`.
 *   - When `calculateTotalFilters(currentProjectArchivedFilters)` is non-zero →
 *     prepends the `CycleAppliedFiltersList` strip.
 *   - When the archived list is empty (zero archived cycles for the project) →
 *     centered `EmptyStateDetailed` with i18n title/description.
 *   - Otherwise → `ArchivedCyclesView` inside a scrollable full-height container.
 *
 * Consumers: rendered from the archived-cycles route page at
 * `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/archives/cycles/page.tsx`.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import type { TCycleFilters } from "@plane/types";
import { calculateTotalFilters } from "@plane/utils";
// components
import { CycleModuleListLayoutLoader } from "@/components/ui/loader/cycle-module-list-loader";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";
// local imports
import { CycleAppliedFiltersList } from "../applied-filters";
import { ArchivedCyclesView } from "./view";

export const ArchivedCycleLayoutRoot = observer(function ArchivedCycleLayoutRoot() {
  // router
  const { workspaceSlug, projectId } = useParams();
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const { fetchArchivedCycles, currentProjectArchivedCycleIds, loader } = useCycle();
  // cycle filters hook
  const { clearAllFilters, currentProjectArchivedFilters, updateFilters } = useCycleFilter();
  // derived values
  const totalArchivedCycles = currentProjectArchivedCycleIds?.length ?? 0;

  useSWR(
    workspaceSlug && projectId ? `ARCHIVED_CYCLES_${workspaceSlug.toString()}_${projectId.toString()}` : null,
    async () => {
      if (workspaceSlug && projectId) {
        await fetchArchivedCycles(workspaceSlug.toString(), projectId.toString());
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const handleRemoveFilter = (key: keyof TCycleFilters, value: string | null) => {
    if (!projectId) return;
    let newValues = currentProjectArchivedFilters?.[key] ?? [];

    if (!value) newValues = [];
    else newValues = newValues.filter((val) => val !== value);

    updateFilters(projectId.toString(), { [key]: newValues }, "archived");
  };

  if (!workspaceSlug || !projectId) return <></>;

  if (loader || !currentProjectArchivedCycleIds) {
    return <CycleModuleListLayoutLoader />;
  }

  return (
    <>
      {calculateTotalFilters(currentProjectArchivedFilters ?? {}) !== 0 && (
        <div className="border-b border-subtle px-5 py-3">
          <CycleAppliedFiltersList
            appliedFilters={currentProjectArchivedFilters ?? {}}
            handleClearAllFilters={() => clearAllFilters(projectId.toString(), "archived")}
            handleRemoveFilter={handleRemoveFilter}
          />
        </div>
      )}
      {totalArchivedCycles === 0 ? (
        <div className="h-full place-items-center">
          <EmptyStateDetailed
            assetKey="archived-cycle"
            title={t("workspace_empty_state.archive_cycles.title")}
            description={t("workspace_empty_state.archive_cycles.description")}
          />
        </div>
      ) : (
        <div className="relative h-full w-full overflow-auto">
          <ArchivedCyclesView workspaceSlug={workspaceSlug.toString()} projectId={projectId.toString()} />
        </div>
      )}
    </>
  );
});
