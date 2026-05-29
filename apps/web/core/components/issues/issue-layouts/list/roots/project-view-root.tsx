/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module: `ProjectViewListLayout` route root for project-view list layouts.
 *
 * Rendered purpose: entry point for a project-view (a saved filter view)
 * issue list layout — binds the active `viewId` from the route to the
 * shared `BaseListRoot` shell so the shell knows which view's filters
 * and grouping rules to read from the project-view issues store.
 *
 * Props: none — route context is read via `useParams()`.
 *
 * MobX stores read directly: none. The downstream shared `BaseListRoot`
 * container reads the project-view issue store keyed by `viewId`.
 *
 * Side effects:
 *   - Reads `viewId` from `useParams()` (Next.js navigation hook). The
 *     view identifier is forwarded to `BaseListRoot` via the `viewId` prop.
 *
 * Quick actions: `ProjectIssueQuickActions` (full project-scope menu —
 * create / duplicate / delete / move between cycles & modules).
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// store
// constants
// types
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
// components
import { BaseListRoot } from "../base-list-root";

/**
 * Route root for the project-view (saved filter view) list layout — reads
 * the active `viewId` from the URL via `useParams()` and binds it to
 * `BaseListRoot` along with `ProjectIssueQuickActions`. Wrapped in MobX
 * `observer` so the list re-renders when project-view issue state changes.
 */
export const ProjectViewListLayout = observer(function ProjectViewListLayout() {
  const { viewId } = useParams();

  return <BaseListRoot QuickActions={ProjectIssueQuickActions} viewId={viewId.toString()} />;
});
