/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issues subfolder barrel — re-exports issue/reaction/link/attachment/relation/
 * sub-issue/activity siblings and defines auxiliary loader + grouped +
 * cursor-paginated collection shapes consumed by `apps/web/core/store/issue/`.
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
 * Issue-list loader phase discriminant (`init-loader` / `mutation` /
 * `pagination` / `loaded` / `undefined` idle) so views can render skeletons,
 * optimistic rows, infinite-scroll spinners, or terminal data without
 * overloading a single boolean flag.
 */
export type TLoader = "init-loader" | "mutation" | "pagination" | "loaded" | undefined;

/**
 * Issue ids bucketed by a single grouping key (string-keyed so any discriminator
 * — UUID, string-coerced enum — works without leaking the grouping taxonomy);
 * the array order reflects the store's current sort, not insertion order.
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
 * Cursor pagination envelope — `nextCursor`/`prevCursor` are opaque server
 * tokens (passed back verbatim; empty when no neighbor exists), and
 * `nextPageResults` is the terminator flag for infinite-scroll loops.
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
