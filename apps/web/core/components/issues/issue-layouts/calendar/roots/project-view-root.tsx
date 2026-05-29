/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-scoped calendar entry for the project-view context. The simplest of
 * the four calendar roots: forwards the route's viewId to BaseCalendarRoot
 * along with the project quick-actions surface.
 *
 * Props: none — the component is driven entirely by useParams().
 *
 * Route params consumed (next/navigation useParams):
 *   - viewId — forwarded as BaseCalendarRoot's viewId prop.
 *
 * Stores read: none directly — BaseCalendarRoot resolves the project-view
 * issue store internally via useIssueStoreType().
 *
 * Side effects: none — pure composition.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/roots/project-view-layout-root.tsx
 *     — selects this component when the project-view issue layout is "calendar".
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// local imports
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseCalendarRoot } from "../base-calendar-root";

/** Project-view-scoped calendar layout: passes the route's viewId into BaseCalendarRoot with project quick actions. */
export const ProjectViewCalendarLayout = observer(function ProjectViewCalendarLayout() {
  const { viewId } = useParams();

  return <BaseCalendarRoot QuickActions={ProjectIssueQuickActions} viewId={viewId.toString()} />;
});
