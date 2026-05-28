/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue activity timeline dispatcher — reactive routing layer for the issue-detail activity feed.
 *
 * Resolves an activity record from the issue-detail MobX store by `activityId`, inspects the
 * record's `field` discriminant, and renders the appropriate specialized timeline row component
 * from `./actions`. Relation activity types (e.g., "blocking", "blocked_by", "duplicate") are
 * recognized dynamically via `useTimeLineRelationOptions` + `getValidKeysFromObject` rather than
 * a hardcoded list, so plane-web-injected relation kinds light up without changes here.
 *
 * Props (TIssueActivityItem):
 *   - activityId (string, required): primary key of the activity record in the issue-detail
 *     store; consumed via `activity.getActivityById(activityId)`.
 *   - ends ("top" | "bottom" | undefined, required): timeline grouping position — passed
 *     through to the selected child renderer so visually grouped consecutive activities
 *     can render connector lines correctly. `undefined` means standalone (not grouped).
 *
 * MobX stores read:
 *   - `useIssueDetail().activity.getActivityById` — resolves the activity record by id.
 *   - `useIssueDetail().comment` — destructured for reactivity wiring only (no fields used).
 *
 * Routing contract (by `activity.field`):
 *   - `null`                                     → IssueDefaultActivity (creation/deletion)
 *   - "state" | "name" | "description"           → matching field-specific component
 *   - "assignees" | "priority" | "parent"        → matching field-specific component
 *   - "estimate_points" | "estimate_categories"
 *     | "estimate_point" (legacy)                → IssueEstimateActivity
 *   - any key returned by `useTimeLineRelationOptions` → IssueRelationActivity
 *   - "start_date" | "target_date"               → matching date component
 *   - "cycles" | "modules" | "labels"            → matching relation component
 *   - "link" | "attachment"                      → matching attachment/link component
 *   - "archived_at"                              → IssueArchivedAtActivity
 *   - "intake" | "inbox"                         → IssueInboxActivity
 *   - "type"                                     → IssueTypeActivity (plane-web)
 *   - default                                    → AdditionalActivityRoot (plane-web fallback
 *     for custom/legacy fields so unknown activity records still render).
 *
 * Side effects: none — this component is purely presentational. All activity-record writes
 * happen elsewhere; this dispatcher only reads from the store.
 *
 * Consumers: rendered for each activity id in the issue-detail timeline by ancestor
 * components under `apps/web/core/components/issues/issue-detail/issue-activity/`.
 */

import { observer } from "mobx-react";
// helpers
import { getValidKeysFromObject } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueTypeActivity, AdditionalActivityRoot } from "@/plane-web/components/issues/issue-details";
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
// local components
import {
  IssueDefaultActivity,
  IssueNameActivity,
  IssueDescriptionActivity,
  IssueStateActivity,
  IssueAssigneeActivity,
  IssuePriorityActivity,
  IssueEstimateActivity,
  IssueParentActivity,
  IssueRelationActivity,
  IssueStartDateActivity,
  IssueTargetDateActivity,
  IssueCycleActivity,
  IssueModuleActivity,
  IssueLabelActivity,
  IssueLinkActivity,
  IssueAttachmentActivity,
  IssueArchivedAtActivity,
  IssueInboxActivity,
} from "./actions";

type TIssueActivityItem = {
  activityId: string;
  ends: "top" | "bottom" | undefined;
};

export const IssueActivityItem = observer(function IssueActivityItem(props: TIssueActivityItem) {
  const { activityId, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
    comment: {},
  } = useIssueDetail();
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const activityRelations = getValidKeysFromObject(ISSUE_RELATION_OPTIONS);

  const componentDefaultProps = { activityId, ends };

  const activityField = getActivityById(activityId)?.field;
  switch (activityField) {
    case null: // default issue creation
      return <IssueDefaultActivity {...componentDefaultProps} />;
    case "state":
      return <IssueStateActivity {...componentDefaultProps} showIssue={false} />;
    case "name":
      return <IssueNameActivity {...componentDefaultProps} />;
    case "description":
      return <IssueDescriptionActivity {...componentDefaultProps} showIssue={false} />;
    case "assignees":
      return <IssueAssigneeActivity {...componentDefaultProps} showIssue={false} />;
    case "priority":
      return <IssuePriorityActivity {...componentDefaultProps} showIssue={false} />;
    case "estimate_points":
    case "estimate_categories":
    case "estimate_point" /* This case is to handle all the older recorded activities for estimates. Field changed from  "estimate_point" -> `estimate_${estimate_type}`*/:
      return <IssueEstimateActivity {...componentDefaultProps} showIssue={false} />;
    case "parent":
      return <IssueParentActivity {...componentDefaultProps} showIssue={false} />;
    case activityRelations.find((field) => field === activityField):
      return <IssueRelationActivity {...componentDefaultProps} />;
    case "start_date":
      return <IssueStartDateActivity {...componentDefaultProps} showIssue={false} />;
    case "target_date":
      return <IssueTargetDateActivity {...componentDefaultProps} showIssue={false} />;
    case "cycles":
      return <IssueCycleActivity {...componentDefaultProps} />;
    case "modules":
      return <IssueModuleActivity {...componentDefaultProps} />;
    case "labels":
      return <IssueLabelActivity {...componentDefaultProps} showIssue={false} />;
    case "link":
      return <IssueLinkActivity {...componentDefaultProps} showIssue={false} />;
    case "attachment":
      return <IssueAttachmentActivity {...componentDefaultProps} showIssue={false} />;
    case "archived_at":
      return <IssueArchivedAtActivity {...componentDefaultProps} />;
    case "intake":
    case "inbox":
      return <IssueInboxActivity {...componentDefaultProps} />;
    case "type":
      return <IssueTypeActivity {...componentDefaultProps} />;
    default:
      return <AdditionalActivityRoot {...componentDefaultProps} field={activityField} />;
  }
});
