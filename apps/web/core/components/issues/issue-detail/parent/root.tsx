/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact parent summary strip rendered above the issue title on the issue detail page.
 *
 * Rendered purpose: when the active work item has a parent, displays a single bordered row that
 * shows the parent's state-color dot, the optional `IssueIdentifier` badge (when the parent
 * belongs to a project the user can resolve), and the parent's truncated name. The row is
 * clickable and routes to the parent — epic parents use `router.push(workItemLink)` (full
 * navigation), non-epic parents open via `handleRedirection` (the peek-overview redirection
 * helper, which preserves the current page context). The row also exposes an overflow menu
 * containing the sibling work-items submenu and a destructive "Remove parent" action.
 *
 * Props (TIssueParentDetail, exported):
 *   - workspaceSlug (string, required): scopes the parent-removal mutation
 *   - projectId (string, required): scopes the parent-removal mutation (this is the CURRENT
 *     issue's project, not necessarily the parent's project — parents may live cross-project)
 *   - issueId (string, required): the work item whose parent is being summarized
 *   - issue (TIssue, required): the live issue snapshot — `issue.parent_id` is the lookup key
 *   - issueOperations (TIssueOperations, required): the issue-update contract published from
 *     `../root` — only the `update` method is invoked here (with `{ parent_id: null }` to clear)
 *
 * MobX stores read:
 *   - `useIssues()` — `issueMap` is used to resolve the parent issue snapshot by `issue.parent_id`
 *   - `useProject()` — `getProjectIdentifierById(parentIssue.project_id)` for the
 *     `generateWorkItemLink` call and the identifier badge
 *   - `useProjectState()` — `getProjectStates(parentIssue.project_id)` to resolve the parent's
 *     state color dot via `state.id === parentIssue.state_id`
 *
 * Side effects:
 *   - Navigation (epic parent): `router.push(workItemLink)` via `next/navigation` — preserved
 *     verbatim as a `next/navigation` import even though the repository runs on React Router v7
 *     via a workspace shim (per AAP system boundary forbidding refactoring/renaming).
 *   - Navigation (non-epic parent): `handleRedirection(workspaceSlug, parentIssue, isMobile)` —
 *     the peek-overview redirection hook chooses between full-page navigation and peek modal
 *     based on the platform and current context.
 *   - Mutation (clear parent): `issueOperations.update(workspaceSlug, projectId, issueId,
 *     { parent_id: null })` — routes through the issue-detail store action which calls
 *     `IssueService.patchIssue` against `apps/api`'s issue endpoint; toast emission is the
 *     contract layer's responsibility (handled in `../root.tsx`).
 *
 * Derived state notes:
 *   - `parentIssue = issueMap?.[issue.parent_id || ""] || undefined` — falls back to `undefined`
 *     when `parent_id` is null/empty so the early-exit guard handles both unset and missing cases.
 *   - `isParentEpic = parentIssue?.is_epic` — drives the navigation branch (full route vs. peek).
 *   - `stateColor` is `undefined` when the parent's state cannot be resolved; the dot still
 *     renders but with no background color (preserves the existing visual fallback).
 *   - `workItemLink` is composed only AFTER the early-exit guard so `generateWorkItemLink` always
 *     receives a defined `parentIssue.id`.
 *
 * Conditional rendering:
 *   - Returns `<></>` early when `parentIssue` cannot be resolved — keeps the surrounding layout
 *     identical for issues without a parent.
 *   - The `IssueIdentifier` badge is gated on `parentIssue.project_id` so cross-project parents
 *     without a resolvable project still render the dot and name fragment.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/main-content.tsx` mounts this component above
 *     the title editor and below the issue-type switcher.
 */

import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
import { MinusCircle } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
// component
// ui
import { ControlLink, CustomMenu } from "@plane/ui";
// helpers
import { generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// types
import type { TIssueOperations } from "../root";
import { IssueParentSiblings } from "./siblings";

export type TIssueParentDetail = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issue: TIssue;
  issueOperations: TIssueOperations;
};

export const IssueParentDetail = observer(function IssueParentDetail(props: TIssueParentDetail) {
  const { workspaceSlug, projectId, issueId, issue, issueOperations } = props;
  // router
  const router = useRouter();
  const { t } = useTranslation();
  // hooks
  const { issueMap } = useIssues();
  const { getProjectStates } = useProjectState();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const { isMobile } = usePlatformOS();
  const { getProjectIdentifierById } = useProject();

  // derived values
  const parentIssue = issueMap?.[issue.parent_id || ""] || undefined;
  const isParentEpic = parentIssue?.is_epic;
  const projectIdentifier = getProjectIdentifierById(parentIssue?.project_id);

  const issueParentState = getProjectStates(parentIssue?.project_id)?.find(
    (state) => state?.id === parentIssue?.state_id
  );
  const stateColor = issueParentState?.color || undefined;

  if (!parentIssue) return <></>;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: parentIssue?.project_id,
    issueId: parentIssue.id,
    projectIdentifier,
    sequenceId: parentIssue.sequence_id,
    isEpic: isParentEpic,
  });

  const handleParentIssueClick = () => {
    if (isParentEpic) router.push(workItemLink);
    else handleRedirection(workspaceSlug, parentIssue, isMobile);
  };

  return (
    <>
      <div className="mb-5 flex w-min items-center gap-3 rounded-md border border-strong bg-layer-1 px-2.5 py-1 text-11 whitespace-nowrap">
        <ControlLink href={workItemLink} onClick={handleParentIssueClick}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2.5">
              <span className="block h-2 w-2 rounded-full" style={{ backgroundColor: stateColor }} />
              {parentIssue.project_id && (
                <IssueIdentifier
                  projectId={parentIssue.project_id}
                  issueId={parentIssue.id}
                  size="xs"
                  variant="secondary"
                />
              )}
            </div>
            <span className="truncate text-primary">{(parentIssue?.name ?? "").substring(0, 50)}</span>
          </div>
        </ControlLink>

        <CustomMenu ellipsis optionsClassName="p-1.5">
          <div className="border-b border-strong text-11 font-medium text-secondary">{t("issue.sibling.label")}</div>

          <IssueParentSiblings workspaceSlug={workspaceSlug} currentIssue={issue} parentIssue={parentIssue} />

          <CustomMenu.MenuItem
            onClick={() => issueOperations.update(workspaceSlug, projectId, issueId, { parent_id: null })}
            className="flex items-center gap-2 py-2 text-danger-primary"
          >
            <MinusCircle className="h-4 w-4" />
            <span>{t("issue.remove.parent.label")}</span>
          </CustomMenu.MenuItem>
        </CustomMenu>
      </div>
    </>
  );
});
