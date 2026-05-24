/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/issues` subfolder.
 *
 * Re-exports the canonical issue domain types from sibling files:
 *  - `./issue` (TBaseIssue, TIssue, EIssueLayoutTypes, EIssuesStoreType, …)
 *  - `./issue_reaction` (TIssueReaction, IIssuePublicReaction, IPublicVote, …)
 *  - `./issue_link` (TIssueLink, TIssueLinkEditableFields, …)
 *  - `./issue_attachment` (TIssueAttachment, TIssueAttachmentUploadResponse, …)
 *  - `./issue_relation` (TIssueRelation, TIssueRelationTypes, …)
 *  - `./issue_sub_issues` (TIssueSubIssues, TSubIssueResponse, …)
 *  - `./activity/base` (issue activity / comment / reaction surface)
 *
 * In addition to the re-exports, this module defines the auxiliary
 * collection / pagination / loader shapes used by the MobX issue stores
 * under `apps/web/core/store/issue/` to model grouped, sub-grouped, and
 * cursor-paginated issue lists keyed by group id.
 *
 * Consumer: re-exported transitively by `packages/types/src/index.ts` —
 * a pre-existing TODO marker on that re-export line references the
 * `refactor/mobx-store-issue` branch and is intentionally left untouched
 * (out of scope for this documentation work).
 */

// issues
export * from "./issue";
export * from "./issue_reaction";
export * from "./issue_link";
export * from "./issue_attachment";
export * from "./issue_relation";
export * from "./issue_sub_issues";
export * from "./activity/base";

/**
 * Discriminated state for MobX issue-list loaders — represents the loading
 * phase of a grouped / sub-grouped issue request so that views can render
 * skeletons, optimistic rows, infinite-scroll spinners, or terminal data
 * without overloading a single boolean flag.
 *
 * Values:
 *  - `"init-loader"` — initial empty-state fetch (no cached data yet).
 *  - `"mutation"`    — optimistic create / update / delete is in-flight.
 *  - `"pagination"`  — next-page fetch is being appended to an existing list.
 *  - `"loaded"`      — terminal success state; data is ready to render.
 *  - `undefined`     — idle / never requested (also the initial field value).
 *
 * Consumer: `apps/web/core/store/issue/**\/*.store.ts` (project, workspace,
 * workspace-draft, profile, archived, cycle, module, issue-details stores).
 */
export type TLoader = "init-loader" | "mutation" | "pagination" | "loaded" | undefined;

/**
 * Issue ids bucketed by a single grouping key (state group, priority,
 * assignee, label, …). Stored as a string→string[] index signature so a
 * group can be addressed by an arbitrary string discriminator (a uuid or a
 * string-coerced enum value) without leaking the grouping taxonomy into the
 * type itself.
 *
 * The `string[]` value is the order-preserving list of issue ids for that
 * group — order reflects the store's current sort, not insertion order.
 *
 * Consumer: kanban, list, calendar layouts in
 * `apps/web/core/components/issues/issue-layouts/`.
 */
export type TGroupedIssues = {
  [group_id: string]: string[];
};

/**
 * Two-level nested grouping (e.g., state group → assignee) used by the
 * spreadsheet and kanban layouts that support sub-grouping. The outer key
 * is the primary group id; the inner value is a {@link TGroupedIssues}
 * keyed by the secondary group id.
 */
export type TSubGroupedIssues = {
  [sub_grouped_id: string]: TGroupedIssues;
};

/**
 * Union of {@link TGroupedIssues} and {@link TSubGroupedIssues}, used
 * wherever a layout may switch between single- and two-level grouping at
 * runtime so consumers can branch on the structural shape rather than on
 * a separate "isSubGrouped" flag.
 */
export type TIssues = TGroupedIssues | TSubGroupedIssues;

/**
 * Cursor-based pagination envelope returned alongside paged issue list
 * responses. The cursors are opaque server-issued strings — callers must
 * treat them as black-box tokens and pass them back verbatim to the next
 * request.
 *
 * Fields:
 *  - `nextCursor`      — opaque cursor for the next page; empty string when
 *                        no next page exists.
 *  - `prevCursor`      — opaque cursor for the prior page.
 *  - `nextPageResults` — `true` when more results exist beyond `nextCursor`;
 *                        used to terminate infinite-scroll loops.
 */
export type TPaginationData = {
  nextCursor: string;
  prevCursor: string;
  nextPageResults: boolean;
};

/**
 * Per-group pagination state keyed by `group_id` — each group paginates
 * independently so partially-loaded groups can be tracked and resumed
 * separately (a kanban column reaching end-of-list does not stop the
 * adjacent columns from fetching).
 */
export type TIssuePaginationData = {
  [group_id: string]: TPaginationData;
};

/**
 * Total issue count per group id — used to render group headers
 * (e.g., "Loaded 12 of 50") and infinite-scroll terminators without
 * forcing the store to hold every issue id in memory.
 */
export type TGroupedIssueCount = {
  [group_id: string]: number;
};

/**
 * Flat ordered list of issue ids when no grouping is applied — the
 * fallback shape used by ungrouped list views and ungrouped pagination.
 */
export type TUnGroupedIssues = string[];
