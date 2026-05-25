/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * User profile catalogs — profile-page tab visibility, calendar week-start options,
 * and time-format options — consumed by `apps/web/core/components/profile/**` and
 * the user settings MobX store.
 */

// plane imports
import { EStartOfTheWeek } from "@plane/types";

/**
 * Non-admin profile tab list — restricted to the "summary" tab so viewers cannot navigate to the owner's assigned/created/subscribed/activity streams.
 * Consumers: profile tab navigation in `apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/{navbar,layout,header}.tsx`.
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
 * Admin/owner profile tab list extending `PROFILE_VIEWER_TAB` with assigned/created/subscribed/activity tabs over the owner's work-item streams.
 * Consumers: `apps/web/app/(all)/[workspaceSlug]/(projects)/profile/[userId]/{navbar,layout,header}.tsx` (spread after `PROFILE_VIEWER_TAB`).
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
 * Preference cards (`title`/`description` are i18n keys resolved at render time) for the user-preferences page; currently only `theme`, extended as new preferences ship.
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
 * Start-of-week dropdown options (Sunday → Saturday) pairing each `EStartOfTheWeek` weekday value with its English label; order must stay in lockstep with the `EStartOfTheWeek` enum.
 * Consumers: `apps/web/core/components/profile/start-of-week-preference.tsx` and the power-K preferences menu.
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
