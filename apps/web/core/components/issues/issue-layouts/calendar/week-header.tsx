/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky weekday label row that crowns the calendar body. Reorders day labels
 * to match the user's preferred start-of-week and hides Sat/Sun when weekends
 * are disabled in the calendar display filter.
 *
 * Props (Props type, L15-L18):
 *   - isLoading (required) — when true, shows an animated bar loader strip
 *     across the header while the underlying issue fetch is pending.
 *   - showWeekends (required) — toggles 7-column ↔ 5-column grid and skips
 *     SUNDAY/SATURDAY entries.
 *
 * Stores read:
 *   - useUserProfile().data.start_of_the_week — feeds getOrderedDays reordering.
 *
 * Side effects: NONE — pure render.
 *
 * Consumers:
 *   - ./calendar.tsx (CalendarChart) — rendered above the month/week body.
 */

import { observer } from "mobx-react";
import { EStartOfTheWeek } from "@plane/types";
import { getOrderedDays } from "@plane/utils";
import { DAYS_LIST } from "@/constants/calendar";
// helpers
// hooks
import { useUserProfile } from "@/hooks/store/user";

type Props = {
  isLoading: boolean;
  showWeekends: boolean;
};

/** Sticky weekday label strip ordered by the user's start-of-week with optional weekend hiding. */
export const CalendarWeekHeader = observer(function CalendarWeekHeader(props: Props) {
  const { isLoading, showWeekends } = props;
  // hooks
  const { data } = useUserProfile();
  const startOfWeek = data?.start_of_the_week;

  // derived
  const orderedDays = getOrderedDays(Object.values(DAYS_LIST), (item) => item.value, startOfWeek);

  return (
    <div
      className={`relative sticky top-0 z-[1] grid divide-subtle-1 text-13 font-medium md:divide-x-[0.5px] ${
        showWeekends ? "grid-cols-7" : "grid-cols-5"
      }`}
    >
      {isLoading && (
        <div className="absolute h-[1.5px] w-3/4 animate-[bar-loader_2s_linear_infinite] bg-accent-primary" />
      )}
      {orderedDays.map((day) => {
        if (!showWeekends && (day.value === EStartOfTheWeek.SUNDAY || day.value === EStartOfTheWeek.SATURDAY))
          return null;

        return (
          <div key={day.shortTitle} className="flex h-11 items-center justify-center bg-layer-1 px-4 md:justify-end">
            {day.shortTitle}
          </div>
        );
      })}
    </div>
  );
});
