/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue intake/inbox triage contracts for the `@plane/types` package.
 *
 * Models the inbox queue, status lifecycle (pending → accepted / declined / snoozed /
 * duplicate), submission source (in-app / external form / email), filters, sorting, and
 * pagination. Mirrors `apps/api/plane/db/models/intake.py::IntakeIssue`. Consumed by
 * `apps/web/core/store/inbox/` and `apps/web/core/components/issues/issue-modal/`.
 */

// plane types
import type { TPaginationInfo } from "./common";
import type { TIssuePriorities } from "./issues";
import type { TIssue } from "./issues/issue";

/**
 * Top-level tab in the inbox triage view.
 *
 * Values:
 * - `OPEN` ("open"): pending + snoozed (awaiting action)
 * - `CLOSED` ("closed"): accepted + declined + duplicate (resolved)
 */
export enum EInboxIssueCurrentTab {
  OPEN = "open",
  CLOSED = "closed",
}

/** Type alias for `EInboxIssueCurrentTab`. */
export type TInboxIssueCurrentTab = EInboxIssueCurrentTab;

/**
 * Lifecycle status for an inbox issue.
 *
 * Values (note: integers, not strings — these are persisted to the DB):
 * - `PENDING` (-2): awaiting triage
 * - `DECLINED` (-1): rejected by triager
 * - `SNOOZED` (0): postponed (`snoozed_till` set)
 * - `ACCEPTED` (1): promoted to a regular project issue
 * - `DUPLICATE` (2): marked as a duplicate of another issue (`duplicate_to` set)
 */
export enum EInboxIssueStatus {
  PENDING = -2,
  DECLINED = -1,
  SNOOZED = 0,
  ACCEPTED = 1,
  DUPLICATE = 2,
}

/**
 * Submission source for an inbox issue (determines `apps/api` ingestion path).
 *
 * Values:
 * - `IN_APP`: created via the in-app intake form
 * - `FORMS`: created via the external/public intake form (`apps/space`)
 * - `EMAIL`: created via the email-to-inbox endpoint
 */
export enum EInboxIssueSource {
  IN_APP = "IN_APP",
  FORMS = "FORMS",
  EMAIL = "EMAIL",
}

/** Type alias for `EInboxIssueStatus`. */
export type TInboxIssueStatus = EInboxIssueStatus;
/**
 * Single inbox queue entry — one row of the triage list returned by `apps/api`.
 *
 * Fields with non-obvious semantics:
 * - `status`: one of `EInboxIssueStatus` numeric values
 * - `snoozed_till`: target date when the snoozed item should reappear (null when not snoozed)
 * - `duplicate_to`: target issue id when status is DUPLICATE (undefined otherwise)
 * - `source`: submission source (undefined for legacy records pre-source-tracking)
 * - `duplicate_issue_detail`: hydrated reference to the canonical issue when DUPLICATE
 */
export type TInboxIssue = {
  id: string;
  status: TInboxIssueStatus;
  snoozed_till: Date | null;
  duplicate_to: string | undefined;
  source: EInboxIssueSource | undefined;
  issue: TIssue;
  created_by: string;
  duplicate_issue_detail: TInboxDuplicateIssueDetails | undefined;
};

// filters
/**
 * Member-id filter keys for inbox filtering.
 *
 * Union values: `assignees`, `created_by`.
 */
export type TInboxIssueFilterMemberKeys = "assignees" | "created_by";

/**
 * Date-range filter keys for inbox filtering.
 *
 * Union values: `created_at`, `updated_at`.
 */
export type TInboxIssueFilterDateKeys = "created_at" | "updated_at";

/**
 * Composite filter shape for the inbox view.
 *
 * Combines member-id filters (`TInboxIssueFilterMemberKeys`) + date-range filters
 * (`TInboxIssueFilterDateKeys`) + state / status / priority / labels. All filter
 * fields are optional/undefined to indicate "no filter applied for this key".
 */
export type TInboxIssueFilter = {
  [key in TInboxIssueFilterMemberKeys]: string[] | undefined;
} & {
  [key in TInboxIssueFilterDateKeys]: string[] | undefined;
} & {
  state: string[] | undefined;
  status: TInboxIssueStatus[] | undefined;
  priority: TIssuePriorities[] | undefined;
  labels: string[] | undefined;
};

// sorting filters
/** Sort axis keys: `order_by` (which field) + `sort_by` (direction). */
export type TInboxIssueSortingKeys = "order_by" | "sort_by";

/** Available sort fields (Django ORM lookup paths — `issue__*` joins to Issue model). */
export type TInboxIssueSortingOrderByKeys = "issue__created_at" | "issue__updated_at" | "issue__sequence_id";

/**
 * Sort direction.
 *
 * Union values: `asc` (ascending), `desc` (descending).
 */
export type TInboxIssueSortingSortByKeys = "asc" | "desc";

/** Sort configuration applied to the inbox query. */
export type TInboxIssueSorting = {
  order_by: TInboxIssueSortingOrderByKeys | undefined;
  sort_by: TInboxIssueSortingSortByKeys | undefined;
};

// filtering and sorting types for query params
/**
 * Wire-format sort parameter keys — leading `-` indicates descending order
 * (Django REST framework `ordering` convention).
 */
export type TInboxIssueSortingOrderByQueryParamKeys =
  | "issue__created_at"
  | "-issue__created_at"
  | "issue__updated_at"
  | "-issue__updated_at"
  | "issue__sequence_id"
  | "-issue__sequence_id";

/** Wire-format wrapper around the sort parameter. */
export type TInboxIssueSortingOrderByQueryParam = {
  order_by: TInboxIssueSortingOrderByQueryParamKeys;
};

/**
 * Full query string params for the inbox listing endpoint.
 *
 * Combines all filter keys (as comma-separated strings on the wire), the sort param,
 * and cursor-based pagination (`per_page` + `cursor`).
 */
export type TInboxIssuesQueryParams = {
  [key in keyof TInboxIssueFilter]: string;
} & TInboxIssueSortingOrderByQueryParam & {
    per_page: number;
    cursor: string;
  };

// inbox issue types

/**
 * Minimal projection of an existing issue, used when an inbox item is marked DUPLICATE
 * to render a link to the canonical issue.
 */
export type TInboxDuplicateIssueDetails = {
  id: string;
  sequence_id: string;
  name: string;
};

/**
 * Inbox-specific pagination envelope — extends `TPaginationInfo` and re-asserts
 * `total_results` as required for inbox listings.
 */
export type TInboxIssuePaginationInfo = TPaginationInfo & {
  total_results: number;
};

/** Paginated inbox listing response: pagination envelope + `results: TInboxIssue[]`. */
export type TInboxIssueWithPagination = TInboxIssuePaginationInfo & {
  results: TInboxIssue[];
};

/**
 * Map of anchor identifier → URL slug, used for the public intake form URLs.
 *
 * Each anchor corresponds to a published intake form for a specific project.
 */
export type TAnchors = { [key: string]: string };

/**
 * Inbox form configuration for a project.
 *
 * Fields:
 * - `is_in_app_enabled`: in-app intake form available to workspace members
 * - `is_form_enabled`: public/external intake form available via anchored URL
 */
export type TInboxForm = {
  anchors: TAnchors;
  id: string;
  is_in_app_enabled: boolean;
  is_form_enabled: boolean;
};

/**
 * Body fields posted by the public/external intake form.
 *
 * `username` + `email` capture the anonymous submitter's identity.
 */
export type TInboxIssueForm = {
  name: string;
  description: string;
  username: string;
  email: string;
};
