/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-scoped calendar entry for the module context. Adapts the shared
 * BaseCalendarRoot to a specific module by sourcing the module id from the
 * route, wiring module-specific quick actions, and forwarding the
 * add-issues-to-module MobX action.
 *
 * Props: none — the component is driven entirely by useParams() and MobX stores.
 *
 * Route params consumed (next/navigation useParams):
 *   - workspaceSlug, projectId, moduleId — required for the addIssuesToView path;
 *     the component renders nothing when moduleId is absent.
 *
 * Stores read:
 *   - useIssues(EIssuesStoreType.MODULE).issues.addIssuesToModule — MobX action
 *     that internally invokes ModuleService.addIssuesToModule (see
 *     apps/web/core/services).
 *
 * Side effects:
 *   - addIssuesToView (memoized via useCallback) throws when any of
 *     workspaceSlug, projectId, or moduleId is missing; otherwise calls
 *     addIssuesToModule(workspaceSlug, projectId, moduleId, issueIds).
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/roots/module-layout-root.tsx
 *     — selects this component when the module issue layout is "calendar".
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssuesStoreType } from "@plane/types";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
// local imports
import { ModuleIssueQuickActions } from "../../quick-action-dropdowns";
import { BaseCalendarRoot } from "../base-calendar-root";

/** Module-scoped calendar layout: binds BaseCalendarRoot to the active module and forwards the add-to-module action. */
export const ModuleCalendarLayout = observer(function ModuleCalendarLayout() {
  const { workspaceSlug, projectId, moduleId } = useParams();

  const {
    issues: { addIssuesToModule },
  } = useIssues(EIssuesStoreType.MODULE);

  const addIssuesToView = useCallback(
    (issueIds: string[]) => {
      if (!workspaceSlug || !projectId || !moduleId) throw new Error();
      return addIssuesToModule(workspaceSlug.toString(), projectId.toString(), moduleId.toString(), issueIds);
    },
    [addIssuesToModule, workspaceSlug, projectId, moduleId]
  );

  if (!moduleId) return null;

  return (
    <BaseCalendarRoot
      QuickActions={ModuleIssueQuickActions}
      addIssuesToView={addIssuesToView}
      viewId={moduleId?.toString()}
    />
  );
});
