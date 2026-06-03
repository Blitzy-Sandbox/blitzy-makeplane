/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for global (workspace-level) work item views. Renders one
 * of two variants gated on `workspaceProjectIds.length`:
 *   (1) No projects in workspace → primary CTA launches the create-project
 *       modal so the user can bootstrap their first project.
 *   (2) Workspace already has projects but the global view is empty → primary
 *       CTA launches the create-issue modal scoped to the PROJECT store (the
 *       create-issue flow requires a target project context; the GLOBAL store
 *       has no implicit project scope to attach the new work item to).
 *
 * Hooks read:
 *   - useProject().workspaceProjectIds                        (project enumeration)
 *   - useCommandPalette().toggleCreateProjectModal /
 *     toggleCreateIssueModal                                  (modal triggers)
 *   - useUserPermissions().allowPermissions                   (WORKSPACE-level gate)
 *   - useTranslation() (from `@plane/i18n`)                   (localized copy)
 *
 * Permission: WORKSPACE-level ADMIN or MEMBER (`EUserWorkspaceRoles` evaluated
 * against `EUserPermissionsLevel.WORKSPACE`). This is intentionally distinct
 * from the PROJECT-level gates used by sibling empty states in this folder
 * (`cycle.tsx`, `module.tsx`, `project-view.tsx`, etc.) — a global view is not
 * bound to any single project, so the gate is evaluated at workspace scope.
 *
 * Side effects: only modal toggles via the command palette. No API calls,
 * navigations, or store mutations are performed by this component.
 *
 * Consumed by: `./index.tsx` (`IssueLayoutEmptyState`) when
 * `storeType === EIssuesStoreType.GLOBAL`.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssuesStoreType, EUserWorkspaceRoles } from "@plane/types";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

/**
 * Renders the empty-state UI for global / workspace-level work item views.
 *
 * Props: none.
 *
 * Permission: requires WORKSPACE-level ADMIN or MEMBER
 * (`EUserWorkspaceRoles.ADMIN | EUserWorkspaceRoles.MEMBER` evaluated at
 * `EUserPermissionsLevel.WORKSPACE`). The CTA is rendered for all viewers but
 * disabled (`disabled: !hasMemberLevelPermission`) for non-members.
 *
 * The CTA's primary action varies by `workspaceProjectIds.length`:
 *   - `length === 0` → `toggleCreateProjectModal(true)` — the workspace has no
 *     projects yet, so the user must create one before any work item can exist.
 *   - otherwise      → `toggleCreateIssueModal(true, EIssuesStoreType.PROJECT)`
 *     — the create-issue modal is scoped to the PROJECT store rather than GLOBAL
 *     because the modal requires a concrete target project to attach the new
 *     work item to.
 *
 * Side effects: only command-palette modal toggles. No API calls, navigations,
 * or MobX store mutations are issued here.
 */
export const GlobalViewEmptyState = observer(function GlobalViewEmptyState() {
  // plane imports
  const { t } = useTranslation();
  // store hooks
  const { workspaceProjectIds } = useProject();
  const { toggleCreateIssueModal, toggleCreateProjectModal } = useCommandPalette();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const hasMemberLevelPermission = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (workspaceProjectIds?.length === 0) {
    return (
      <EmptyStateDetailed
        title={t("workspace_projects.empty_state.no_projects.title")}
        description={t("workspace_projects.empty_state.no_projects.description")}
        assetKey="project"
        assetClassName="size-40"
        actions={[
          {
            label: t("workspace_projects.empty_state.no_projects.primary_button.text"),
            onClick: () => {
              toggleCreateProjectModal(true);
            },
            disabled: !hasMemberLevelPermission,
            variant: "primary",
          },
        ]}
      />
    );
  }

  return (
    <EmptyStateDetailed
      title={t(`workspace_empty_state.views.title`)}
      description={t(`workspace_empty_state.views.description`)}
      assetKey="project"
      assetClassName="size-40"
      actions={[
        {
          label: t(`workspace_empty_state.views.cta_primary`),
          onClick: () => {
            toggleCreateIssueModal(true, EIssuesStoreType.PROJECT);
          },
          disabled: !hasMemberLevelPermission,
          variant: "primary",
        },
      ]}
    />
  );
});
