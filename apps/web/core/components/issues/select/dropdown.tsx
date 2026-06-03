/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-aware wrapper around `WorkItemLabelSelectBase` that binds the
 * reusable label combobox to the current workspace/project, lazily
 * hydrating the label cache and gating label creation behind project
 * admin permissions.
 *
 * Rendered purpose:
 *   Renders the work-item label selector inside any UI that needs a
 *   project-scoped label picker (issue creation modal, inbox create
 *   modal). Acts as the public surface re-exported from
 *   `@/components/issues/select`.
 *
 * Props — `TWorkItemLabelSelectProps`:
 *   Omits `labelIds`, `getLabelById`, and `onDropdownOpen` from
 *   `TWorkItemLabelSelectBaseProps` (the wrapper supplies these from
 *   the label store) and adds:
 *   - projectId (string | undefined, required-by-name; undefined disables
 *       creation): the project whose labels should be loaded and offered.
 *   Inherited from base (passed through via spread):
 *   - buttonClassName?, buttonContainerClassName?, disabled?,
 *       label?, onChange (required), placement?, tabIndex?,
 *       value (required) — see `./base` for full semantics.
 *   Note: `createLabelEnabled` and `createLabel` from the base prop type
 *   are overwritten by this wrapper (the wrapper computes them from
 *   permissions + store) and therefore ignored if passed by callers.
 *
 * MobX stores read (via React context — no Redux):
 *   - `useLabel()` (label store): `getProjectLabelIds(projectId)`,
 *       `getLabelById(labelId)`, `fetchProjectLabels(slug, projectId)`,
 *       `createLabel(slug, projectId, data)`.
 *   - `useUserPermissions()` (user store): `allowPermissions([ADMIN],
 *       PROJECT, workspaceSlug, projectId)` — only ADMIN at the PROJECT
 *       level can create labels.
 *
 * Router:
 *   - `useParams()` reads `workspaceSlug` from the current route. The
 *       import path `next/navigation` reflects the current source code;
 *       see AAP §0.2.6 C3 for the broader Vite/React-Router-v7 context.
 *
 * Side effects:
 *   - On dropdown open: if `projectLabelIds` is undefined (cache miss)
 *       and both `workspaceSlug` and `projectId` are present, triggers
 *       `fetchProjectLabels` — a GET to the project labels endpoint that
 *       populates the label store's `labelMap`.
 *   - On label creation (only when ADMIN at PROJECT): forwards to
 *       `createLabel` (POST to project labels endpoint), which mutates
 *       the label store and returns the new `IIssueLabel`.
 *   - Throws `Error("Workspace slug or project ID is missing")` from
 *       `handleCreateLabel` if invoked without route context — guards
 *       against being rendered outside a workspace/project page.
 *
 * Consumers (verified by grep):
 *   - `apps/web/core/components/issues/issue-modal/components/default-properties.tsx`
 *   - `apps/web/core/components/inbox/modals/create-modal/issue-properties.tsx`
 */
import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EUserPermissionsLevel } from "@plane/constants";
import type { IIssueLabel } from "@plane/types";
import { EUserPermissions } from "@plane/types";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { TWorkItemLabelSelectBaseProps } from "./base";
import { WorkItemLabelSelectBase } from "./base";

type TWorkItemLabelSelectProps = Omit<TWorkItemLabelSelectBaseProps, "labelIds" | "getLabelById" | "onDropdownOpen"> & {
  projectId: string | undefined;
};

export const IssueLabelSelect = observer(function IssueLabelSelect(props: TWorkItemLabelSelectProps) {
  const { projectId } = props;
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { getProjectLabelIds, getLabelById, fetchProjectLabels, createLabel } = useLabel();
  // derived values
  const projectLabelIds = getProjectLabelIds(projectId);

  const canCreateLabel =
    projectId &&
    allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug?.toString(), projectId);

  const onDropdownOpen = () => {
    if (projectLabelIds === undefined && workspaceSlug && projectId)
      fetchProjectLabels(workspaceSlug.toString(), projectId);
  };

  const handleCreateLabel = (data: Partial<IIssueLabel>) => {
    if (!workspaceSlug || !projectId) {
      throw new Error("Workspace slug or project ID is missing");
    }
    return createLabel(workspaceSlug.toString(), projectId, data);
  };

  return (
    <WorkItemLabelSelectBase
      {...props}
      getLabelById={getLabelById}
      labelIds={projectLabelIds ?? []}
      onDropdownOpen={onDropdownOpen}
      createLabel={handleCreateLabel}
      createLabelEnabled={!!canCreateLabel}
    />
  );
});
