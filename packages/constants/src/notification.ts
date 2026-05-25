/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Notification panel tab catalog and unread-count seed value consumed by
 * `apps/web/core/components/notifications/**` and the notification MobX store.
 */

import type { TUnreadNotificationsCount } from "@plane/types";

/**
 * Notification list top-tab — partitions the notification feed into "All" vs "Mentions".
 *
 * Consumers: `apps/web/core/components/notifications/**` notification panel header
 * and `apps/web/core/store/notifications/**` for tab-scoped queries.
 */
export enum ENotificationTab {
  ALL = "all",
  MENTIONS = "mentions",
}

/**
 * Notification filter category — narrows the feed to notifications you created,
 * are assigned to, or are subscribed to.
 *
 * Consumers: notification filter chips in `apps/web/core/components/notifications/**`.
 */
export enum ENotificationFilterType {
  CREATED = "created",
  ASSIGNED = "assigned",
  SUBSCRIBED = "subscribed",
}

/**
 * Loader-state machine identifiers (init, mutation, pagination, refresh, mark-all) driving the right spinner/skeleton for each notification lifecycle stage.
 * Consumers: `apps/web/core/store/notifications/**` loader state and panel UI in `apps/web/core/components/notifications/**`.
 */
export enum ENotificationLoader {
  INIT_LOADER = "init-loader",
  MUTATION_LOADER = "mutation-loader",
  PAGINATION_LOADER = "pagination-loader",
  REFRESH = "refresh",
  MARK_ALL_AS_READY = "mark-all-as-read",
}

/**
 * Notification cursor query identifier — distinguishes initial fetch, current refresh,
 * and next-page fetch URLs returned by the paginated notifications endpoint.
 */
export enum ENotificationQueryParamType {
  INIT = "init",
  CURRENT = "current",
  NEXT = "next",
}

/**
 * Helper union of the notification tab values (mirrors `ENotificationTab` values).
 */
export type TNotificationTab = ENotificationTab.ALL | ENotificationTab.MENTIONS;

/**
 * Tab metadata for the notification panel header — pairs each tab with its i18n
 * label and a `count` resolver that pulls the unread badge value out of the unread
 * notifications payload.
 *
 * Consumers: notification panel header in `apps/web/core/components/notifications/**`.
 */
export const NOTIFICATION_TABS = [
  {
    i18n_label: "notification.tabs.all",
    value: ENotificationTab.ALL,
    count: (unReadNotification: TUnreadNotificationsCount) => unReadNotification?.total_unread_notifications_count || 0,
  },
  {
    i18n_label: "notification.tabs.mentions",
    value: ENotificationTab.MENTIONS,
    count: (unReadNotification: TUnreadNotificationsCount) =>
      unReadNotification?.mention_unread_notifications_count || 0,
  },
];

/**
 * Filter-type options for the notification panel's filter dropdown — one entry per
 * `ENotificationFilterType` value with i18n label.
 *
 * Consumers: notification filter dropdown in `apps/web/core/components/notifications/**`.
 */
export const FILTER_TYPE_OPTIONS = [
  {
    i18n_label: "notification.filter.assigned",
    value: ENotificationFilterType.ASSIGNED,
  },
  {
    i18n_label: "notification.filter.created",
    value: ENotificationFilterType.CREATED,
  },
  {
    i18n_label: "notification.filter.subscribed",
    value: ENotificationFilterType.SUBSCRIBED,
  },
];

/**
 * Snooze duration options for the notification snooze menu — each entry returns a
 * fresh `Date` instance (or `undefined` for the "custom" entry) at click time, so
 * the timestamp is always relative to "now" when the user picks an option.
 *
 * Consumers: notification snooze menu in `apps/web/core/components/notifications/**`.
 */
export const NOTIFICATION_SNOOZE_OPTIONS = [
  {
    key: "1_day",
    i18n_label: "notification.snooze.1_day",
    value: () => {
      const date = new Date();
      return new Date(date.getTime() + 24 * 60 * 60 * 1000);
    },
  },
  {
    key: "3_days",
    i18n_label: "notification.snooze.3_days",
    value: () => {
      const date = new Date();
      return new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000);
    },
  },
  {
    key: "5_days",
    i18n_label: "notification.snooze.5_days",
    value: () => {
      const date = new Date();
      return new Date(date.getTime() + 5 * 24 * 60 * 60 * 1000);
    },
  },
  {
    key: "1_week",
    i18n_label: "notification.snooze.1_week",
    value: () => {
      const date = new Date();
      return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    },
  },
  {
    key: "2_weeks",
    i18n_label: "notification.snooze.2_weeks",
    value: () => {
      const date = new Date();
      return new Date(date.getTime() + 14 * 24 * 60 * 60 * 1000);
    },
  },
  {
    key: "custom",
    i18n_label: "notification.snooze.custom",
    value: undefined,
  },
];

// Constant for all time values in 30 minutes interval in 12 hours format
/**
 * Pre-computed 30-minute time-slot labels in 12-hour format (12:00 through 11:30),
 * used by the custom-snooze picker as a quick time-of-day chooser.
 *
 * Consumers: custom snooze datetime picker in `apps/web/core/components/notifications/**`.
 */
export const allTimeIn30MinutesInterval12HoursFormat: Array<{
  label: string;
  value: string;
}> = [
  { label: "12:00", value: "12:00" },
  { label: "12:30", value: "12:30" },
  { label: "01:00", value: "01:00" },
  { label: "01:30", value: "01:30" },
  { label: "02:00", value: "02:00" },
  { label: "02:30", value: "02:30" },
  { label: "03:00", value: "03:00" },
  { label: "03:30", value: "03:30" },
  { label: "04:00", value: "04:00" },
  { label: "04:30", value: "04:30" },
  { label: "05:00", value: "05:00" },
  { label: "05:30", value: "05:30" },
  { label: "06:00", value: "06:00" },
  { label: "06:30", value: "06:30" },
  { label: "07:00", value: "07:00" },
  { label: "07:30", value: "07:30" },
  { label: "08:00", value: "08:00" },
  { label: "08:30", value: "08:30" },
  { label: "09:00", value: "09:00" },
  { label: "09:30", value: "09:30" },
  { label: "10:00", value: "10:00" },
  { label: "10:30", value: "10:30" },
  { label: "11:00", value: "11:00" },
  { label: "11:30", value: "11:30" },
];
