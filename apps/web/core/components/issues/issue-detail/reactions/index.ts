/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail reactions feature surface.
 *
 * Re-exports the two reaction components and their prop types from sibling files so consumers
 * import the reactions feature from one stable path:
 *
 *     import { IssueReaction, IssueCommentReaction } from "@/components/issues/issue-detail/reactions";
 *
 * Re-exported symbols:
 *   - `IssueReaction` and `TIssueReaction` (from `./issue`) — issue-level reaction component.
 *   - `IssueCommentReaction` and `TIssueCommentReaction` (from `./issue-comment`) — comment-level
 *     reaction component used by issue activity/comment surfaces.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/main-content.tsx` (imports `IssueReaction`)
 *   - `apps/web/core/components/issues/peek-overview/issue-detail.tsx` (imports `IssueReaction`)
 *
 * No runtime logic — pure barrel module.
 */

export * from "./issue";
export * from "./issue-comment";
