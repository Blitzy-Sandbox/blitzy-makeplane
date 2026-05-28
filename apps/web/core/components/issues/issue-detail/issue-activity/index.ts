/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail activity panel feature.
 *
 * Re-exports the panel's public API so downstream consumers (`./main-content.tsx`, peek-overview
 * surfaces, etc.) import from one stable path:
 *
 *     import { IssueActivity, IssueActivityCommentRoot, ActivityFilter, ActivitySortRoot,
 *              IssueActivityItem } from "@/components/issues/issue-detail/issue-activity";
 *
 * Re-export surface (in source-file order):
 *   - `./root`                     — `IssueActivity`, `TActivityOperations` (the panel orchestrator)
 *   - `./activity-comment-root`    — `IssueActivityCommentRoot` (the timeline body / dispatcher)
 *   - `./activity/activity-list`   — `IssueActivityItem` (the per-activity-type dispatcher)
 *   - `./activity-filter`          — `ActivityFilter` (the reusable filter popover primitive)
 *   - `./sort-root`                — `ActivitySortRoot`, `TActivitySortRoot` (the sort toggle)
 *
 * Symbols intentionally NOT re-exported:
 *   - `./loader` (`IssueActivityLoader`) — internal-only; mounted by `IssueActivityCommentRoot`.
 *   - `./helper` (`useWorkItemCommentOperations`) — consumed only by `./root.tsx`; downstream
 *     surfaces should import it directly from `./helper` if they need the contract.
 *   - The `./activity/actions/*` sub-renderers — internal to the dispatcher.
 *
 * No runtime logic — pure barrel module. Adding a new public symbol REQUIRES a corresponding
 * `export *` statement here; the system boundary forbids re-shaping the public surface silently.
 *
 * Consumers: imported by `../main-content.tsx` (issue-detail main column), the
 * peek-overview activity panel, intake issue detail, and `epic` detail surfaces
 * that surface the work-item activity timeline.
 */

export * from "./root";

export * from "./activity-comment-root";

// activity
export * from "./activity/activity-list";
export * from "./activity-filter";

// sort
export * from "./sort-root";
