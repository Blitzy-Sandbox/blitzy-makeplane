/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the actor label for an issue activity row.
 *
 * Two rendering modes:
 *   1. When `customUserName` is provided, renders the override as plain
 *      emphasized text (no link). This is used by system-initiated rows
 *      (e.g., the `archive` verb passes `customUserName="Plane"` because the
 *      action ran as a background job rather than a user action).
 *   2. Otherwise renders a `Link` element whose `href` points to the actor's
 *      workspace profile at `/<workspace_slug>/profile/<actor_id>`. The
 *      displayed text is the actor's `display_name`.
 *
 * Props (`TIssueUser`):
 *   - activityId (string, required): identifier of the activity record. Used
 *     to look up the underlying activity via `useIssueDetail()` and resolve
 *     the actor's workspace slug, ID, and display name.
 *   - customUserName (string, optional): if provided, renders this label as
 *     emphasized plain text and skips the profile link entirely. Intended
 *     for activity rows whose actor is not a real user account.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)` to
 *     resolve `activity.workspace_detail.slug`, `activity.actor_detail.id`,
 *     and `activity.actor_detail.display_name`.
 *
 * Resilience: returns an empty fragment if `getActivityById(activityId)`
 * is missing — prevents broken actor labels from stale or evicted IDs.
 *
 * Side effects: none directly. The rendered `Link` element navigates to
 * the actor's workspace profile on click; navigation is router-delegated
 * (handled by the rendered link element itself) — this component does not
 * invoke any router APIs imperatively. No mutations, no API calls.
 */

import Link from "next/link";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type TIssueUser = {
  activityId: string;
  customUserName?: string;
};

export function IssueUser(props: TIssueUser) {
  const { activityId, customUserName } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;

  return (
    <>
      {customUserName ? (
        <span className="font-medium text-primary">{customUserName}</span>
      ) : (
        <Link
          href={`/${activity?.workspace_detail?.slug}/profile/${activity?.actor_detail?.id}`}
          className="font-medium text-primary hover:underline"
        >
          {activity.actor_detail?.display_name}
        </Link>
      )}
    </>
  );
}
