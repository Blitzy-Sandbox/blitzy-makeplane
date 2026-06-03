/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue reaction contracts mirroring `apps/api/plane/db/models/issue.py::IssueReaction`
 * (workspace) and `IssueVote` (public). Distinct from `TIssueCommentReaction` and the
 * shared reaction primitive in `packages/types/src/reaction.ts`; consumed by
 * `apps/web/core/store/issue/issue-details/reaction.store.ts` and `apps/space`.
 */

import type { IUserLite } from "../users";

/**
 * Persisted reaction for an authenticated workspace user; backend enforces a
 * uniqueness constraint on `(actor, issue, reaction)`, so un-reacting deletes
 * the row rather than toggling a flag. `reaction` is a hex emoji code-point
 * (e.g. `"1f44d"` for 👍), not the raw Unicode glyph.
 */
export type TIssueReaction = {
  actor: string;
  id: string;
  issue: string;
  reaction: string;
  display_name: string;
};

/**
 * Public-flavor reaction returned to the deploy/space app; embeds the full
 * `actor_details` because public viewers cannot resolve workspace members.
 */
export interface IIssuePublicReaction {
  actor_details: IUserLite;
  reaction: string;
}

/**
 * Flat normalized lookup of reaction records keyed by `reaction_id`, used as
 * the source-of-truth slice in `IssueReactionStore.reactionMap`.
 */
export type TIssueReactionMap = {
  [reaction_id: string]: TIssueReaction;
};

/**
 * Two-level lookup (`issue_id → emoji → reaction_ids[]`) used by
 * `IssueReactionStore.reactions` to answer per-issue per-emoji queries without
 * scanning the flat reaction map.
 */
export type TIssueReactionIdMap = {
  [issue_id: string]: { [reaction: string]: string[] };
};

/**
 * Up/down vote on a published issue page; backend choices are `(-1, "DOWNVOTE")`
 * and `(1, "UPVOTE")` with `unique_together = ["issue", "actor"]`, so there is
 * no neutral state — un-voting deletes the row.
 */
export interface IPublicVote {
  vote: -1 | 1;
  actor_details: IUserLite;
}
