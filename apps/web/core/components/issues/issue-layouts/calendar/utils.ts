/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared persistence helper for the calendar drag-to-reschedule interaction.
 * Owns the minimal { id, target_date } patch and the no-op guards that protect
 * against missing context or same-cell drops.
 *
 * Consumers:
 *   - ./base-calendar-root.tsx (handleDragAndDrop wrapper).
 */

import type { TIssue } from "@plane/types";

/**
 * Persist a calendar drag-and-drop reschedule by patching only the target_date
 * on the moved issue.
 *
 * @param issueId - Id of the moved issue.
 * @param sourceDate - Original target_date payload string (yyyy-mm-dd format
 *   from renderFormattedPayloadDate); used only for the same-cell short-circuit.
 * @param destinationDate - New target_date payload string written to the issue.
 * @param workspaceSlug - Active workspace slug from the route; the call is a
 *   no-op when undefined. Not embedded in the patch because `updateIssue` is
 *   already workspace-scoped at the call site, so the slug only acts as a
 *   precondition.
 * @param projectId - Project id owning the issue; the call is a no-op when
 *   undefined.
 * @param updateIssue - Route-scoped store action from useIssuesActions; the
 *   call is a no-op when undefined.
 * @returns The result of updateIssue, or undefined for any no-op path
 *   (missing context or sourceDate === destinationDate).
 */
export const handleDragDrop = async (
  issueId: string,
  sourceDate: string,
  destinationDate: string,
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  updateIssue?: (projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>
) => {
  if (!workspaceSlug || !projectId || !updateIssue) return;

  if (sourceDate === destinationDate) return;

  const updatedIssue = {
    id: issueId,
    target_date: destinationDate,
  };

  return await updateIssue(projectId, updatedIssue.id, updatedIssue);
};
