/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-view-scope Kanban issue board root.
 *
 * Rendered purpose:
 *   Thin route-aware wrapper that binds the active `viewId` route param into
 *   the shared `BaseKanBanRoot` for project-view (saved view) issue boards.
 *
 * Props:
 *   None — all inputs are derived from route params via `useParams` (from
 *   `next/navigation`): `viewId`.
 *
 * MobX stores read:
 *   None directly at this layer. `BaseKanBanRoot` and the injected
 *   `ProjectIssueQuickActions` consume the relevant project-view issue stores
 *   internally.
 *
 * Side effects:
 *   None at this layer — no `addIssuesToView` callback is wired (the prop is
 *   left undefined). Mutations and API calls originate inside
 *   `BaseKanBanRoot` and `ProjectIssueQuickActions`.
 *
 * Permission gating:
 *   None at this layer — no `canEditPropertiesBasedOnProject` is wired. Inner
 *   board components apply their own gating where applicable.
 *
 * Consumers:
 *   Mounted by the project-view-issues page route in `apps/web/app/**`
 *   whenever the user selects the Kanban layout for a saved project view.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// hooks
// constant
// types
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
// components
import { BaseKanBanRoot } from "../base-kanban-root";

/**
 * Project-view scope Kanban board root — see module-level JSDoc for the full
 * contract (no stores, no callbacks at this layer; only forwards `viewId`).
 */
export const ProjectViewKanBanLayout = observer(function ProjectViewKanBanLayout() {
  const { viewId } = useParams();

  return <BaseKanBanRoot QuickActions={ProjectIssueQuickActions} viewId={viewId.toString()} />;
});
