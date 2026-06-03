/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for the project work items layout. Renders one of two variants:
 *   (1) Filtered empty — when `projectWorkItemFilter.hasActiveFilters` is true (offers Clear filters).
 *   (2) Default project empty — primary CTA opens the create-issue modal (PROJECT store).
 *
 * Hooks read:
 *   - useCommandPalette().toggleCreateIssueModal                  (open create-issue modal)
 *   - useUserPermissions().allowPermissions                       (CTA permission gate)
 *   - useWorkItemFilterInstance(PROJECT, projectId)               (hasActiveFilters, clearFilters)
 *   - useTranslation() / useParams()                              (copy + route binding)
 *
 * Side effects:
 *   - toggleCreateIssueModal(true, EIssuesStoreType.PROJECT) → opens global create-issue modal.
 *   - projectWorkItemFilter.clearFilters() → store-level filter reset.
 *   - No API calls or navigations are triggered directly here.
 *
 * Consumed by: `./index.tsx` (IssueLayoutEmptyState) when storeType === PROJECT.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssuesStoreType, EUserProjectRoles } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkItemFilterInstance } from "@/hooks/store/work-item-filters/use-work-item-filter-instance";

/**
 * Renders the empty-state UI for the project work items layout.
 *
 * Props: none — `projectId` is read from the route via `useParams()`.
 *
 * Variant selection:
 *   - When `projectWorkItemFilter.hasActiveFilters` is true → "Clear filters" secondary action.
 *   - Otherwise → "New work item" primary CTA that opens the create-issue modal (PROJECT store).
 *
 * Permission gate: requires PROJECT-level ADMIN or MEMBER (`EUserProjectRoles`).
 */
export const ProjectEmptyState = observer(function ProjectEmptyState() {
  // router
  const { projectId: routerProjectId } = useParams();
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // plane imports
  const { t } = useTranslation();
  // store hooks
  const { toggleCreateIssueModal } = useCommandPalette();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const projectWorkItemFilter = useWorkItemFilterInstance(EIssuesStoreType.PROJECT, projectId);

  const canPerformEmptyStateActions = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  return (
    <div className="relative h-full w-full overflow-y-auto">
      {projectWorkItemFilter?.hasActiveFilters ? (
        <EmptyStateDetailed
          assetKey="search"
          title={t("common_empty_state.search.title")}
          description={t("common_empty_state.search.description")}
          actions={[
            {
              label: t("project_issues.empty_state.issues_empty_filter.secondary_button.text"),
              onClick: projectWorkItemFilter?.clearFilters,
              disabled: !canPerformEmptyStateActions || !projectWorkItemFilter,
              variant: "secondary",
            },
          ]}
        />
      ) : (
        <EmptyStateDetailed
          assetKey="work-item"
          title={t("project_empty_state.work_items.title")}
          description={t("project_empty_state.work_items.description")}
          actions={[
            {
              label: t("project_empty_state.work_items.cta_primary"),
              onClick: () => {
                toggleCreateIssueModal(true, EIssuesStoreType.PROJECT);
              },
              disabled: !canPerformEmptyStateActions,
              variant: "primary",
            },
          ]}
        />
      )}
    </div>
  );
});
