/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TInboxIssueStatus } from "@plane/types";
import { EInboxIssueStatus } from "@plane/types";

/**
 * Inbox/intake issue status catalog — pairs each `EInboxIssueStatus` value with its
 * i18n title/description keys for rendering status pills and review CTAs.
 *
 * Consumers: `apps/web/core/components/inbox/inbox-issue-status.tsx` for the status
 * pill, and `apps/web/core/components/inbox/inbox-filter/{filters,applied-filters}/status.tsx`
 * for status filter dropdowns. The `i18n_description` field is a function so callers
 * can lazily resolve the translation key per render context.
 */
export const INBOX_STATUS: {
  key: string;
  status: TInboxIssueStatus;
  i18n_title: string;
  i18n_description: () => string;
}[] = [
  {
    key: "pending",
    i18n_title: "inbox_issue.status.pending.title",
    status: EInboxIssueStatus.PENDING,
    i18n_description: () => `inbox_issue.status.pending.description`,
  },
  {
    key: "declined",
    i18n_title: "inbox_issue.status.declined.title",
    status: EInboxIssueStatus.DECLINED,
    i18n_description: () => `inbox_issue.status.declined.description`,
  },
  {
    key: "snoozed",
    i18n_title: "inbox_issue.status.snoozed.title",
    status: EInboxIssueStatus.SNOOZED,
    i18n_description: () => `inbox_issue.status.snoozed.description`,
  },
  {
    key: "accepted",
    i18n_title: "inbox_issue.status.accepted.title",
    status: EInboxIssueStatus.ACCEPTED,
    i18n_description: () => `inbox_issue.status.accepted.description`,
  },
  {
    key: "duplicate",
    i18n_title: "inbox_issue.status.duplicate.title",
    status: EInboxIssueStatus.DUPLICATE,
    i18n_description: () => `inbox_issue.status.duplicate.description`,
  },
];

/**
 * Order-by field options for the inbox issue list (created_at / updated_at / sequence_id).
 *
 * Consumers: `apps/web/core/components/inbox/inbox-filter/sorting/order-by.tsx` —
 * the sort field selector dropdown. `key` values are the Django ORM lookups
 * accepted by the inbox list API; `i18n_label` is the i18n key for the visible label.
 */
export const INBOX_ISSUE_ORDER_BY_OPTIONS = [
  {
    key: "issue__created_at",
    i18n_label: "inbox_issue.order_by.created_at",
  },
  {
    key: "issue__updated_at",
    i18n_label: "inbox_issue.order_by.updated_at",
  },
  {
    key: "issue__sequence_id",
    i18n_label: "inbox_issue.order_by.id",
  },
];

/**
 * Sort direction options (ascending / descending) for the inbox issue list.
 *
 * Consumers: `apps/web/core/components/inbox/inbox-filter/sorting/order-by.tsx` —
 * paired with `INBOX_ISSUE_ORDER_BY_OPTIONS` to compose the inbox sort query.
 */
export const INBOX_ISSUE_SORT_BY_OPTIONS = [
  {
    key: "asc",
    i18n_label: "common.sort.asc",
  },
  {
    key: "desc",
    i18n_label: "common.sort.desc",
  },
];

/**
 * Relative past-duration filter tokens used by the inbox "filter by recent activity" control.
 *
 * Consumers: `apps/web/core/store/inbox/project-inbox.store.ts` (filter state) and
 * `packages/utils/src/intake.ts` (date-range resolver that maps each token to a
 * concrete start/end timestamp).
 *
 * Values:
 * - TODAY (`"today"`): today only
 * - YESTERDAY (`"yesterday"`): yesterday only
 * - LAST_7_DAYS (`"last_7_days"`) / LAST_30_DAYS (`"last_30_days"`):
 *   rolling 7/30-day windows ending today
 */
export enum EPastDurationFilters {
  TODAY = "today",
  YESTERDAY = "yesterday",
  LAST_7_DAYS = "last_7_days",
  LAST_30_DAYS = "last_30_days",
}

/**
 * Dropdown option list paired with `EPastDurationFilters` for the past-duration filter UI.
 *
 * Consumers: `apps/web/core/components/inbox/inbox-filter/filters/date.tsx` (option
 * picker) and `apps/web/core/components/inbox/inbox-filter/applied-filters/date.tsx`
 * (applied-filter chip). `name` is the user-visible label; `value` is the
 * `EPastDurationFilters` token persisted in filter state.
 */
export const PAST_DURATION_FILTER_OPTIONS: {
  name: string;
  value: string;
}[] = [
  {
    name: "Today",
    value: EPastDurationFilters.TODAY,
  },
  {
    name: "Yesterday",
    value: EPastDurationFilters.YESTERDAY,
  },
  {
    name: "Last 7 days",
    value: EPastDurationFilters.LAST_7_DAYS,
  },
  {
    name: "Last 30 days",
    value: EPastDurationFilters.LAST_30_DAYS,
  },
];
