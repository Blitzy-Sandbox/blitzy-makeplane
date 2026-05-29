/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module route adapter for the spreadsheet issue layout.
 *
 * Rendered purpose: reads `moduleId` from the route, stringifies it (safely coalescing
 * undefined → undefined), and forwards it plus `ModuleIssueQuickActions` into
 * `<BaseSpreadsheetRoot>`. `<BaseSpreadsheetRoot>` then resolves the MODULE issue store and
 * paginates within the module's filter scope.
 *
 * Props: none — fully driven by route context.
 *
 * MobX stores read:
 *   - `useParams()` exposes the `moduleId` route param. The hook is imported from `next/navigation`,
 *     which Vite aliases to the in-repo React Router compatibility shim at
 *     `apps/web/app/compat/next/navigation.ts`; this resolves to React Router's `useParams`. No
 *     direct store reads in this file — store wiring happens inside `<BaseSpreadsheetRoot>`.
 *
 * Side effects:
 *   - Forwards `<ModuleIssueQuickActions>` (module-specific quick-action menu) into
 *     `<BaseSpreadsheetRoot>`; that component handles the actual remove / update / archive /
 *     remove-from-module mutations when the user invokes a quick action.
 *   - No direct API calls in this file.
 *
 * Consumers:
 *   - `apps/web/app/.../projects/[projectId]/modules/[moduleId]/page.tsx` — the module route
 *     mounts this directly when the module's selected layout is `EIssueLayoutTypes.SPREADSHEET`.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// mobx store
// components
import { ModuleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseSpreadsheetRoot } from "../base-spreadsheet-root";

/** Module spreadsheet route adapter; see the module-level JSDoc for full semantics. */
export const ModuleSpreadsheetLayout = observer(function ModuleSpreadsheetLayout() {
  const { moduleId } = useParams();

  return <BaseSpreadsheetRoot QuickActions={ModuleIssueQuickActions} viewId={moduleId?.toString()} />;
});
