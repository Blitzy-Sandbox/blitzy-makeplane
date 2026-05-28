/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders an assignee add or remove event in the issue activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *   - showIssue (boolean, optional, default `true`): when true, appends an
 *     `IssueLink` after the actor name with " to " (add) or " from " (remove).
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)` to resolve
 *     the underlying activity record.
 *
 * Side effects: none. The component is read-only / presentational; the rendered
 * `<a target="_blank">` to the actor profile is a static anchor — no router
 * mutation, no fetch, no store mutation occurs at render time.
 */

import { observer } from "mobx-react";
// icons
import { MembersPropertyIcon } from "@plane/propel/icons";
// hooks;
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueAssigneeActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueAssigneeActivity = observer(function IssueAssigneeActivity(props: TIssueAssigneeActivity) {
  const { activityId, ends, showIssue = true } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<MembersPropertyIcon className="h-3.5 w-3.5 flex-shrink-0 text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.old_value === "" ? `added a new assignee ` : `removed the assignee `}
        <a
          href={`/${activity.workspace_detail?.slug}/profile/${activity.new_identifier ?? activity.old_identifier}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center font-medium text-primary capitalize hover:underline"
        >
          {activity.new_value && activity.new_value !== "" ? activity.new_value : activity.old_value}
        </a>
        {showIssue && (activity.old_value === "" ? ` to ` : ` from `)}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
