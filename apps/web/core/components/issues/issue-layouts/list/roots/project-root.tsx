/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `ListLayout` route root for the project-scoped issue list layout.
 *
 * Rendered purpose: project-scoped issue list entry point with the canonical
 * workspace-level ADMIN/MEMBER permission gate applied at
 * `EUserPermissionsLevel.PROJECT`. This is the standard authorization
 * boundary every project-scoped issue editor passes through.
 *
 * Props: none — route context is read via `useParams()`.
 *
 * MobX stores read directly:
 *   - `useUserPermissions()` → `allowPermissions` for the project-level
 *     authorization predicate.
 *
 * Side effects:
 *   - Reads `workspaceSlug` from `useParams()` (Next.js navigation hook).
 *   - Returns `null` when `workspaceSlug` is missing — guards against
 *     rendering the project list against undefined route context during
 *     Next.js navigation transitions.
 *
 * Permission predicate: `canEditPropertiesBasedOnProject(projectId)` calls
 * `allowPermissions([ADMIN, MEMBER], PROJECT, workspaceSlug, projectId)` —
 * forwarded to `BaseListRoot` so every per-row property edit goes through
 * the same authorization check.
 *
 * Quick actions: `ProjectIssueQuickActions` (full project-scope menu).
 *
 * Export name: `ListLayout` — note this generic name is preserved verbatim
 * for backwards compatibility with existing route mounting; the explicit
 * `ProjectViewListLayout` / `CycleListLayout` / etc. peer files use scope-
 * suffixed names.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the project-scoped issue list layout — reads
 * `workspaceSlug` from the URL, applies the standard workspace-level
 * ADMIN/MEMBER edit gate at `EUserPermissionsLevel.PROJECT`, and renders
 * `BaseListRoot` with `ProjectIssueQuickActions`. Returns `null` until
 * the route is ready. Wrapped in MobX `observer`.
 */
export const ListLayout = observer(function ListLayout() {
  // router
  const { workspaceSlug } = useParams();
  // hooks
  const { allowPermissions } = useUserPermissions();

  if (!workspaceSlug) return null;

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
    />
  );
});
