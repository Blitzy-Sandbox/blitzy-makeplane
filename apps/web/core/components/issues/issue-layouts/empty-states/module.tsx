/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for the module work items layout. Renders one of two variants:
 *   (1) Filtered empty — when `moduleWorkItemFilter.hasActiveFilters` is true (offers Clear filters).
 *   (2) Default module empty — primary CTA opens create-issue modal (MODULE store);
 *       secondary CTA opens an existing-issues modal to attach already-existing issues to the module.
 *
 * Hooks read:
 *   - useIssues(EIssuesStoreType.MODULE).issues.addIssuesToModule (async API: attach issues)
 *   - useCommandPalette().toggleCreateIssueModal                  (open create-issue modal)
 *   - useUserPermissions().allowPermissions                       (CTA permission gate)
 *   - useWorkItemFilterInstance(MODULE, moduleId)                 (hasActiveFilters, clearFilters)
 *   - useTranslation() / useParams()                              (copy + route binding)
 *
 * Side effects:
 *   - issues.addIssuesToModule(workspaceSlug, projectId, moduleId, issueIds) → success/error toast via setToast.
 *   - toggleCreateIssueModal(true, EIssuesStoreType.MODULE) → opens global create-issue modal scoped to module store.
 *   - moduleWorkItemFilter.clearFilters() → store-level filter reset.
 *   - setModuleIssuesListModal(true) → opens the local ExistingIssuesListModal.
 *
 * Consumed by: `./index.tsx` (IssueLayoutEmptyState) when storeType === MODULE.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { EIssuesStoreType, EUserProjectRoles } from "@plane/types";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkItemFilterInstance } from "@/hooks/store/work-item-filters/use-work-item-filter-instance";

/**
 * Renders the module work items empty state.
 *
 * Props: none — route params (`workspaceSlug`, `projectId`, `moduleId`) are read via `useParams`.
 *
 * Local state: `moduleIssuesListModal: boolean` controls the ExistingIssuesListModal visibility.
 *
 * Permission: requires PROJECT-level ADMIN or MEMBER (`EUserProjectRoles`).
 */
export const ModuleEmptyState = observer(function ModuleEmptyState() {
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId, moduleId: routerModuleId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  const moduleId = routerModuleId ? routerModuleId.toString() : undefined;
  // states
  const [moduleIssuesListModal, setModuleIssuesListModal] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { issues } = useIssues(EIssuesStoreType.MODULE);
  const { toggleCreateIssueModal } = useCommandPalette();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const moduleWorkItemFilter = useWorkItemFilterInstance(EIssuesStoreType.MODULE, moduleId);
  const canPerformEmptyStateActions = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const handleAddIssuesToModule = async (data: ISearchIssueResponse[]) => {
    if (!workspaceSlug || !projectId || !moduleId) return;

    const issueIds = data.map((i) => i.id);
    await issues
      .addIssuesToModule(workspaceSlug.toString(), projectId?.toString(), moduleId.toString(), issueIds)
      .then(() =>
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success!",
          message: "Work items added to the module successfully.",
        })
      )
      .catch(() =>
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: "Selected work items could not be added to the module. Please try again.",
        })
      );
  };

  return (
    <div className="relative h-full w-full overflow-y-auto">
      <ExistingIssuesListModal
        workspaceSlug={workspaceSlug?.toString()}
        projectId={projectId?.toString()}
        isOpen={moduleIssuesListModal}
        handleClose={() => setModuleIssuesListModal(false)}
        searchParams={{ module: moduleId != undefined ? moduleId.toString() : "" }}
        handleOnSubmit={handleAddIssuesToModule}
      />
      <div className="grid h-full w-full place-items-center">
        {moduleWorkItemFilter?.hasActiveFilters ? (
          <EmptyStateDetailed
            assetKey="search"
            title={t("common_empty_state.search.title")}
            description={t("common_empty_state.search.description")}
            actions={[
              {
                label: "Clear filters",
                onClick: moduleWorkItemFilter?.clearFilters,
                disabled: !canPerformEmptyStateActions || !moduleWorkItemFilter,
                variant: "secondary",
              },
            ]}
          />
        ) : (
          <EmptyStateDetailed
            assetKey="work-item"
            title={t("project_empty_state.module_work_items.title")}
            description={t("project_empty_state.module_work_items.description")}
            actions={[
              {
                label: t("project_empty_state.module_work_items.cta_primary"),
                onClick: () => {
                  toggleCreateIssueModal(true, EIssuesStoreType.MODULE);
                },
                disabled: !canPerformEmptyStateActions,
                variant: "primary",
              },
              {
                label: t("project_empty_state.module_work_items.cta_secondary"),
                onClick: () => setModuleIssuesListModal(true),
                disabled: !canPerformEmptyStateActions,
                variant: "secondary",
              },
            ]}
          />
        )}
      </div>
    </div>
  );
});
