/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-scoped calendar entry for the project context. Adapts the shared
 * BaseCalendarRoot to a project-level scope by sourcing the workspace slug
 * from the route, wiring project-specific quick actions, and supplying a
 * per-project edit-permission resolver.
 *
 * Props: none — the component is driven entirely by useParams() and MobX stores.
 *
 * Route params consumed (next/navigation useParams):
 *   - workspaceSlug — supplied to the per-project permission check.
 *
 * Stores read:
 *   - useUserPermissions().allowPermissions — invoked with
 *     [EUserPermissions.ADMIN, EUserPermissions.MEMBER] at
 *     EUserPermissionsLevel.PROJECT to gate per-issue edits.
 *
 * Side effects:
 *   - canEditPropertiesBasedOnProject(projectId) — forwarded to BaseCalendarRoot
 *     as the canEditPropertiesBasedOnProject prop; called per-issue inside the
 *     calendar to decide whether properties can be mutated.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/roots/project-layout-root.tsx
 *     — selects this component when the project issue layout is "calendar".
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseCalendarRoot } from "../base-calendar-root";

/** Project-scoped calendar layout: binds BaseCalendarRoot and gates per-issue edits via project-level ADMIN/MEMBER permissions. */
export const CalendarLayout = observer(function CalendarLayout() {
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
    <BaseCalendarRoot
      QuickActions={ProjectIssueQuickActions}
      canEditPropertiesBasedOnProject={canEditPropertiesBasedOnProject}
    />
  );
});
