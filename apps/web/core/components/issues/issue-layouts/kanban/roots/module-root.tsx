/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Module-scope Kanban issue board root.
 *
 * Rendered purpose:
 *   Route-aware wrapper that binds module-issue store mutations and the active
 *   `moduleId` into the shared `BaseKanBanRoot` for module-scope issue boards.
 *
 * Props:
 *   None — all inputs are derived from route params via `useParams` (from
 *   `next/navigation`): `workspaceSlug`, `projectId`, `moduleId`.
 *
 * MobX stores read:
 *   - `useIssues(EIssuesStoreType.MODULE)` — exposes the module issues store
 *     whose `addIssuesToModule` mutator is wired into the add-to-view callback.
 *
 * Side effects:
 *   - `addIssuesToView(issueIds: string[])` (inline arrow): calls
 *     `issues.addIssuesToModule(workspaceSlug, projectId, moduleId, issueIds)`
 *     to attach existing issues to the active module (PATCH to apps/api).
 *     Throws when any required route param is missing.
 *
 * Permission gating:
 *   None at this layer — no `canEditPropertiesBasedOnProject` prop is wired
 *   (the prop is left undefined). Downstream `BaseKanBanRoot` and the
 *   `ModuleIssueQuickActions` component own their own gating.
 *
 * Consumers:
 *   Mounted by the module-issues page route in `apps/web/app/**` whenever the
 *   user selects the Kanban layout for a module.
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
import { BaseKanBanRoot } from "../base-kanban-root";

/**
 * Module-scope Kanban board root — see module-level JSDoc for the full
 * contract (stores read, add-to-module side effect).
 */
export const ModuleKanBanLayout = observer(function ModuleKanBanLayout() {
  const { workspaceSlug, projectId, moduleId } = useParams();

  // store
  const { issues } = useIssues(EIssuesStoreType.MODULE);

  return (
    <BaseKanBanRoot
      QuickActions={ModuleIssueQuickActions}
      addIssuesToView={(issueIds: string[]) => {
        if (!workspaceSlug || !projectId || !moduleId) throw new Error();
        return issues.addIssuesToModule(workspaceSlug.toString(), projectId.toString(), moduleId.toString(), issueIds);
      }}
      viewId={moduleId?.toString()}
    />
  );
});
