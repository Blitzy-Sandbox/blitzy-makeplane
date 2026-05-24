/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Standalone comment-reaction contracts for the issue-activity subdomain.
 *
 * Defines the persisted reaction row tying a reacting user, a parent comment, and an
 * emoji code-point together, plus two lookup-map shapes used for O(1) UI queries.
 * Distinct from the lightweight `TCommentReaction` embed in `./issue_comment.ts` —
 * this is the canonical reaction row returned by the standalone reaction endpoints.
 *
 * Mirrors `apps/api/plane/db/models/issue.py::CommentReaction` (unique on
 * `[comment, actor, reaction]`). Reaction handlers are surfaced through
 * `apps/web/core/store/issue/issue-details/comment.store.ts` — the workspace UI applies
 * reaction state via the comment store rather than fetching it standalone.
 */

/**
 * A single persisted comment-reaction row joining a user, a comment, and an emoji
 * code-point. One row per `(comment × actor × reaction)` tuple (server-side unique
 * constraint), so un-reacting deletes the row rather than toggling a flag.
 */
export type TIssueCommentReaction = {
  /** Primary key of the reaction row (UUID); used to key entries in {@link TIssueCommentReactionMap}. */
  id: string;
  /** Foreign key to the parent `TIssueComment.id` this reaction is attached to. */
  comment: string;
  /** Foreign key to the reacting user; resolve via the workspace member directory for display details. */
  actor: string;
  /**
   * Emoji code-point string in hex form (e.g. `"1f44d"` for 👍) — Plane normalizes emoji
   * as hex code-points across backend serializers and frontend renderers. Indexed alongside
   * `comment` + `actor` to enforce one-reaction-per-emoji-per-user-per-comment uniqueness.
   */
  reaction: string;
  /** Workspace FK; denormalized onto the row for cross-workspace authorization checks. */
  workspace: string;
  /** Project FK; denormalized onto the row for cross-project authorization checks. */
  project: string;
  /**
   * Audit timestamp materialized into a `Date` instance by the client deserializer — NOT
   * an ISO `string` (contrast `TIssueComment.created_at`). Treat as opaque on this type.
   */
  created_at: Date;
  /**
   * Audit timestamp materialized into a `Date` instance by the client deserializer — NOT
   * an ISO `string` (contrast `TIssueComment.updated_at`). Treat as opaque on this type.
   */
  updated_at: Date;
  /** Audit FK of the user who created the reaction row. */
  created_by: string;
  /** Audit FK of the user who last updated the reaction row. */
  updated_by: string;
  /**
   * Denormalized actor display name populated by the API (sourced from `actor.display_name`)
   * so the UI can render the reacting user's label without joining `IUserLite` — the only
   * embedded identity on the row; all other identity (`actor`, `created_by`, `updated_by`)
   * is FK-only.
   */
  display_name: string;
};

/**
 * Flat lookup of reaction records keyed by their own primary key (`reaction_id`).
 *
 * Used by the comment-reaction store as the normalized source-of-truth slice so each
 * reaction is stored once and read in O(1). The key shape is the reaction's own `id` —
 * contrast {@link TIssueCommentReactionIdMap}, which is comment-keyed for grouped
 * "which reactions on this comment?" queries over the same row set.
 */
export type TIssueCommentReactionMap = {
  [reaction_id: string]: TIssueCommentReaction;
};

/**
 * Two-level nested lookup: outer key is `comment_id`, inner key is the emoji `reaction`
 * code-point, value is the array of reaction ids matching that emoji on that comment.
 *
 * Enables "which reactions exist on this comment, grouped by emoji?" and "who reacted
 * with 👍?" queries in O(1) without scanning {@link TIssueCommentReactionMap} on every
 * render.
 */
export type TIssueCommentReactionIdMap = {
  [comment_id: string]: { [reaction: string]: string[] };
};
