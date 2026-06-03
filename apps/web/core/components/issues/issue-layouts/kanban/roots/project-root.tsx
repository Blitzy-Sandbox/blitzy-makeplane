/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-scope Kanban issue board root.
 *
 * Rendered purpose:
 *   Route-aware wrapper that binds workspace-slug-based PROJECT-level
 *   permission gating into the shared `BaseKanBanRoot` for project-scope issue
 *   boards.
 *
 * Props:
 *   None — all inputs are derived from route params via `useParams` (from
 *   `next/navigation`): `workspaceSlug`.
 *
 * MobX stores read:
 *   - `useUserPermissions()` — exposes `allowPermissions` for ADMIN/MEMBER
 *     PROJECT-scope gating.
 *
 * Side effects:
 *   None at this layer — no `addIssuesToView` callback is wired (the prop is
 *   left undefined). Mutations originate inside `BaseKanBanRoot` and
 *   `ProjectIssueQuickActions`.
 *
 * Permission gating:
 *   - `canEditPropertiesBasedOnProject(projectId)` delegates to
 *     `allowPermissions([ADMIN, MEMBER], PROJECT, workspaceSlug, projectId)`.
 *     The returned boolean gates inline property editing and quick actions
 *     inside the board for the given project.
 *
 * Consumers:
 *   Mounted by the project-issues page route in `apps/web/app/**` whenever the
 *   user selects the Kanban layout for a project.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseKanBanRoot } from "../base-kanban-root";

/**
 * Project-scope Kanban board root — see module-level JSDoc for the full
 * contract (PROJECT-level permission gating, `ProjectIssueQuickActions`
 * wiring).
 */
export const KanBanLayout = observer(function KanBanLayout() {
  // router
  const { workspaceSlug } = useParams();
  // hooks
  const { allowPermissions } = useUserPermissions();
  // derived values
  const canEditPropertiesBasedOnProject = (projectId: string) =>
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug?.toString(),
      projectId
    );

  return (
    <BaseKanBanRoot
      QuickActions={ProjectIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
    />
  );
});
