/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue reaction contracts for the `@plane/types/issues` subfolder.
 *
 * Models emoji reactions attached to an issue itself (e.g. 👍, ❤️) — DISTINCT from
 * `TIssueCommentReaction` in `./activity/issue_comment_reaction.ts` (per-comment
 * reactions) and from the shared reaction primitive in `packages/types/src/reaction.ts`.
 * Two surfaces co-exist here: the authenticated workspace reaction (`TIssueReaction`)
 * and the public-page reaction (`IIssuePublicReaction`) used by the deploy/space app —
 * the latter embeds full `actor_details` because public viewers may not have access
 * to the workspace member directory. Also defines `IPublicVote`, the structurally
 * separate thumbs up/down signal on published issue pages.
 *
 * Mirrors `apps/api/plane/db/models/issue.py::IssueReaction` (unique on
 * `[issue, actor, reaction]`) and `IssueVote` (vote choices `(-1, DOWNVOTE)` /
 * `(1, UPVOTE)`). Consumed by `apps/web/core/store/issue/issue-details/reaction.store.ts`
 * and the components under `apps/web/core/components/issues/issue-detail/reactions/`.
 * Public variants flow to `apps/space` (out of scope for direct documentation, listed
 * here as their type source). Re-exported via `./base.ts` (the folder barrel).
 */

import type { IUserLite } from "../users";

/**
 * Persisted reaction record for an authenticated workspace user — joins an issue,
 * its actor (user id), and the emoji code-point string.
 *
 * One row per `(actor × issue × reaction)` tuple (server-side unique constraint on
 * `apps/api/plane/db/models/issue.py::IssueReaction`); removing a reaction deletes
 * the row rather than soft-toggling a flag.
 *
 * Field semantics:
 * - `actor`: user id of the reacting user — only the id is embedded because workspace
 *   consumers can resolve full user details from the workspace member directory
 * - `id`: reaction primary key (UUID); used to key entries in `TIssueReactionMap`
 * - `issue`: foreign key to the issue the reaction is attached to
 * - `reaction`: emoji code-point string (e.g. `"1f44d"` for 👍) — Plane normalizes
 *   emoji as hex code-points rather than raw Unicode, keeping a single canonical
 *   representation across backend serializers and frontend rendering helpers
 * - `display_name`: denormalized display name of the actor at reaction time —
 *   embedded for tooltip rendering so the UI does not need a second user fetch
 */
export type TIssueReaction = {
  actor: string;
  id: string;
  issue: string;
  reaction: string;
  display_name: string;
};

/**
 * Public-flavor reaction for the deploy/space app — embeds the full lite user
 * record instead of just an actor id because public viewers are unauthenticated
 * and have no access to the workspace member directory to resolve users later.
 *
 * Returned alongside other public-page payloads (see `IPublicIssue.reaction_items`
 * in `./issue.ts`). Distinct from `TIssueReaction`, which is workspace-scoped.
 *
 * Field semantics:
 * - `actor_details`: embedded `IUserLite` for direct tooltip rendering on public pages
 * - `reaction`: emoji code-point string (same hex format as `TIssueReaction.reaction`,
 *   e.g. `"1f44d"` for 👍)
 */
export interface IIssuePublicReaction {
  actor_details: IUserLite;
  reaction: string;
}

/**
 * Flat lookup of reaction records keyed by their primary key (`reaction_id`).
 *
 * Used by `IssueReactionStore.reactionMap` in
 * `apps/web/core/store/issue/issue-details/reaction.store.ts` as the normalized
 * source-of-truth slice — every reaction is stored once here and indexed by the
 * complementary `TIssueReactionIdMap` for `(issue, emoji) → [reaction_ids]` queries.
 */
export type TIssueReactionMap = {
  [reaction_id: string]: TIssueReaction;
};

/**
 * Two-level nested lookup: outer key is `issue_id`, inner key is the emoji
 * `reaction` code-point, value is the array of reaction ids matching that emoji
 * on that issue.
 *
 * Used by `IssueReactionStore.reactions` to answer "who reacted with 👍 on this
 * issue?" directly — without this index, every render would need to scan the flat
 * `TIssueReactionMap` and group by `(issue, reaction)` on each pass.
 */
export type TIssueReactionIdMap = {
  [issue_id: string]: { [reaction: string]: string[] };
};

/**
 * Up/down vote on a published issue page in the deploy/space app — structurally
 * separate from emoji reactions; this is the single thumbs-up / thumbs-down signal
 * tracked per `(issue, actor)` pair.
 *
 * Mirrors `apps/api/plane/db/models/issue.py::IssueVote`
 * (`choices=((-1, "DOWNVOTE"), (1, "UPVOTE"))`, unique on `[issue, actor]`).
 * Returned via `IPublicIssue.vote_items` in `./issue.ts`. Do NOT conflate with
 * `IIssuePublicReaction` — reactions are emoji + multi-valued per user, votes are
 * a single up/down per user.
 *
 * Field semantics:
 * - `vote`: literal `1` (upvote / thumbs-up) or `-1` (downvote / thumbs-down).
 *   No neutral / zero state — un-voting deletes the row entirely rather than
 *   storing `0`, which mirrors the backend's `unique_together = ["issue", "actor"]`
 *   constraint (only one vote row per user per issue).
 * - `actor_details`: embedded `IUserLite` for the voting user — full user record
 *   is embedded for the same reason as `IIssuePublicReaction`: public viewers
 *   cannot resolve users from a workspace member directory.
 */
export interface IPublicVote {
  vote: -1 | 1;
  actor_details: IUserLite;
}
