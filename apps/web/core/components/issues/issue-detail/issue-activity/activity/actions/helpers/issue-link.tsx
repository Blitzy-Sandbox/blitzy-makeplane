/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders a link to the work item referenced by an issue activity row, with
 * a graceful fallback when the underlying work item has been deleted.
 *
 * Props (`TIssueLink`):
 *   - activityId (string, required): identifier of the activity record. Used
 *     to look up the underlying activity via `useIssueDetail()`. The
 *     workspace slug, project ID, issue ID, project identifier, and sequence
 *     ID needed to build the canonical work-item URL are read directly off
 *     that activity payload.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`.
 *
 * Other hooks:
 *   - `usePlatformOS()` — reads `isMobile` and forwards it to the `Tooltip`
 *     so the hover tooltip uses tap-to-show behavior on touch devices.
 *
 * URL generation: uses `generateWorkItemLink` from `@plane/utils` with
 * `{ workspaceSlug, projectId, issueId, projectIdentifier, sequenceId }`
 * pulled off the activity record. The canonical work-item URL points to
 * the standard `/<workspace_slug>/projects/<projectId>/work-items/<id>`
 * route (exact shape lives in `generateWorkItemLink`).
 *
 * Resilience and deleted-issue fallback:
 *   - Returns an empty fragment if `getActivityById(activityId)` is missing.
 *   - When the underlying work item has been deleted (i.e.,
 *     `activity.issue_detail` is null) OR the activity has no issue at all
 *     (`activity.issue === null`), the tooltip warns "This work item has
 *     been deleted", the anchor is marked `aria-disabled` and uses `"#"`
 *     as `href` with `target="_self"` so the click stays on the current
 *     page, and the visible label falls back to the literal "Work items"
 *     instead of the project identifier + sequence reference. This branch
 *     keeps the timeline coherent even after a referenced work item has
 *     been removed.
 *
 * Side effects: none. The rendered `<a>` is a static anchor; click
 * navigation is browser-driven, not invoked imperatively by this component.
 * No mutations, no API calls.
 */

import { Tooltip } from "@plane/propel/tooltip";
import { generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueLink = {
  activityId: string;
};

export function IssueLink(props: TIssueLink) {
  const { activityId } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const activity = getActivityById(activityId);

  if (!activity) return <></>;

  const workItemLink = generateWorkItemLink({
    workspaceSlug: activity.workspace_detail?.slug,
    projectId: activity.project,
    issueId: activity.issue,
    projectIdentifier: activity.project_detail.identifier,
    sequenceId: activity.issue_detail.sequence_id,
  });
  return (
    <Tooltip
      tooltipContent={activity.issue_detail ? activity.issue_detail.name : "This work item has been deleted"}
      isMobile={isMobile}
    >
      <a
        aria-disabled={activity.issue === null}
        href={`${activity.issue_detail ? workItemLink : "#"}`}
        target={activity.issue === null ? "_self" : "_blank"}
        rel={activity.issue === null ? "" : "noopener noreferrer"}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {activity.issue_detail
          ? `${activity.project_detail.identifier}-${activity.issue_detail.sequence_id}`
          : "Work items"}{" "}
        <span className="font-regular">{activity.issue_detail?.name}</span>
      </a>
    </Tooltip>
  );
}
