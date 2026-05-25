/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Intake/inbox issue review vocabulary (status pills, source/order options)
 * consumed by `apps/web/core/components/inbox/**` and the intake MobX store.
 */

import type { TInboxIssueStatus } from "@plane/types";
import { EInboxIssueStatus } from "@plane/types";

/**
 * Pairs each `EInboxIssueStatus` with i18n title/description keys for status pills; `i18n_description` is a function so callers can lazily resolve per render context.
 * Consumers: `apps/web/core/components/inbox/inbox-issue-status.tsx` and `inbox-filter/{filters,applied-filters}/status.tsx`.
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
 * Order-by field options whose `key` values are Django ORM lookups accepted by the inbox list API (created_at / updated_at / sequence_id).
 * Consumers: `apps/web/core/components/inbox/inbox-filter/sorting/order-by.tsx`.
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
 * Sort direction options paired with `INBOX_ISSUE_ORDER_BY_OPTIONS` to compose the inbox sort query.
 * Consumers: `apps/web/core/components/inbox/inbox-filter/sorting/order-by.tsx`.
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
 * Relative past-duration tokens (today, yesterday, rolling 7/30-day windows) for the inbox "recent activity" filter.
 * Consumers: `apps/web/core/store/inbox/project-inbox.store.ts` and the date-range resolver in `packages/utils/src/intake.ts`.
 */
export enum EPastDurationFilters {
  TODAY = "today",
  YESTERDAY = "yesterday",
  LAST_7_DAYS = "last_7_days",
  LAST_30_DAYS = "last_30_days",
}

/**
 * Dropdown option list for the past-duration filter UI, pairing display `name` with the `EPastDurationFilters` token persisted in filter state.
 * Consumers: `apps/web/core/components/inbox/inbox-filter/{filters,applied-filters}/date.tsx`.
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
