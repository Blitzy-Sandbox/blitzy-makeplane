/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-view route adapter for the spreadsheet issue layout.
 *
 * Rendered purpose: reads `viewId` from the route, stringifies it, and forwards it plus
 * `ProjectIssueQuickActions` into `<BaseSpreadsheetRoot>`. `<BaseSpreadsheetRoot>` then resolves
 * the PROJECT_VIEW issue store and paginates within the view's filter scope.
 *
 * Props: none — fully driven by route context.
 *
 * MobX stores read:
 *   - `useParams()` (Next.js navigation) exposes the `viewId` route param. No direct store reads
 *     in this file — store wiring happens inside `<BaseSpreadsheetRoot>`.
 *
 * Side effects:
 *   - Forwards `<ProjectIssueQuickActions>` (project-specific quick-action menu) into
 *     `<BaseSpreadsheetRoot>`; that component handles the actual remove / update / archive /
 *     remove-from-view mutations when the user invokes a quick action.
 *   - No direct API calls in this file.
 *
 * Consumers:
 *   - `apps/web/app/.../projects/[projectId]/views/[viewId]/page.tsx` — the project-view
 *     route mounts this directly when the view's selected layout is
 *     `EIssueLayoutTypes.SPREADSHEET`.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// mobx store
// components
import { ProjectIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseSpreadsheetRoot } from "../base-spreadsheet-root";
// types
// constants

/** Project-view spreadsheet route adapter; see the module-level JSDoc for full semantics. */
export const ProjectViewSpreadsheetLayout = observer(function ProjectViewSpreadsheetLayout() {
  const { viewId } = useParams();

  return <BaseSpreadsheetRoot QuickActions={ProjectIssueQuickActions} viewId={viewId.toString()} />;
});
