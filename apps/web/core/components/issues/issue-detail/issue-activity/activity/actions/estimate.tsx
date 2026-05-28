/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders an estimate set or remove event in the issue activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *   - showIssue (boolean, optional, default `true`): when true, appends " to "
 *     (set) or " from " (removed) followed by an `IssueLink`.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`. The
 *     timeline payload exposes the new/old estimate value via `new_value` and
 *     `old_value` regardless of whether it originated from the legacy
 *     `estimate_point` field or the current `estimate_points` /
 *     `estimate_categories` fields — the backend normalizes them onto a single
 *     pair before emitting the activity.
 *
 * Side effects: none. Read-only / presentational.
 */

import { observer } from "mobx-react";
import { EstimatePropertyIcon } from "@plane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";

type TIssueEstimateActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueEstimateActivity = observer(function IssueEstimateActivity(props: TIssueEstimateActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;

  return (
    <IssueActivityBlockComponent
      icon={<EstimatePropertyIcon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.new_value ? `set the estimate point to ` : `removed the estimate point`}
        {activity.new_value ? activity.new_value : activity?.old_value}
        {showIssue && (activity.new_value ? ` to ` : ` from `)}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
