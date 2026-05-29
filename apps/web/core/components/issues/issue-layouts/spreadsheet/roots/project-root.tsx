/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project route adapter for the spreadsheet issue layout.
 *
 * Rendered purpose: reads `workspaceSlug` from the route, derives a per-project permission
 * predicate, and forwards it plus `ProjectIssueQuickActions` into `<BaseSpreadsheetRoot>`. The
 * permission predicate accepts a `projectId` argument so the shared `<BaseSpreadsheetRoot>`
 * contract can be reused by workspace-scoped routes that aggregate issues across projects.
 *
 * Props: none — fully driven by route context and MobX stores.
 *
 * MobX stores read:
 *   - `useParams()` exposes the `workspaceSlug` route param; `projectId` is resolved later by
 *     `<BaseSpreadsheetRoot>` through the issue-store-type hook. The `useParams` hook is imported
 *     from `next/navigation`, which Vite aliases to the in-repo React Router compatibility shim at
 *     `apps/web/app/compat/next/navigation.ts`; this resolves to React Router's `useParams`.
 *   - `useUserPermissions()` exposes `allowPermissions(roles, level, workspaceSlug, projectId)` —
 *     used by `canEditPropertiesBasedOnProject` to gate inline issue-property editing per project
 *
 * Side effects:
 *   - Forwards `<ProjectIssueQuickActions>` (project-specific quick-action menu) into
 *     `<BaseSpreadsheetRoot>`; that component handles the actual remove / update / archive
 *     mutations when the user invokes a quick action.
 *   - Passes `canEditPropertiesBasedOnProject` into `<BaseSpreadsheetRoot>` which cascades the
 *     read-only state into every row + cell editor.
 *   - No direct API calls in this file.
 *
 * Derived state (the WHY for non-obvious computations):
 *   - `canEditPropertiesBasedOnProject(projectId)` — checks ADMIN or MEMBER permission at the
 *     PROJECT level scoped to `(workspaceSlug, projectId)`. The callback signature accepts a
 *     `projectId` arg even though the project context here is always the same project, because
 *     `<BaseSpreadsheetRoot>` reuses the same callback contract for workspace-scoped roots that
 *     aggregate cross-project issues (and therefore need per-row, per-project permission lookup).
 *     This shared contract is the WHY this file passes a function rather than a boolean.
 *
 * Consumers:
 *   - `apps/web/app/.../projects/[projectId]/issues/page.tsx` — the project issues route mounts
 *     this directly when the project's selected layout is `EIssueLayoutTypes.SPREADSHEET`.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseSpreadsheetRoot } from "../base-spreadsheet-root";

/** Project spreadsheet route adapter; see the module-level JSDoc for full semantics. */
export const ProjectSpreadsheetLayout = observer(function ProjectSpreadsheetLayout() {
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
    <BaseSpreadsheetRoot
      QuickActions={ProjectIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
    />
  );
});
