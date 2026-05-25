/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { EStartOfTheWeek } from "@plane/types";

/**
 * Profile-page tab list shown to viewers (non-admins) of another user's profile —
 * exposes only the "summary" tab so non-admins cannot navigate into the profile
 * owner's assigned/created/subscribed/activity work-item streams.
 *
 * Each entry carries an i18n label key, a relative `route` segment appended to the
 * profile base URL, and a `selected` path fragment used to match the active tab.
 *
 * Consumers: profile page tab navigation in
 * `apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/{navbar,layout,header}.tsx`.
 */
export const PROFILE_VIEWER_TAB = [
  {
    key: "summary",
    route: "",
    i18n_label: "profile.tabs.summary",
    selected: "/",
  },
];

/**
 * Profile-page tab list shown to admins (or the profile owner themselves) — extends
 * `PROFILE_VIEWER_TAB` with the assigned/created/subscribed/activity tabs that
 * surface the profile owner's work-item streams.
 *
 * Consumers spread this array after `PROFILE_VIEWER_TAB` to assemble the full
 * admin tab order; see
 * `apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/{navbar,layout,header}.tsx`.
 */
export const PROFILE_ADMINS_TAB = [
  {
    key: "assigned",
    route: "assigned",
    i18n_label: "profile.tabs.assigned",
    selected: "/assigned/",
  },
  {
    key: "created",
    route: "created",
    i18n_label: "profile.tabs.created",
    selected: "/created/",
  },
  {
    key: "subscribed",
    route: "subscribed",
    i18n_label: "profile.tabs.subscribed",
    selected: "/subscribed/",
  },
  {
    key: "activity",
    route: "activity",
    i18n_label: "profile.tabs.activity",
    selected: "/activity/",
  },
];

/**
 * Preference cards rendered on the user-preferences page — each entry models one
 * configurable preference surface (currently only `theme`); new preference
 * entries (e.g., notification defaults, density) are appended to this array.
 *
 * `title` and `description` are i18n keys, not pre-translated strings — the
 * preferences page resolves them via the i18n provider at render time.
 *
 * Consumers: user preferences page in `apps/web/core/components/profile/**`.
 */
export const PREFERENCE_OPTIONS: {
  id: string;
  title: string;
  description: string;
}[] = [
  {
    id: "theme",
    title: "theme",
    description: "select_or_customize_your_interface_color_scheme",
  },
];

/**
 * Start-of-week dropdown options for the user-preferences page — pairs each
 * `EStartOfTheWeek` enum value (the numeric weekday persisted on the user
 * profile) with its English day label rendered in the dropdown.
 *
 * The order reflects the dropdown render order (Sunday → Saturday) and must
 * remain in lockstep with the `EStartOfTheWeek` enum exported from `@plane/types`.
 *
 * Consumers: `apps/web/core/components/profile/start-of-week-preference.tsx`
 * and the power-K preferences menu in
 * `apps/web/core/components/power-k/ui/pages/preferences/start-of-week-menu.tsx`.
 *
 * @description The options for the start of the week
 * @type {Array<{value: EStartOfTheWeek, label: string}>}
 * @constant
 */
export const START_OF_THE_WEEK_OPTIONS = [
  {
    value: EStartOfTheWeek.SUNDAY,
    label: "Sunday",
  },
  {
    value: EStartOfTheWeek.MONDAY,
    label: "Monday",
  },
  {
    value: EStartOfTheWeek.TUESDAY,
    label: "Tuesday",
  },
  {
    value: EStartOfTheWeek.WEDNESDAY,
    label: "Wednesday",
  },
  {
    value: EStartOfTheWeek.THURSDAY,
    label: "Thursday",
  },
  {
    value: EStartOfTheWeek.FRIDAY,
    label: "Friday",
  },
  {
    value: EStartOfTheWeek.SATURDAY,
    label: "Saturday",
  },
];
