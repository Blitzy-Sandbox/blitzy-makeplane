/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the compact date area inside a `WorkItemPreviewCard` — shows a
 * start↔target range, a start-only date, or a target-only date depending on
 * which props are populated, with optional danger styling when the due date is
 * overdue or otherwise warrants emphasis for the work item's state group.
 *
 * Exported component: `WorkItemPreviewCardDate`
 *
 * Props (`Props` — all three are required by the type; pass `null` for any
 * date that is unset on the underlying work item):
 *   - `startDate` (string | null, required): ISO date string for the work
 *     item start date, or `null` when not set.
 *   - `stateGroup` (TStateGroups, required): work item state group, consulted
 *     by `shouldHighlightIssueDueDate` so terminal groups (e.g. completed) do
 *     not flag the due date as overdue.
 *   - `targetDate` (string | null, required): ISO date string for the work
 *     item due/target date, or `null` when not set.
 *
 * MobX stores read:
 *   None — this component is purely prop-driven.
 *
 * Side effects:
 *   None. Returns `null` when both `startDate` and `targetDate` are absent so
 *   the parent card does not render an empty date slot. Date highlighting and
 *   formatting are delegated to the pure helpers `shouldHighlightIssueDueDate`
 *   and `renderFormattedDate` from `@plane/utils`.
 *
 * Consumers:
 *   - `./root` (`WorkItemPreviewCard`) — the only caller in this folder.
 */

import { CalendarDays } from "lucide-react";
// plane imports
import { DueDatePropertyIcon, StartDatePropertyIcon } from "@plane/propel/icons";
import type { TStateGroups } from "@plane/types";
import { cn, renderFormattedDate, shouldHighlightIssueDueDate } from "@plane/utils";

type Props = {
  startDate: string | null;
  stateGroup: TStateGroups;
  targetDate: string | null;
};

export function WorkItemPreviewCardDate(props: Props) {
  const { startDate, stateGroup, targetDate } = props;
  // derived values
  const isDateRangeEnabled = Boolean(startDate && targetDate);
  const shouldHighlightDate = shouldHighlightIssueDueDate(targetDate, stateGroup);

  if (!startDate && !targetDate) return null;

  return (
    <div className="h-full rounded-sm px-1 text-11 text-secondary">
      {isDateRangeEnabled ? (
        <div
          className={cn("flex h-full items-center gap-1", {
            "text-danger-primary": shouldHighlightDate,
          })}
        >
          <CalendarDays className="size-3 shrink-0" />
          <span>
            {renderFormattedDate(startDate)} - {renderFormattedDate(targetDate)}
          </span>
        </div>
      ) : startDate ? (
        <div className="flex h-full items-center gap-1">
          <StartDatePropertyIcon className="size-3 shrink-0" />
          <span>{renderFormattedDate(startDate)}</span>
        </div>
      ) : (
        <div
          className={cn("flex h-full items-center gap-1", {
            "text-danger-primary": shouldHighlightDate,
          })}
        >
          <DueDatePropertyIcon className="size-3 shrink-0" />
          <span>{renderFormattedDate(targetDate)}</span>
        </div>
      )}
    </div>
  );
}
