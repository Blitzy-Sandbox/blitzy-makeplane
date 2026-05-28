/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Header for the project Archived Issues page.
 *
 * Rendered purpose: a `Header` (`EHeaderVariant.SECONDARY`) that puts the archive tab list on the left
 * and the archived-store filter toggle + display-filters dropdown on the right. Returns `null` when
 * `workspaceSlug` or `projectId` cannot be resolved from the router.
 *
 * Props: none — this is a route-aware header that reads router params directly.
 *
 * MobX stores read:
 *   - `useProject()` — `currentProjectDetails` for `cycle_view` / `module_view` gating
 *   - `useIssues(EIssuesStoreType.ARCHIVED)` — `issuesFilter.issueFilters` and `issuesFilter.updateFilters`
 *
 * Side effects:
 *   - Mutations: `updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS | DISPLAY_PROPERTIES, …)`
 *     on the archived issues filter store.
 *   - No navigations or service calls; persistence is handled inside the filter store.
 *
 * Derived state notes:
 *   - For the archived view, layout is hard-coded to `"list"` (only supported layout for archived issues).
 *   - `ISSUE_DISPLAY_FILTERS_BY_PAGE.archived_issues.layoutOptions[activeLayout]` resolves which display-filter
 *     fields are visible.
 *   - Filter mutations re-merge with the existing `issueFilters?.displayFilters` so a partial update does not
 *     drop other display-filter fields.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssueFilterType, ISSUE_DISPLAY_FILTERS_BY_PAGE } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { EHeaderVariant, Header } from "@plane/ui";
// components
import { ArchiveTabsList } from "@/components/archives";
import { DisplayFiltersSelection, FiltersDropdown } from "@/components/issues/issue-layouts/filters";
import { WorkItemFiltersToggle } from "@/components/work-item-filters/filters-toggle";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";

export const ArchivedIssuesHeader = observer(function ArchivedIssuesHeader() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // store hooks
  const { currentProjectDetails } = useProject();
  const {
    issuesFilter: { issueFilters, updateFilters },
  } = useIssues(EIssuesStoreType.ARCHIVED);
  // i18n
  const { t } = useTranslation();
  // for archived issues list layout is the only option
  const activeLayout = "list";

  const handleDisplayFiltersUpdate = (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => {
    if (!workspaceSlug || !projectId) return;

    updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS, {
      ...issueFilters?.displayFilters,
      ...updatedDisplayFilter,
    });
  };

  const handleDisplayPropertiesUpdate = (property: Partial<IIssueDisplayProperties>) => {
    if (!workspaceSlug || !projectId) return;

    updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_PROPERTIES, property);
  };

  if (!workspaceSlug || !projectId) return null;
  return (
    <Header variant={EHeaderVariant.SECONDARY}>
      <Header.LeftItem>
        <ArchiveTabsList />
      </Header.LeftItem>
      <Header.RightItem className="items-center">
        <WorkItemFiltersToggle entityType={EIssuesStoreType.ARCHIVED} entityId={projectId} />
        <FiltersDropdown title={t("common.display")} placement="bottom-end">
          <DisplayFiltersSelection
            displayFilters={issueFilters?.displayFilters || {}}
            displayProperties={issueFilters?.displayProperties || {}}
            handleDisplayFiltersUpdate={handleDisplayFiltersUpdate}
            handleDisplayPropertiesUpdate={handleDisplayPropertiesUpdate}
            layoutDisplayFiltersOptions={
              activeLayout ? ISSUE_DISPLAY_FILTERS_BY_PAGE.archived_issues.layoutOptions[activeLayout] : undefined
            }
            cycleViewDisabled={!currentProjectDetails?.cycle_view}
            moduleViewDisabled={!currentProjectDetails?.module_view}
          />
        </FiltersDropdown>
      </Header.RightItem>
    </Header>
  );
});
