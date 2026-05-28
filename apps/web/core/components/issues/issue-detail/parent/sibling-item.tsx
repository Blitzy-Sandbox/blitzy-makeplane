/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single sibling work-item row rendered inside the parent overflow menu.
 *
 * Rendered purpose: a clickable `CustomMenu.MenuItem` representing one sibling of the current
 * issue. Resolves the sibling's full issue snapshot and its project metadata from the relevant
 * stores, renders an `IssueIdentifier` badge (project key + sequence id + issue type icon), and
 * opens the sibling's canonical work-item URL in a new tab on click. Returns nothing when the
 * sibling cannot be resolved — defensive guard for stale ids surfaced during cache eviction.
 *
 * Props (local-only `TIssueParentSiblingItem` — NOT exported; consumers receive the type
 * structurally through the component signature):
 *   - workspaceSlug (string, required): scopes the work-item link composition
 *   - issueId (string, required): the sibling's id, used to resolve its full snapshot from the
 *     issue-detail store
 *
 * MobX stores read:
 *   - `useProject()` — `getProjectById(issueDetail.project_id)` to resolve the sibling's project
 *     identifier (used for both the badge and the URL composition)
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` returning the cached sibling snapshot
 *
 * Side effects:
 *   - Navigation on click: `window.open(workItemLink, "_blank", "noopener,noreferrer")` — opens
 *     the sibling in a new browser tab. The `"noopener,noreferrer"` flags strip the opener
 *     reference (security: prevent the opened page from controlling the original via
 *     `window.opener`) and the Referer header (privacy). The `"_blank"` target name forces a new
 *     tab/window rather than reusing an existing named tab.
 *   - No mutations; no toasts; this component is read-only.
 *
 * Conditional rendering:
 *   - Returns `<></>` early when `issueDetail` cannot be resolved from the store (e.g., the
 *     sibling id was returned by the SWR fetch but the per-issue cache hasn't populated yet).
 *   - The `IssueIdentifier` badge is gated on `issueDetail.project_id && projectDetails?.identifier`
 *     — both conditions must be truthy because the badge needs the project key for display.
 *     When either is missing (cross-project sibling without resolved project metadata), the menu
 *     item still renders but with an empty inner `<div>`; this preserves the row's click target.
 *
 * Derived state notes:
 *   - `workItemLink` is composed via `generateWorkItemLink` from `@plane/utils`; the function
 *     accepts optional fields and returns a well-formed URL even when intermediate fields are
 *     undefined (the result may be incomplete but never throws).
 *   - `projectDetails` falls back to `undefined` when `issueDetail.project_id` is missing, which
 *     is why the gated badge rendering uses `projectDetails?.identifier`.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/parent/siblings.tsx` maps each sibling id
 *     (after filtering out the current issue) to one `IssueParentSiblingItem`.
 */

import { observer } from "mobx-react";
// ui
import { CustomMenu } from "@plane/ui";
// helpers
import { generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";

type TIssueParentSiblingItem = {
  workspaceSlug: string;
  issueId: string;
};

export const IssueParentSiblingItem = observer(function IssueParentSiblingItem(props: TIssueParentSiblingItem) {
  const { workspaceSlug, issueId } = props;
  // hooks
  const { getProjectById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail();

  // derived values
  const issueDetail = (issueId && getIssueById(issueId)) || undefined;
  if (!issueDetail) return <></>;

  const projectDetails = (issueDetail.project_id && getProjectById(issueDetail.project_id)) || undefined;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetail?.project_id,
    issueId: issueDetail?.id,
    projectIdentifier: projectDetails?.identifier,
    sequenceId: issueDetail?.sequence_id,
  });

  return (
    <>
      <CustomMenu.MenuItem
        key={issueDetail.id}
        onClick={() => window.open(workItemLink, "_blank", "noopener,noreferrer")}
      >
        <div className="flex items-center gap-2 py-0.5">
          {issueDetail.project_id && projectDetails?.identifier && (
            <IssueIdentifier
              projectId={issueDetail.project_id}
              issueTypeId={issueDetail.type_id}
              projectIdentifier={projectDetails?.identifier}
              issueSequenceId={issueDetail.sequence_id}
              size="xs"
            />
          )}
        </div>
      </CustomMenu.MenuItem>
    </>
  );
});
