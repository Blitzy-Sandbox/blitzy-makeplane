/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue link contracts for the `@plane/types/issues` subfolder.
 *
 * Models URLs attached to an issue — the external references rendered in
 * the issue detail "Links" panel (right sidebar). Each link record carries
 * a user-supplied title plus URL and is decorated server-side with an
 * OpenGraph metadata cache for preview rendering.
 *
 * Mirrors the backend contract defined by
 * `apps/api/plane/db/models/issue.py::IssueLink` and the corresponding
 * DRF serializer in
 * `apps/api/plane/app/serializers/issue.py::IssueLinkSerializer`. The
 * server-managed read-only fields (`id`, `created_by`, `created_at`) are
 * separated from the user-editable fields via the
 * `TIssueLinkEditableFields` split so form payloads can be typed without
 * leaking server-set state.
 *
 * Consumers:
 * - `apps/web/core/store/issue/issue-details/link.store.ts` — the MobX
 *   link store; pairs `TIssueLinkIdMap` (per-issue ordered id arrays)
 *   with a flat `Record<linkId, TIssueLink>` map for normalized state.
 * - `apps/web/core/components/issues/issue-detail/links/` — the link
 *   create/edit modal, the link list, and the per-link detail row.
 *
 * Re-exported via `./base.ts` (the folder's de-facto barrel).
 */

/**
 * Subset of `TIssueLink` fields editable by the user via the link
 * create/edit form — separated from the full record so form payloads can
 * be typed without exposing server-managed identity or audit fields.
 *
 * Used directly as the `data` shape for `createLink` / `updateLink` calls
 * on the issue-link store.
 */
export type TIssueLinkEditableFields = {
  /**
   * User-provided link label. Required by the type, but the consumer
   * falls back to displaying the URL when this is empty so the UI never
   * renders a blank row.
   */
  title: string;
  /**
   * The external URL. Format validation (`http(s)://` prefix, parseable
   * URL) is performed in the form layer rather than at the type level so
   * the type remains permissive for partial / draft form state.
   */
  url: string;
};

/**
 * Full persisted issue-link record as returned by the backend — extends
 * the editable fields with server-managed identity, audit, and the
 * OpenGraph metadata cache.
 *
 * This is the canonical shape held by the MobX link store and rendered
 * by the link list / detail row components.
 */
export type TIssueLink = TIssueLinkEditableFields & {
  /** User id of the link creator; server-set on create and immutable thereafter. */
  created_by_id: string;
  /** Primary key (UUID); server-set on create. */
  id: string;
  /**
   * OpenGraph cache populated server-side after the URL is fetched. The
   * shape depends on the upstream OG response, so the type is
   * intentionally loose (`any`) — tightening this would mis-represent the
   * best-effort nature of the cache. Consumers treat `metadata.title`,
   * `metadata.description`, and `metadata.image` as best-effort optional
   * strings and gracefully fall back when keys are missing.
   */
  metadata: any;
  /** Foreign key back to the owning `TIssue`. */
  issue_id: string;

  //need
  /**
   * Creation timestamp. Held as a parsed `Date` in the MobX store so the
   * link list can sort by recency without re-parsing; the server
   * transports this as an ISO-8601 string and the API service normalizes
   * to `Date` at the network boundary.
   */
  created_at: Date;
};

/**
 * Lookup of link records keyed by `issue_id` — used by the MobX
 * issue-link store to memoize single-issue link fetches. The key here is
 * `issue_id` and the value is a single `TIssueLink`, modeling a 1:1
 * lookup pattern used in detail views. For full per-issue link arrays
 * (the normalized-state shape) consumers pair `TIssueLinkIdMap` with a
 * flat `linkMap`.
 */
export type TIssueLinkMap = {
  [issue_id: string]: TIssueLink;
};

/**
 * Lookup of link ids by `issue_id` — the per-issue ordered id arrays
 * paired with a flat `Record<linkId, TIssueLink>` map in the link store
 * to enable normalized state plus per-issue ordering. Keeping the order
 * here (separate from the record map) lets the UI re-render when only
 * the order changes without invalidating individual link records.
 */
export type TIssueLinkIdMap = {
  [issue_id: string]: string[];
};
