/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Profile-scope (cross-project) Kanban issue board root.
 *
 * Rendered purpose:
 *   Route-aware wrapper that binds the active `profileViewId` and PROJECT-level
 *   permission gating into the shared `BaseKanBanRoot` for profile (per-user
 *   cross-project) issue boards.
 *
 * Props:
 *   None — all inputs are derived from route params via `useParams` (from
 *   `next/navigation`): `workspaceSlug`, `profileViewId`.
 *
 * MobX stores read:
 *   - `useUserPermissions()` — exposes `allowPermissions` for ADMIN/MEMBER
 *     PROJECT-scope gating.
 *
 * Side effects:
 *   None at this layer — no `addIssuesToView` callback is wired (the prop is
 *   left undefined). Profile boards aggregate existing issues; attaching new
 *   issues to a profile view is not a supported operation.
 *
 * Permission gating:
 *   - `canEditPropertiesBasedOnProject(projectId)` calls
 *     `allowPermissions([ADMIN, MEMBER], PROJECT, workspaceSlug, projectId)`
 *     and gates inline edit + quick actions per project encountered across the
 *     profile board (which may aggregate issues from multiple projects, each
 *     evaluated independently).
 *
 * Consumers:
 *   Mounted by the profile-issues page route in `apps/web/app/**` whenever the
 *   user selects the Kanban layout for a user-profile view.
 *
 * Notes:
 *   The QuickActions component is intentionally `ProjectIssueQuickActions`
 *   (NOT a profile-specific variant) — profile boards display project issues,
 *   so project-level quick actions apply.
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
 * Profile-scope cross-project Kanban board root — see module-level JSDoc for
 * the full contract (stores read, PROJECT-level permission gating).
 */
export const ProfileIssuesKanBanLayout = observer(function ProfileIssuesKanBanLayout() {
  // router
  const { workspaceSlug, profileViewId } = useParams();
  const { allowPermissions } = useUserPermissions();

  const canEditPropertiesBasedOnProject = (projectId: string) =>
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug.toString(),
      projectId
    );

  return (
    <BaseKanBanRoot
      QuickActions={ProjectIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
      viewId={profileViewId?.toString()}
    />
  );
});
