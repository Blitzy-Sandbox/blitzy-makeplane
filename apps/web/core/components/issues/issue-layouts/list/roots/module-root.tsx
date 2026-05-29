/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `ModuleListLayout` route root for the module-scoped issue list.
 *
 * Rendered purpose: module-scoped issue list entry point with a
 * module-specific `addIssuesToView` callback that calls
 * `issues.addIssuesToModule` to bulk-attach existing issues to the active
 * module.
 *
 * Props: none — route context is read via `useParams()`.
 *
 * MobX stores read directly:
 *   - `useIssues(EIssuesStoreType.MODULE)` → `issues` (the module-scoped
 *     issue store) for the `addIssuesToModule` mutation.
 *
 * Side effects:
 *   - Reads `workspaceSlug`, `projectId`, and `moduleId` from `useParams()`
 *     (Next.js navigation hook).
 *   - `addIssuesToView(issueIds)` calls
 *     `issues.addIssuesToModule(workspaceSlug, projectId, moduleId, issueIds)`
 *     — which fires an API call to `apps/api` to persist the membership.
 *     Throws `Error` if any route parameter is missing, surfacing the
 *     unsupported-route-context condition loudly rather than silently
 *     no-op'ing.
 *
 * Quick actions: `ModuleIssueQuickActions` (module-scope menu — includes
 * remove-from-module in addition to project-scope actions).
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
// local imports
import { ModuleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the module-scoped issue list layout — reads
 * `EIssuesStoreType.MODULE`, wires the module-specific add-to-module
 * mutation, and binds the active `moduleId` to `BaseListRoot` as the
 * `viewId` prop. Wrapped in MobX `observer` so the list re-renders when
 * the module's issue set or filters change.
 */
export const ModuleListLayout = observer(function ModuleListLayout() {
  const { workspaceSlug, projectId, moduleId } = useParams();

  const { issues } = useIssues(EIssuesStoreType.MODULE);

  return (
    <BaseListRoot
      QuickActions={ModuleIssueQuickActions}
      addIssuesToView={(issueIds: string[]) => {
        if (!workspaceSlug || !projectId || !moduleId) throw new Error();
        return issues.addIssuesToModule(workspaceSlug.toString(), projectId.toString(), moduleId.toString(), issueIds);
      }}
      viewId={moduleId?.toString()}
    />
  );
});
