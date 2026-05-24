/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace notification contracts for the `@plane/types` package.
 *
 * Models the notification filter shape, paginated listing envelope, unread counts, and
 * notification reference shapes consumed by the workspace notifications panel in
 * `apps/web/core/components/workspace-notifications/`. Mirrors
 * `apps/api/plane/db/models/notification.py::Notification`. The notification
 * production pipeline (signal handlers → `notification_task` → `email_notification_task`)
 * is documented in tech spec §4.6.
 */

import type { ENotificationFilterType } from "./enums";
import type { IUserLite } from "./users";

// filters
/**
 * Filter selections applied to the workspace notifications panel.
 *
 * Fields:
 * - `type`: per-`ENotificationFilterType` boolean toggles (created / assigned / subscribed)
 *   — when all false, all types are returned (no narrowing)
 * - `snoozed`: include notifications snoozed by the user (default: false)
 * - `archived`: include archived notifications (default: false)
 * - `read`: include already-read notifications (default: true)
 */
export type TNotificationFilter = {
  type: {
    [key in ENotificationFilterType]: boolean;
  };
  snoozed: boolean;
  archived: boolean;
  read: boolean;
};

// notification payload
/**
 * Lightweight issue projection embedded in notification payloads.
 *
 * All fields are nullable to support partial/system-generated notifications that don't
 * reference a specific issue (every-field-undefined is valid for these).
 */
export type TNotificationIssueLite = {
  id: string | undefined;
  sequence_id: number | undefined;
  identifier: string | undefined;
  name: string | undefined;
  state_name: string | undefined;
  state_group: string | undefined;
};

/**
 * Structured notification payload — issue snapshot + activity that triggered it.
 *
 * Fields:
 * - `issue`: lightweight issue projection (may be undefined for non-issue notifications)
 * - `issue_activity`: the activity row that produced this notification
 *   - `verb`: discriminator for the activity type (created/updated/deleted)
 *   - `field`: name of the field that changed (undefined for non-field activities)
 *   - `old_value` / `new_value`: human-readable change strings
 */
export type TNotificationData = {
  issue: TNotificationIssueLite | undefined;
  issue_activity: {
    id: string | undefined;
    actor: string | undefined;
    field: string | undefined;
    issue_comment: string | undefined;
    verb: "created" | "updated" | "deleted";
    new_value: string | undefined;
    old_value: string | undefined;
  };
};

/**
 * Single workspace notification record.
 *
 * Fields with non-obvious semantics:
 * - `data`: structured payload (see `TNotificationData`); undefined for legacy/seeded rows
 * - `entity_identifier` / `entity_name`: generic parent reference (issue, page, etc.)
 * - `message_html` / `message` / `message_stripped`: parallel content representations
 *   (HTML for display, plain for email/digest, stripped for search)
 * - `read_at` / `archived_at` / `snoozed_till`: lifecycle timestamps; all-null means active
 * - `is_inbox_issue`: true when the notification originated from intake/inbox triage
 * - `is_mentioned_notification`: true when the notification was produced by an @-mention
 */
export type TNotification = {
  id: string;
  title: string | undefined;
  data: TNotificationData | undefined;
  entity_identifier: string | undefined;
  entity_name: string | undefined;
  /** HTML representation rendered in the notifications panel. */
  message_html: string | undefined;
  /** Plain-text representation used by email and digest pipelines. */
  message: undefined;
  /** Tag-stripped representation used for indexing and search. */
  message_stripped: undefined;
  sender: string | undefined;
  receiver: string | undefined;
  triggered_by: string | undefined;
  triggered_by_details: IUserLite | undefined;
  /** Timestamp when the recipient acknowledged the notification; null while unread. */
  read_at: string | undefined;
  /** Timestamp when the recipient archived the notification; null while active. */
  archived_at: string | undefined;
  /** Timestamp until which the notification stays hidden; null when not snoozed. */
  snoozed_till: string | undefined;
  /** True when the notification was emitted by intake/inbox triage rather than a normal issue activity. */
  is_inbox_issue: boolean | undefined;
  /** True when the notification was produced by an @-mention in a comment or description. */
  is_mentioned_notification: boolean | undefined;
  workspace: string | undefined;
  project: string | undefined;
  created_at: string | undefined;
  updated_at: string | undefined;
  created_by: string | undefined;
  updated_by: string | undefined;
};

// notification paginated information
/**
 * Query parameters accepted by the notifications listing endpoint.
 *
 * Fields:
 * - `type`: comma-separated `ENotificationFilterType` values to include
 * - `snoozed` / `archived` / `mentioned` / `read`: boolean toggles (omit = backend default)
 * - `per_page` / `cursor`: cursor-based pagination
 */
export type TNotificationPaginatedInfoQueryParams = {
  type?: string | undefined;
  snoozed?: boolean;
  archived?: boolean;
  mentioned?: boolean;
  read?: boolean;
  per_page?: number;
  cursor?: string;
};

/**
 * Paginated notifications response envelope.
 *
 * Fields with non-obvious semantics:
 * - `count`: items in the current page
 * - `total_count`: items available across all pages
 * - `grouped_by` / `sub_grouped_by`: optional grouping discriminants (typically undefined)
 */
export type TNotificationPaginatedInfo = {
  next_cursor: string | undefined;
  prev_cursor: string | undefined;
  next_page_results: boolean | undefined;
  prev_page_results: boolean | undefined;
  total_pages: number | undefined;
  extra_stats: string | undefined;
  count: number | undefined; // current paginated results count
  total_count: number | undefined; // total available results count
  results: TNotification[] | undefined;
  grouped_by: string | undefined;
  sub_grouped_by: string | undefined;
};

// notification count
/**
 * Aggregate unread counts shown in the workspace sidebar badge.
 *
 * Fields:
 * - `total_unread_notifications_count`: all unread notifications
 * - `mention_unread_notifications_count`: subset that were triggered by @-mentions
 */
export type TUnreadNotificationsCount = {
  total_unread_notifications_count: number;
  mention_unread_notifications_count: number;
};

/**
 * Lightweight notification reference used for in-app navigation.
 *
 * Captures the minimum identifiers needed to route the user to the underlying entity
 * (workspace + project + issue id) without loading the full notification payload.
 */
export type TNotificationLite = {
  workspace_slug: string | undefined;
  project_id: string | undefined;
  notification_id: string | undefined;
  issue_id: string | undefined;
  is_inbox_issue: boolean | undefined;
};
