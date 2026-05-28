/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders a label add or remove event in the issue activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *   - showIssue (boolean, optional, default `true`): when true, appends " to "
 *     (add) or " from " (remove) followed by an `IssueLink`.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`.
 *   - `useLabel()` — reads `getLabelById(activity.old_identifier)` and
 *     `getLabelById(activity.new_identifier)` to resolve label colors for the
 *     visual chip; falls back to `#000000` inside `LabelActivityChip` when a
 *     label has been deleted and its color can no longer be resolved.
 *
 * Side effects: none. Read-only / presentational; no mutations, no API calls.
 */

import { observer } from "mobx-react";
import { LabelPropertyIcon } from "@plane/propel/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useLabel } from "@/hooks/store/use-label";
// components
import { IssueActivityBlockComponent, IssueLink, LabelActivityChip } from "./";

type TIssueLabelActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueLabelActivity = observer(function IssueLabelActivity(props: TIssueLabelActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { getLabelById } = useLabel();

  const activity = getActivityById(activityId);
  const oldLabelColor = getLabelById(activity?.old_identifier ?? "")?.color;
  const newLabelColor = getLabelById(activity?.new_identifier ?? "")?.color;

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<LabelPropertyIcon height={14} width={14} className="text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.old_value === "" ? `added a new label ` : `removed the label `}
        <LabelActivityChip
          name={activity.old_value === "" ? activity.new_value : activity.old_value}
          color={activity.old_value === "" ? newLabelColor : oldLabelColor}
        />
        {showIssue && (activity.old_value === "" ? ` to ` : ` from `)}
        {showIssue && <IssueLink activityId={activityId} />}
      </>
    </IssueActivityBlockComponent>
  );
});
