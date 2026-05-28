/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders a "description updated" event in the issue activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *   - showIssue (boolean, optional, default `true`): when true, appends " of "
 *     plus an `IssueLink` referencing the parent work item.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`.
 *
 * Side effects: none. This is a presentational notice row only — `@plane/editor`
 * is NOT instantiated here. The actual updated description body is rendered by
 * other components elsewhere in the issue-detail view; this row only flags that
 * a description change occurred.
 */

import { observer } from "mobx-react";
import { AlignLeft } from "lucide-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueDescriptionActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueDescriptionActivity = observer(function IssueDescriptionActivity(props: TIssueDescriptionActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<AlignLeft size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        updated the description
        {showIssue ? ` of ` : ``}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
