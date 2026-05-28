/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Header control strip that coordinates layout selection, work item filters, display filters/properties,
 * and analytics access for the project issues / epics page.
 *
 * Rendered purpose: a horizontal toolbar combining responsive `LayoutSelection` / `MobileLayoutSelection`,
 * a work-item filter toggle, a display-filters dropdown, and an Analytics modal launcher. Variants are
 * driven by `storeType` (PROJECT vs EPIC).
 *
 * Props:
 *   - currentProjectDetails (TProject | undefined, required): used to gate cycle/module view options
 *   - projectId (string, required): scopes filter mutations
 *   - workspaceSlug (string, required): scopes filter mutations
 *   - canUserCreateIssue (boolean | undefined, required): gates the Analytics modal launcher button
 *   - storeType (EIssuesStoreType.PROJECT | EIssuesStoreType.EPIC, optional, default=PROJECT): selects which
 *     issues store to operate on (and switches some user-facing copy between "work items" and "epics")
 *
 * MobX stores read:
 *   - `useIssues(storeType)` — `issuesFilter.issueFilters` and `issuesFilter.updateFilters`
 *
 * Side effects:
 *   - Mutations: `updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS | DISPLAY_PROPERTIES, …)`
 *     on the corresponding issues filter store. These actions in turn persist via the workspace/project view
 *     services (`IssueService` / `ViewService`) — handled inside the store.
 *   - Opens / closes a local `analyticsModal` boolean controlling the `WorkItemsModal`.
 *
 * Derived state notes:
 *   - `activeLayout = issueFilters?.displayFilters?.layout` selects which option set is shown in the dropdown.
 *   - `LAYOUTS` is a module-scope constant listing the five layout options (list, kanban, calendar, spreadsheet, gantt).
 *   - `ISSUE_STORE_TO_FILTERS_MAP` from `@plane/constants` resolves the layout-specific filter option schema.
 *   - The three handler callbacks (`handleLayoutChange`, `handleDisplayFilters`, `handleDisplayProperties`) are
 *     memoized with `useCallback` and short-circuit when `workspaceSlug` or `projectId` is falsy.
 */

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import { ChartNoAxesColumn, SlidersHorizontal } from "lucide-react";
// plane imports
import { EIssueFilterType, ISSUE_STORE_TO_FILTERS_MAP } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
// plane web imports
import type { TProject } from "@/plane-web/types";
// local imports
import { WorkItemsModal } from "../analytics/work-items/modal";
import { WorkItemFiltersToggle } from "../work-item-filters/filters-toggle";
import {
  DisplayFiltersSelection,
  FiltersDropdown,
  LayoutSelection,
  MobileLayoutSelection,
} from "./issue-layouts/filters";

type Props = {
  currentProjectDetails: TProject | undefined;
  projectId: string;
  workspaceSlug: string;
  canUserCreateIssue: boolean | undefined;
  storeType?: EIssuesStoreType.PROJECT | EIssuesStoreType.EPIC;
};
const LAYOUTS = [
  EIssueLayoutTypes.LIST,
  EIssueLayoutTypes.KANBAN,
  EIssueLayoutTypes.CALENDAR,
  EIssueLayoutTypes.SPREADSHEET,
  EIssueLayoutTypes.GANTT,
];

export const HeaderFilters = observer(function HeaderFilters(props: Props) {
  const {
    currentProjectDetails,
    projectId,
    workspaceSlug,
    canUserCreateIssue,
    storeType = EIssuesStoreType.PROJECT,
  } = props;
  // i18n
  const { t } = useTranslation();
  // states
  const [analyticsModal, setAnalyticsModal] = useState(false);
  // store hooks
  const {
    issuesFilter: { issueFilters, updateFilters },
  } = useIssues(storeType);
  // derived values
  const activeLayout = issueFilters?.displayFilters?.layout;
  const layoutDisplayFiltersOptions = ISSUE_STORE_TO_FILTERS_MAP[storeType]?.layoutOptions[activeLayout];

  const handleLayoutChange = useCallback(
    (layout: EIssueLayoutTypes) => {
      if (!workspaceSlug || !projectId) return;
      updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS, { layout: layout });
    },
    [workspaceSlug, projectId, updateFilters]
  );

  const handleDisplayFilters = useCallback(
    (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
      if (!workspaceSlug || !projectId) return;
      updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS, updatedDisplayFilter);
    },
    [workspaceSlug, projectId, updateFilters]
  );

  const handleDisplayProperties = useCallback(
    (property: Partial<IIssueDisplayProperties>) => {
      if (!workspaceSlug || !projectId) return;
      updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_PROPERTIES, property);
    },
    [workspaceSlug, projectId, updateFilters]
  );

  return (
    <>
      <WorkItemsModal
        isOpen={analyticsModal}
        onClose={() => setAnalyticsModal(false)}
        projectDetails={currentProjectDetails ?? undefined}
        isEpic={storeType === EIssuesStoreType.EPIC}
      />
      <div className="hidden @4xl:flex">
        <LayoutSelection
          layouts={LAYOUTS}
          onChange={(layout) => handleLayoutChange(layout)}
          selectedLayout={activeLayout}
        />
      </div>
      <div className="flex @4xl:hidden">
        <MobileLayoutSelection
          layouts={LAYOUTS}
          onChange={(layout) => handleLayoutChange(layout)}
          activeLayout={activeLayout}
        />
      </div>
      <WorkItemFiltersToggle entityType={storeType} entityId={projectId} />
      <FiltersDropdown
        miniIcon={<SlidersHorizontal className="size-3.5" />}
        title={t("common.display")}
        placement="bottom-end"
      >
        <DisplayFiltersSelection
          layoutDisplayFiltersOptions={layoutDisplayFiltersOptions}
          displayFilters={issueFilters?.displayFilters ?? {}}
          handleDisplayFiltersUpdate={handleDisplayFilters}
          displayProperties={issueFilters?.displayProperties ?? {}}
          handleDisplayPropertiesUpdate={handleDisplayProperties}
          cycleViewDisabled={!currentProjectDetails?.cycle_view}
          moduleViewDisabled={!currentProjectDetails?.module_view}
          isEpic={storeType === EIssuesStoreType.EPIC}
        />
      </FiltersDropdown>
      {canUserCreateIssue ? (
        <Button className="hidden px-2 md:block" onClick={() => setAnalyticsModal(true)} variant="secondary" size="lg">
          <div className="hidden @4xl:flex">{t("common.analytics")}</div>
          <div className="flex @4xl:hidden">
            <ChartNoAxesColumn className="size-3.5" />
          </div>
        </Button>
      ) : (
        <></>
      )}
    </>
  );
});
