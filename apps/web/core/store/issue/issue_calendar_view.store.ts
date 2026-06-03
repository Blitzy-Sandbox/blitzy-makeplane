/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue calendar view-layout store: owns the active month/week filters, the generated
 * calendar payload, and the derivations components use to render day/week cells.
 *
 * State slice:
 *   - loader: boolean (observable.ref) — calendar-fetch loader flag declared on the
 *       class; intentionally not part of `ICalendarStore` so it is an internal
 *       implementation detail rather than a consumer-facing contract.
 *   - error: any | null (observable.ref) — calendar-fetch error placeholder declared
 *       on the class; same internal-only scoping as `loader`.
 *   - calendarFilters: { activeMonthDate: Date; activeWeekDate: Date } (observable.ref)
 *       — currently selected month/week reference dates that drive every computed
 *       below.
 *   - calendarPayload: ICalendarPayload | null (observable.ref) — generated calendar
 *       week/day grid keyed by year/month/week; source of truth for the rendered grid.
 *
 * Actions:
 *   - updateCalendarFilters(filters): regenerates `calendarPayload` for the new date
 *       via `updateCalendarPayload`, then mutates `calendarFilters` inside
 *       `runInAction` so observers see one consistent transition.
 *   - updateCalendarPayload(date): calls `generateCalendarData` from `@plane/utils`
 *       with the user's `start_of_the_week` preference and replaces `calendarPayload`;
 *       returns early when no payload exists yet, so `initCalendar` must seed first.
 *   - regenerateCalendar(): clears and rebuilds `calendarPayload` from `null`; invoked
 *       when the user's start-of-week preference changes (see Reactions).
 *   - initCalendar(): constructor bootstrap that seeds `calendarPayload` with today's
 *       date so the first render has a payload to compute against.
 *
 * Computed (recompute only when their declared dependencies change):
 *   - allWeeksOfActiveMonth: ordered week map for `calendarFilters.activeMonthDate`;
 *       recomputes when `calendarPayload` or `calendarFilters.activeMonthDate` changes.
 *   - activeWeekNumber: ISO week number of `calendarFilters.activeWeekDate`;
 *       recomputes when `calendarFilters.activeWeekDate` changes.
 *   - allDaysOfActiveWeek: day map for the current week, factoring in the user's
 *       `start_of_the_week` preference; recomputes when `calendarPayload`,
 *       `calendarFilters.activeWeekDate`, or `start_of_the_week` change.
 *
 * Computed actions (computedFn from mobx-utils — memoized per argument tuple):
 *   - getStartAndEndDate(layout): returns `{ startDate, endDate }` for the active
 *       `"week"` or `"month"` layout; recomputes per `(layout)` argument tuple when
 *       its upstream computeds change.
 *
 * Reactions:
 *   - Constructor registers a `reaction()` on
 *       `rootStore.user.userProfile.data?.start_of_the_week` that calls
 *       `regenerateCalendar()` whenever the preference changes — a non-obvious
 *       side-effecting subscription installed at construction time so callers do not
 *       need to wire the dependency manually.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/calendar/base-calendar-root.tsx
 *   - apps/web/core/components/issues/issue-layouts/calendar/calendar.tsx
 *   - apps/web/core/components/issues/issue-layouts/calendar/dropdowns/months-dropdown.tsx
 *   - Accessed via apps/web/core/hooks/store/use-calendar-view.ts —
 *       `useCalendarView()` returns `context.issue.issueCalendarView`
 *   - Composed by apps/web/core/store/issue/root.store.ts as `issueCalendarView`
 */

import { observable, action, makeObservable, runInAction, computed, reaction } from "mobx";

// helpers
import { computedFn } from "mobx-utils";
import type { ICalendarPayload, ICalendarWeek } from "@plane/types";
import { EStartOfTheWeek } from "@plane/types";
import { generateCalendarData, getWeekNumberOfDate } from "@plane/utils";
// types
import type { IIssueRootStore } from "./root.store";

export interface ICalendarStore {
  calendarFilters: {
    activeMonthDate: Date;
    activeWeekDate: Date;
  };
  calendarPayload: ICalendarPayload | null;

  // action
  updateCalendarFilters: (filters: Partial<{ activeMonthDate: Date; activeWeekDate: Date }>) => void;
  updateCalendarPayload: (date: Date) => void;
  regenerateCalendar: () => void;

  // computed
  allWeeksOfActiveMonth:
    | {
        [weekNumber: string]: ICalendarWeek;
      }
    | undefined;
  activeWeekNumber: number;
  allDaysOfActiveWeek: ICalendarWeek | undefined;
  getStartAndEndDate: (layout: "week" | "month") => { startDate: string; endDate: string } | undefined;
}

export class CalendarStore implements ICalendarStore {
  loader: boolean = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any | null = null;

  // observables
  calendarFilters: { activeMonthDate: Date; activeWeekDate: Date } = {
    activeMonthDate: new Date(),
    activeWeekDate: new Date(),
  };
  calendarPayload: ICalendarPayload | null = null;
  // root store
  rootStore;

  constructor(_rootStore: IIssueRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      error: observable.ref,

      // observables
      calendarFilters: observable.ref,
      calendarPayload: observable.ref,

      // actions
      updateCalendarFilters: action,
      updateCalendarPayload: action,
      regenerateCalendar: action,

      //computed
      allWeeksOfActiveMonth: computed,
      activeWeekNumber: computed,
      allDaysOfActiveWeek: computed,
    });

    this.rootStore = _rootStore;
    this.initCalendar();

    // Watch for changes in startOfWeek preference and regenerate calendar
    reaction(
      () => this.rootStore.rootStore.user.userProfile.data?.start_of_the_week,
      () => {
        // Regenerate calendar when startOfWeek preference changes
        this.regenerateCalendar();
      }
    );
  }

  get allWeeksOfActiveMonth() {
    if (!this.calendarPayload) return undefined;

    const { activeMonthDate } = this.calendarFilters;

    const year = activeMonthDate.getFullYear();
    const month = activeMonthDate.getMonth();

    // Get the weeks for the current month
    const weeks = this.calendarPayload[`y-${year}`][`m-${month}`];

    // If no weeks exist, return undefined
    if (!weeks) return undefined;

    // Create a new object to store the reordered weeks
    const reorderedWeeks: { [weekNumber: string]: ICalendarWeek } = {};

    // Get all week numbers and sort them
    const weekNumbers = Object.keys(weeks).map((key) => parseInt(key.replace("w-", "")));
    weekNumbers.sort((a, b) => a - b);

    // Reorder weeks based on start_of_week
    weekNumbers.forEach((weekNumber) => {
      const weekKey = `w-${weekNumber}`;
      reorderedWeeks[weekKey] = weeks[weekKey];
    });

    return reorderedWeeks;
  }

  get activeWeekNumber() {
    return getWeekNumberOfDate(this.calendarFilters.activeWeekDate);
  }

  get allDaysOfActiveWeek() {
    if (!this.calendarPayload) return undefined;

    const { activeWeekDate } = this.calendarFilters;
    const year = activeWeekDate.getFullYear();
    const month = activeWeekDate.getMonth();
    const dayOfMonth = activeWeekDate.getDate();

    // Check if calendar data exists for this year and month
    const yearData = this.calendarPayload[`y-${year}`];
    if (!yearData) return undefined;

    const monthData = yearData[`m-${month}`];
    if (!monthData) return undefined;

    // Calculate firstDayOfMonth offset (same logic as calendar generation)
    const startOfWeek = this.rootStore?.rootStore?.user?.userProfile?.data?.start_of_the_week ?? EStartOfTheWeek.SUNDAY;
    const firstDayOfMonthRaw = new Date(year, month, 1).getDay();
    const firstDayOfMonth = (firstDayOfMonthRaw - startOfWeek + 7) % 7;

    // Calculate which sequential week this date falls into
    const weekIndex = Math.floor((dayOfMonth - 1 + firstDayOfMonth) / 7);

    const weekKey = `w-${weekIndex}`;
    if (!(weekKey in monthData)) {
      return undefined;
    }
    return monthData[weekKey];
  }

  getStartAndEndDate = computedFn((layout: "week" | "month") => {
    switch (layout) {
      case "week": {
        if (!this.allDaysOfActiveWeek) return;
        const dates = Object.keys(this.allDaysOfActiveWeek);
        return { startDate: dates[0], endDate: dates[dates.length - 1] };
      }
      case "month": {
        if (!this.allWeeksOfActiveMonth) return;
        const weeks = Object.keys(this.allWeeksOfActiveMonth);
        const firstWeekDates = Object.keys(this.allWeeksOfActiveMonth[weeks[0]]);
        const lastWeekDates = Object.keys(this.allWeeksOfActiveMonth[weeks[weeks.length - 1]]);

        return { startDate: firstWeekDates[0], endDate: lastWeekDates[lastWeekDates.length - 1] };
      }
    }
  });

  updateCalendarFilters = (filters: Partial<{ activeMonthDate: Date; activeWeekDate: Date }>) => {
    this.updateCalendarPayload(filters.activeMonthDate || filters.activeWeekDate || new Date());

    runInAction(() => {
      this.calendarFilters = {
        ...this.calendarFilters,
        ...filters,
      };
    });
  };

  updateCalendarPayload = (date: Date) => {
    if (!this.calendarPayload) return null;

    const nextDate = new Date(date);
    const startOfWeek = this.rootStore.rootStore.user.userProfile.data?.start_of_the_week ?? EStartOfTheWeek.SUNDAY;

    runInAction(() => {
      this.calendarPayload = generateCalendarData(this.calendarPayload, nextDate, startOfWeek);
    });
  };

  initCalendar = () => {
    const startOfWeek = this.rootStore.rootStore.user.userProfile.data?.start_of_the_week ?? EStartOfTheWeek.SUNDAY;
    const newCalendarPayload = generateCalendarData(null, new Date(), startOfWeek);

    runInAction(() => {
      this.calendarPayload = newCalendarPayload;
    });
  };

  /**
   * Force complete regeneration of calendar data
   * This should be called when startOfWeek preference changes
   */
  regenerateCalendar = () => {
    const startOfWeek = this.rootStore.rootStore.user.userProfile.data?.start_of_the_week ?? EStartOfTheWeek.SUNDAY;
    const { activeMonthDate } = this.calendarFilters;

    // Force complete regeneration by passing null to clear all cached data
    const newCalendarPayload = generateCalendarData(null, activeMonthDate, startOfWeek);

    runInAction(() => {
      this.calendarPayload = newCalendarPayload;
    });
  };
}
