/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Calendar payload contracts for the `@plane/types` package.
 *
 * Models the date/week/month/year nesting used by the issue calendar layout
 * in `apps/web/core/components/issues/issue-layouts/calendar/` to position
 * issues by their target_date.
 */

/**
 * Start/end date pair representing the inclusive visible window of a calendar view.
 *
 * Consumers: calendar layout root component for fetching issues by date range.
 */
export interface ICalendarRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Single calendar cell representing one day.
 *
 * Fields:
 * - `week`: ISO week number within the year (1–53)
 * - `is_current_month`: false for cells that overflow from adjacent months
 *   (shown in muted style)
 * - `is_current_week`: highlights the row containing today
 * - `is_today`: highlights the cell representing the current date
 */
export interface ICalendarDate {
  date: Date;
  year: number;
  month: number;
  day: number;
  week: number; // week number wrt year, eg- 51, 52
  /** True when this cell's month equals the active month being rendered; false for adjacent-month overflow cells (rendered muted). */
  is_current_month: boolean;
  /** True for every cell in the week that contains today; drives row highlighting. */
  is_current_week: boolean;
  /** True only for the cell representing today's date; drives single-cell highlight. */
  is_today: boolean;
}

/**
 * Map of dates within a single week, keyed by ISO date string (YYYY-MM-DD).
 */
export interface ICalendarWeek {
  [date: string]: ICalendarDate;
}

/**
 * Map of weeks within a single month, keyed first by month index then by week number.
 */
export interface ICalendarMonth {
  [monthIndex: string]: {
    [weekNumber: string]: ICalendarWeek;
  };
}

/**
 * Top-level calendar tree keyed by year, then month, then week, then date.
 *
 * Built once per layout instantiation by `apps/web/core/store/issue/issue_calendar_view.store.ts`
 * and consumed by all calendar-layout cells for issue placement.
 */
export interface ICalendarPayload {
  [year: string]: ICalendarMonth;
}
