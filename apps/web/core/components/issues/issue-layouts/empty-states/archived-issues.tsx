/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for the archived work items layout. Renders one of two variants:
 *   (1) Filtered empty — when `archivedWorkItemFilter.hasActiveFilters` is true (offers a Clear
 *       filters action that resets the archived store's filter slice; no API call).
 *   (2) Default archived empty — primary CTA navigates to the project's automation settings,
 *       where archival automation rules are configured (the surface that produces archived
 *       work items in the first place); no create-issue modal is offered because creating
 *       new issues in an archive view would contradict the archival semantic.
 *
 * Hooks read:
 *   - useUserPermissions().allowPermissions           (permission gate for both CTAs)
 *   - useWorkItemFilterInstance(ARCHIVED, projectId)  (hasActiveFilters, clearFilters)
 *   - useAppRouter()                                  (navigation to project automation settings)
 *   - useTranslation() / useParams()                  (copy + route binding)
 *
 * Side effects:
 *   - Primary CTA (default empty): router.push(`/${workspaceSlug}/settings/projects/${projectId}/automations`)
 *     — pure client-side navigation; no API call, no modal toggle.
 *   - Secondary CTA (filtered empty): archivedWorkItemFilter.clearFilters() — pure store-level
 *     filter mutation; no API call.
 *
 * Consumed by: `./index.tsx` (IssueLayoutEmptyState) when storeType === EIssuesStoreType.ARCHIVED.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssuesStoreType, EUserProjectRoles } from "@plane/types";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkItemFilterInstance } from "@/hooks/store/work-item-filters/use-work-item-filter-instance";
import { useAppRouter } from "@/hooks/use-app-router";

/**
 * Renders the archived work items empty state.
 *
 * Props: none — route params (`workspaceSlug`, `projectId`) are read via `useParams`.
 *
 * Permission gate: requires PROJECT-level `EUserProjectRoles.ADMIN` or `EUserProjectRoles.MEMBER`
 * (`EUserPermissionsLevel.PROJECT`) to enable either CTA; lower-privileged users see disabled buttons.
 *
 * Variant selection (why this component branches two ways):
 *   - Filtered branch preserves the user's filter context with a non-destructive Clear filters action,
 *     consistent with other layouts' filtered-empty states.
 *   - Default branch routes to automation settings rather than offering a create-work-item modal:
 *     archived issues are produced by archival automations, not by direct creation in the archive view.
 */
export const ProjectArchivedEmptyState = observer(function ProjectArchivedEmptyState() {
  // router
  const router = useAppRouter();
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const projectId = routerProjectId ? routerProjectId.toString() : undefined;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  // derived values
  const archivedWorkItemFilter = useWorkItemFilterInstance(EIssuesStoreType.ARCHIVED, projectId);
  const canPerformEmptyStateActions = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  return (
    <div className="relative h-full w-full overflow-y-auto">
      {archivedWorkItemFilter?.hasActiveFilters ? (
        <EmptyStateDetailed
          assetKey="search"
          title={t("common_empty_state.search.title")}
          description={t("common_empty_state.search.description")}
          actions={[
            {
              label: "Clear filters",
              onClick: archivedWorkItemFilter?.clearFilters,
              disabled: !canPerformEmptyStateActions || !archivedWorkItemFilter,
              variant: "secondary",
            },
          ]}
        />
      ) : (
        <EmptyStateDetailed
          assetKey="archived-work-item"
          title={t("workspace_empty_state.archive_work_items.title")}
          description={t("workspace_empty_state.archive_work_items.description")}
          actions={[
            {
              label: t("workspace_empty_state.archive_work_items.cta_primary"),
              onClick: () => router.push(`/${workspaceSlug}/settings/projects/${projectId}/automations`),
              disabled: !canPerformEmptyStateActions,
              variant: "primary",
            },
          ]}
        />
      )}
    </div>
  );
});
