/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared row container for every entry in the issue-detail activity timeline.
 *
 * Renders the vertical-connector line, the leading icon badge, the actor
 * identity label, the activity message body (passed via `children`), and a
 * tooltipped relative timestamp ("X minutes ago" with the full date/time on
 * hover).
 *
 * Props (`TIssueActivityBlockComponent`):
 *   - icon (ReactNode, optional): leading icon for the badge. Defaults to a
 *     `lucide-react` `Network` icon when omitted.
 *   - activityId (string, required): identifier of the activity record. Used
 *     to look up the underlying activity via `useIssueDetail()`.
 *   - ends ("top" | "bottom" | undefined, required): timeline-stack position
 *     marker; drives the row's vertical padding so adjacent rows visually
 *     compose into a single connected stack (top row trims top padding,
 *     bottom row trims bottom padding, middle rows pad both sides).
 *   - children (ReactNode, required): the per-activity-type message content
 *     rendered between the actor name and the timestamp.
 *   - customUserName (string, optional): overrides the resolved actor display
 *     name. Used by system-initiated rows (e.g., the `archive` verb labels the
 *     actor "Plane" because the archive ran as a background job, not a user).
 *     The override flows through to both identity branches below.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — reads `activity.getActivityById(activityId)`. The
 *     timestamp text is derived from `activity.created_at` via
 *     `calculateTimeAgo`, `renderFormattedDate`, and `renderFormattedTime`
 *     from `@plane/utils`.
 *
 * Other hooks:
 *   - `usePlatformOS()` — reads `isMobile` and forwards it to the `Tooltip`
 *     so the timestamp tooltip uses tap-to-show behavior on touch devices.
 *
 * Resilience: returns an empty fragment when `getActivityById(activityId)`
 * is missing — prevents broken timeline rows from stale or evicted IDs.
 *
 * Identity rendering: when `activity.verb === "created"` AND `activity.field`
 * is falsy, the row delegates to `IssueCreatorDisplay` (which can surface
 * external creators such as integrations). Otherwise it delegates to
 * `IssueUser`. The optional `customUserName` flows through to either branch.
 *
 * Side effects: none. Read-only / presentational — no mutations, no
 * navigations, no API calls are triggered at render time.
 */

import type { ReactNode } from "react";
import { Network } from "lucide-react";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
import { renderFormattedTime, renderFormattedDate, calculateTimeAgo } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueCreatorDisplay } from "@/plane-web/components/issues/issue-details/issue-creator";
// local imports
import { IssueUser } from "../";

type TIssueActivityBlockComponent = {
  icon?: ReactNode;
  activityId: string;
  ends: "top" | "bottom" | undefined;
  children: ReactNode;
  customUserName?: string;
};

export function IssueActivityBlockComponent(props: TIssueActivityBlockComponent) {
  const { icon, activityId, ends, children, customUserName } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  const { isMobile } = usePlatformOS();
  if (!activity) return <></>;
  return (
    <div
      className={`relative flex items-center gap-3 text-caption-sm-regular ${
        ends === "top" ? `pb-2` : ends === "bottom" ? `pt-2` : `py-2`
      }`}
    >
      <div className="absolute top-0 bottom-0 left-[13px] w-px bg-layer-3" aria-hidden />
      <div className="z-[4] flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-layer-2 text-secondary shadow-raised-100">
        {icon ? icon : <Network className="h-3.5 w-3.5" />}
      </div>
      <div className="w-full truncate text-secondary">
        {!activity?.field && activity?.verb === "created" ? (
          <IssueCreatorDisplay activityId={activityId} customUserName={customUserName} />
        ) : (
          <IssueUser activityId={activityId} customUserName={customUserName} />
        )}
        <span> {children} </span>
        <span>
          <Tooltip
            isMobile={isMobile}
            tooltipContent={`${renderFormattedDate(activity.created_at)}, ${renderFormattedTime(activity.created_at)}`}
          >
            <span className="whitespace-nowrap text-tertiary"> {calculateTimeAgo(activity.created_at)}</span>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
