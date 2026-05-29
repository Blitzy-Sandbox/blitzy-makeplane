/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `ProfileIssuesListLayout` route root for profile-view issue lists.
 *
 * Rendered purpose: entry point for profile-view (assigned-to-me,
 * created-by-me, subscribed) issue list layouts. Binds the active
 * `profileViewId` from the route to the shared `BaseListRoot` shell while
 * preserving the canonical project-level edit gating.
 *
 * Props: none — route context is read via `useParams()`.
 *
 * MobX stores read directly:
 *   - `useUserPermissions()` → `allowPermissions` for the project-level
 *     authorization predicate.
 *
 * Side effects:
 *   - Reads `workspaceSlug` and `profileViewId` from `useParams()`
 *     (Next.js navigation hook).
 *   - `profileViewId?.toString()` is forwarded to `BaseListRoot` via the
 *     `viewId` prop so the shell can key its issue selection on the
 *     profile-view id.
 *
 * Permission predicate: same workspace-level ADMIN/MEMBER pattern as
 * `project-root.tsx` (the canonical issue-property-edit gate from AAP §0.5.2),
 * applied even for profile views so per-row edits remain consistent with
 * project authorization.
 *
 * Quick actions: `ProjectIssueQuickActions` — profile views surface
 * project-scope actions because the underlying issues live inside their
 * respective projects.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the profile-view issue list layout — reads `workspaceSlug`
 * and `profileViewId` from the URL, applies the standard workspace-level
 * ADMIN/MEMBER permission gate at `EUserPermissionsLevel.PROJECT`, and
 * forwards the profile view id to `BaseListRoot` as the `viewId` prop.
 * Wrapped in MobX `observer`.
 */
export const ProfileIssuesListLayout = observer(function ProfileIssuesListLayout() {
  // router
  const { workspaceSlug, profileViewId } = useParams();
  // store
  const { allowPermissions } = useUserPermissions();

  const canEditPropertiesBasedOnProject = (projectId: string) =>
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug.toString(),
      projectId
    );

  return (
    <BaseListRoot
      QuickActions={ProjectIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
      viewId={profileViewId?.toString()}
    />
  );
});
