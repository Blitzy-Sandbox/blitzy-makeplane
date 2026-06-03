/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-issue row renderers for the gantt issue layout.
 *
 * Provides two MobX `observer`-wrapped components that visualize an individual issue inside the gantt
 * chart shell composed by `./base-gantt-root.tsx`:
 *
 *   - `IssueGanttBlock`: the timeline block rendered on the date track; state-colored, peek-overview
 *     on click, hover popover with a `WorkItemPreviewCard`, optional `IssueStats` overlay for epics
 *   - `IssueGanttSidebarBlock`: the compact sidebar row rendered next to the timeline; project identifier,
 *     truncated title with tooltip, generated work-item link wrapped in `ControlLink` so click-handling
 *     routes through the peek-overview redirection
 *
 * Shared props (Props):
 *   - issueId (string, required): id of the issue to render — used as the key for store reads and as the
 *     DOM id (`issue-${issueId}`) for highlight-on-drop and scroll-into-view targeting
 *   - isEpic (boolean, optional, default=false): swaps the renderer into epic mode — affects work-item
 *     link generation and toggles the `IssueStats` overlay on the timeline block
 *
 * MobX stores read:
 *   - `useIssueDetail().issue.getIssueById(issueId)`: returns the `TIssue` for both blocks
 *   - `useProjectState().getProjectStates(project_id)`: timeline block only — used to find the state's
 *     hex color, which is the source of `blockStyle.backgroundColor`
 *   - `useIssues(storeType as GanttStoreType).issuesFilter.issueFilters.displayProperties`: sidebar block
 *     only — passed to `IssueIdentifier` so the identifier respects the layout's display-property filters
 *   - `useProject().getProjectIdentifierById(project_id)`: sidebar block only — used to build the
 *     work-item link slug
 *
 * Other hook-driven state:
 *   - `usePlatformOS().isMobile`: forwarded to `useIssuePeekOverviewRedirection` and to the `Tooltip`
 *     primitive so peek-overview behavior switches to a mobile-friendly drawer on small screens
 *   - `useIssueStoreType()`: resolves the active `EIssuesStoreType` from React context — narrowed to
 *     `GanttStoreType` (declared in `./base-gantt-root.tsx`) by the sidebar block
 *   - `useIssuePeekOverviewRedirection(isEpic)`: returns `handleRedirection(workspaceSlug, issue, isMobile)`
 *     which decides between peek-overview drawer (desktop) and full-page navigation (mobile)
 *
 * Side effects:
 *   - On click (both blocks): `handleRedirection` opens the peek-overview drawer or navigates to the
 *     work-item detail page; sidebar block additionally calls `e.stopPropagation(true)` and
 *     `e.preventDefault()` to prevent the underlying `ControlLink`'s `<a>` navigation from firing
 *   - Hover on timeline block: opens a `Popover` containing `WorkItemPreviewCard` (fetches/uses store
 *     data for full preview, no direct API call from this file)
 *   - `ControlLink` href: derived via `generateWorkItemLink(...)` from `@plane/utils` — produces a
 *     deterministic URL for keyboard navigation and middle-click "open in new tab", even though the
 *     primary click path uses peek-overview redirection
 *
 * Derived state:
 *   - `blockStyle`: derived by `getBlockViewDetails(issueDetails, stateColor)` from `../utils.tsx` —
 *     computes background gradient and width based on start_date / target_date and state color
 *   - `duration`: `findTotalDaysInRange(start_date, target_date)` from `@plane/utils` — controls whether
 *     `IssueStats.showProgressText` displays the textual percentage (only when duration >= 2 days)
 *
 * Consumers (via `./base-gantt-root.tsx` → `GanttChartRoot.blockToRender` / `IssueGanttSidebar`):
 *   - The gantt issue layout mounted by project, cycle, module, project-view, and epic roots
 *
 * Architectural notes:
 *   - The `Popover` and `Tooltip` primitives come from `@plane/propel`, the design-system package.
 *   - `ControlLink` from `@plane/ui` is the keyboard/middle-click safe link wrapper that delegates
 *     primary clicks to its `onClick` handler while preserving native browser link behaviors.
 *   - `IssueIdentifier` and `IssueStats` come from the plane-web overlay (`@/plane-web/...`) — these
 *     are the proprietary extensions of the open-source primitives.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Popover } from "@plane/propel/popover";
import { Tooltip } from "@plane/propel/tooltip";
import { ControlLink } from "@plane/ui";
import { findTotalDaysInRange, generateWorkItemLink } from "@plane/utils";
// components
import { SIDEBAR_WIDTH } from "@/components/gantt-chart/constants";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
// local imports
import { WorkItemPreviewCard } from "../../preview-card";
import { getBlockViewDetails } from "../utils";
import type { GanttStoreType } from "./base-gantt-root";

/** Shared props for `IssueGanttBlock` and `IssueGanttSidebarBlock`. */
type Props = {
  issueId: string;
  isEpic?: boolean;
};

/**
 * Renders a single issue as a colored block on the gantt timeline track.
 *
 * Click opens the peek-overview drawer (or navigates to detail on mobile). Hover opens a `Popover`
 * containing the full `WorkItemPreviewCard`. When `isEpic` is true, the epic-specific `IssueStats`
 * overlay is layered on the right side of the block.
 */
export const IssueGanttBlock = observer(function IssueGanttBlock(props: Props) {
  const { issueId, isEpic } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const { getProjectStates } = useProjectState();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  // hooks
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const stateDetails =
    issueDetails && getProjectStates(issueDetails?.project_id)?.find((state) => state?.id == issueDetails?.state_id);

  /** Memoizes block width, gradient, and state-color tint; recomputes whenever the issue or state changes. */
  const { blockStyle } = getBlockViewDetails(issueDetails, stateDetails?.color ?? "");

  const handleIssuePeekOverview = () => handleRedirection(workspaceSlug, issueDetails, isMobile);

  const duration = findTotalDaysInRange(issueDetails?.start_date, issueDetails?.target_date) || 0;

  return (
    <Popover delay={100} openOnHover>
      <Popover.Button
        className="w-full"
        render={
          <div
            id={`issue-${issueId}`}
            className="space-between relative flex h-full w-full cursor-pointer items-center rounded-sm"
            style={blockStyle}
            onClick={handleIssuePeekOverview}
          >
            <div className="absolute top-0 left-0 h-full w-full bg-surface-1/50" />
            <div
              className="sticky w-auto flex-1 truncate overflow-hidden px-2.5 py-1 text-13 text-primary"
              style={{ left: `${SIDEBAR_WIDTH}px` }}
            >
              {issueDetails?.name}
            </div>
            {isEpic && (
              <IssueStats
                issueId={issueId}
                className="sticky mx-2 w-auto flex-shrink-0 justify-end truncate overflow-hidden font-medium text-primary"
                showProgressText={duration >= 2}
              />
            )}
          </div>
        }
      />
      <Popover.Panel side="bottom" align="start">
        <>
          {issueDetails && issueDetails?.project_id && (
            <WorkItemPreviewCard
              projectId={issueDetails.project_id}
              stateDetails={{
                id: issueDetails.state_id ?? undefined,
              }}
              workItem={issueDetails}
            />
          )}
        </>
      </Popover.Panel>
    </Popover>
  );
});

/**
 * Renders a single issue as a compact row in the gantt sidebar (project identifier + truncated title).
 *
 * Wrapped in `ControlLink` so middle-click and keyboard activation use the standard `<a>` semantics
 * (href is derived via `generateWorkItemLink`), while primary clicks route through the peek-overview
 * redirection. Temporary issues — those with a `tempId`, created optimistically before the server
 * confirms — disable the link to avoid navigating to a not-yet-persisted URL.
 */
export const IssueGanttSidebarBlock = observer(function IssueGanttSidebarBlock(props: Props) {
  const { issueId, isEpic = false } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const storeType = useIssueStoreType() as GanttStoreType;
  const { issuesFilter } = useIssues(storeType);
  const { getProjectIdentifierById } = useProject();

  // handlers
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const projectIdentifier = getProjectIdentifierById(issueDetails?.project_id);

  /**
   * Intercepts the click that would otherwise let `ControlLink` navigate, then opens the peek-overview
   * drawer via the shared redirection hook. `stopPropagation(true)` is necessary because the surrounding
   * `GanttChartRoot` row also has click handlers that would conflict with peek-overview.
   */
  const handleIssuePeekOverview = (e: any) => {
    e.stopPropagation(true);
    e.preventDefault();
    handleRedirection(workspaceSlug, issueDetails, isMobile);
  };

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetails?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetails?.sequence_id,
    isEpic,
  });

  return (
    /**
     * `disabled={!!issueDetails?.tempId}`: temporary issues (optimistically created, not yet persisted)
     * cannot navigate to their detail URL — the URL will 404 until the server confirms.
     */
    <ControlLink
      id={`issue-${issueId}`}
      href={workItemLink}
      onClick={handleIssuePeekOverview}
      className="line-clamp-1 w-full cursor-pointer text-13 text-primary"
      disabled={!!issueDetails?.tempId}
    >
      <div className="relative flex h-full w-full cursor-pointer items-center gap-2">
        {issueDetails?.project_id && (
          <IssueIdentifier
            issueId={issueDetails.id}
            projectId={issueDetails.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={issuesFilter?.issueFilters?.displayProperties}
          />
        )}
        <Tooltip tooltipContent={issueDetails?.name} isMobile={isMobile}>
          <span className="flex-grow truncate text-13 font-medium">{issueDetails?.name}</span>
        </Tooltip>
      </div>
    </ControlLink>
  );
});
