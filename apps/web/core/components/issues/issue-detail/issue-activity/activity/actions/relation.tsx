/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders a work-item relation add or remove event (e.g., blocking, blocked_by,
 * duplicate, related) in the activity timeline.
 *
 * Props:
 *   - activityId (string, required): identifier of the activity record to render.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position marker.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`.
 *   - `useTimeLineRelationOptions()` from `@/plane-web/components/relations` —
 *     resolves the relation-type icon map keyed by `TIssueRelationTypes`. The
 *     active relation type is read from `activity.field`, which can be any
 *     value in `TIssueRelationTypes` (e.g., "blocking", "blocked_by",
 *     "duplicate", "relates_to", "start_after", "finish_before").
 *
 * Side effects: none. Read-only / presentational; no mutations, no navigations,
 * no API calls.
 *
 * Implementation note: the prefix copy is computed by
 * `getRelationActivityContent(activity)` and the related work-item identifier
 * is rendered from either `activity.new_value` (add) or `activity.old_value`
 * (remove) — branched on `activity.old_value === ""`.
 */

import { observer } from "mobx-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { getRelationActivityContent, useTimeLineRelationOptions } from "@/plane-web/components/relations";
import type { TIssueRelationTypes } from "@/plane-web/types";
//
import { IssueActivityBlockComponent } from "./";

type TIssueRelationActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueRelationActivity = observer(function IssueRelationActivity(props: TIssueRelationActivity) {
  const { activityId, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const activityContent = getRelationActivityContent(activity);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={activity.field ? ISSUE_RELATION_OPTIONS[activity.field as TIssueRelationTypes]?.icon(14) : <></>}
      activityId={activityId}
      ends={ends}
    >
      {activityContent}
      {activity.old_value === "" ? (
        <span className="font-medium text-primary">{activity.new_value}.</span>
      ) : (
        <span className="font-medium text-primary">{activity.old_value}.</span>
      )}
    </IssueActivityBlockComponent>
  );
});
