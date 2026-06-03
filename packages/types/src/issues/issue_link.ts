/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue link contracts mirroring `apps/api/plane/db/models/issue.py::IssueLink`
 * and `IssueLinkSerializer`; consumed by `apps/web/core/store/issue/issue-details/link.store.ts`
 * and the `apps/web/core/components/issues/issue-detail/links/` components.
 */

/**
 * User-editable subset of `TIssueLink` used as the `data` payload for
 * `createLink` / `updateLink` calls on the issue-link store.
 */
export type TIssueLinkEditableFields = {
  /** User-provided link label; UI falls back to displaying the URL when empty. */
  title: string;
  /** External URL; format validation is performed in the form layer, not the type. */
  url: string;
};

/**
 * Persisted issue-link record returned by the backend, extending the editable
 * fields with server-managed identity, audit, and the OpenGraph metadata cache.
 */
export type TIssueLink = TIssueLinkEditableFields & {
  /** User id of the link creator; server-set on create and immutable. */
  created_by_id: string;
  /** Primary key (UUID); server-set on create. */
  id: string;
  /**
   * Best-effort OpenGraph cache populated server-side; intentionally typed
   * loosely so consumers treat `title`/`description`/`image` as optional.
   */
  metadata: any;
  /** Foreign key back to the owning `TIssue`. */
  issue_id: string;

  //need
  /** Creation timestamp; normalized from ISO-8601 to `Date` at the network boundary. */
  created_at: Date;
};

/**
 * Single-link-per-issue map used by the link store to memoize single-issue
 * fetches; multi-link listings use `TIssueLinkIdMap` plus a flat link map.
 */
export type TIssueLinkMap = {
  [issue_id: string]: TIssueLink;
};

/**
 * Normalized lookup of link ids per issue, paired with a flat
 * `Record<linkId, TIssueLink>` in the link store to preserve ordering.
 */
export type TIssueLinkIdMap = {
  [issue_id: string]: string[];
};
