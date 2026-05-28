/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders an external-link create, update, or remove event in the activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *   - showIssue (boolean, optional, default `false`): when true, appends " to "
 *     (created) or " from " (updated/removed) followed by an `IssueLink`. The
 *     default differs from most sibling activity rows because link events are
 *     typically rendered inline with the parent work item context.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`. The
 *     URL is taken from `activity.new_value` on "created" verbs and from
 *     `activity.old_value` on "updated" and remove verbs.
 *
 * Side effects: none. Read-only / presentational; the rendered `<a>` is a static
 * external anchor opened in a new tab — no router mutation, no fetch, no store
 * mutation occurs at render time.
 */

import { observer } from "mobx-react";
import { MessageSquare } from "lucide-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueLinkActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueLinkActivity = observer(function IssueLinkActivity(props: TIssueLinkActivity) {
  const { activityId, showIssue = false, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<MessageSquare size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.verb === "created" ? (
          <>
            <span>added </span>
            <a
              href={`${activity.new_value}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              link
            </a>
          </>
        ) : activity.verb === "updated" ? (
          <>
            <span>updated the </span>
            <a
              href={`${activity.old_value}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              link
            </a>
          </>
        ) : (
          <>
            <span>removed this </span>
            <a
              href={`${activity.old_value}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              link
            </a>
          </>
        )}
        {showIssue && (activity.verb === "created" ? ` to ` : ` from `)}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
