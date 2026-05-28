/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Root container for the workspace-level draft work-item list.
 *
 * Rendered purpose: top-level layout for the workspace drafts page — orchestrates the
 * initial SWR fetch, renders the skeleton loader during initial load, falls back to
 * one of two empty states (no projects in workspace vs. no drafts), and otherwise
 * paints the list of `DraftIssueBlock` rows with infinite-scroll-style pagination.
 *
 * Drafts modeled here are workspace-scoped (`EIssuesStoreType.WORKSPACE_DRAFT` —
 * `TWorkspaceDraftIssue`) and intentionally distinct from project-, cycle-, and
 * module-scoped draft issues: a workspace draft has `project_id = null` until the user
 * promotes it via the "Move to project" action.
 *
 * Props (`TWorkspaceDraftIssuesRoot`):
 *   - workspaceSlug (string, required): URL slug of the parent workspace; used as the SWR cache key and forwarded to mutation calls
 *
 * MobX stores read:
 *   - `useWorkspaceDraftIssues()` — reads `loader`, `paginationInfo`, `issueIds`, `fetchIssues` action
 *   - `useProject()` — `workspaceProjectIds` (used by the "no projects" empty state)
 *   - `useCommandPalette()` — `toggleCreateProjectModal` for the empty-state CTA
 *   - `useUserPermissions()` — `allowPermissions([ADMIN, MEMBER], WORKSPACE)` to gate the create-project CTA
 *
 * Side effects:
 *   - SWR hook fetches the initial draft page via `fetchIssues(workspaceSlug, "init-loader")` keyed on the workspace slug
 *   - `useWorkspaceIssueProperties(workspaceSlug)` ensures the issue-property store is hydrated
 *   - `handleNextIssues` paginates forward via `fetchIssues(workspaceSlug, "pagination", EDraftIssuePaginationType.NEXT)`
 *   - Opens the create-project modal via `toggleCreateProjectModal(true)` from the "no projects" empty state
 *
 * Imperative DOM / derived state notes:
 *   - SWR is configured with `revalidateOnFocus: false, revalidateIfStale: false` so the page does not refetch on focus changes — pagination/refresh is owned by the store.
 *
 * Consumers:
 *   - `apps/web/app/[workspaceSlug]/(projects)/drafts/` route module
 */

import { Fragment } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { EUserPermissionsLevel, EDraftIssuePaginationType } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EUserWorkspaceRoles } from "@plane/types";
// components
import { cn } from "@plane/utils";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
// components
import { DraftIssueBlock } from "./draft-issue-block";
import { WorkspaceDraftEmptyState } from "./empty-state";
import { WorkspaceDraftIssuesLoader } from "./loader";

type TWorkspaceDraftIssuesRoot = {
  workspaceSlug: string;
};

export const WorkspaceDraftIssuesRoot = observer(function WorkspaceDraftIssuesRoot(props: TWorkspaceDraftIssuesRoot) {
  const { workspaceSlug } = props;
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const { loader, paginationInfo, fetchIssues, issueIds } = useWorkspaceDraftIssues();
  const { workspaceProjectIds } = useProject();
  const { toggleCreateProjectModal } = useCommandPalette();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const hasMemberLevelPermission = allowPermissions(
    [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  //swr hook for fetching issue properties
  useWorkspaceIssueProperties(workspaceSlug);

  // fetching issues
  const { isLoading } = useSWR(
    workspaceSlug ? `WORKSPACE_DRAFT_ISSUES_${workspaceSlug}` : null,
    workspaceSlug ? async () => await fetchIssues(workspaceSlug, "init-loader") : null,
    { revalidateOnFocus: false, revalidateIfStale: false }
  );

  // handle nest issues
  const handleNextIssues = async () => {
    if (!paginationInfo?.next_page_results) return;
    await fetchIssues(workspaceSlug, "pagination", EDraftIssuePaginationType.NEXT);
  };

  if (isLoading) {
    return <WorkspaceDraftIssuesLoader items={14} />;
  }

  if (workspaceProjectIds?.length === 0)
    return (
      <EmptyStateDetailed
        title={t("workspace_projects.empty_state.no_projects.title")}
        description={t("workspace_projects.empty_state.no_projects.description")}
        assetKey="project"
        assetClassName="size-40"
        actions={[
          {
            label: t("workspace_projects.empty_state.no_projects.primary_button.text"),
            onClick: () => {
              toggleCreateProjectModal(true);
            },
            disabled: !hasMemberLevelPermission,
            variant: "primary",
          },
        ]}
      />
    );

  if (issueIds.length <= 0) return <WorkspaceDraftEmptyState />;

  return (
    <div className="relative">
      <div className="relative">
        {issueIds.map((issueId: string) => (
          <DraftIssueBlock key={issueId} workspaceSlug={workspaceSlug} issueId={issueId} />
        ))}
      </div>

      {paginationInfo?.next_page_results && (
        <Fragment>
          {loader === "pagination" && issueIds.length >= 0 ? (
            <WorkspaceDraftIssuesLoader items={1} />
          ) : (
            <div
              className={cn("h-11 border-b border-subtle bg-surface-1 p-3 pl-6 text-13 font-medium transition-all", {
                "cursor-pointer text-accent-primary underline-offset-2 hover:text-accent-secondary hover:underline":
                  paginationInfo?.next_page_results,
              })}
              onClick={handleNextIssues}
            >
              Load More &darr;
            </div>
          )}
        </Fragment>
      )}
    </div>
  );
});
