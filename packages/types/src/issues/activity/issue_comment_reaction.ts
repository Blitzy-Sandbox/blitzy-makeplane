/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Standalone comment-reaction contracts mirroring `CommentReaction` in
 * `apps/api/plane/db/models/issue.py` (unique on `[comment, actor, reaction]`);
 * distinct from the lightweight `TCommentReaction` embed in `./issue_comment.ts`.
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
 * Flat normalized lookup of reaction records keyed by `reaction_id`; contrast
 * {@link TIssueCommentReactionIdMap}, which groups the same rows by comment + emoji.
 */
export type TIssueCommentReactionMap = {
  [reaction_id: string]: TIssueCommentReaction;
};

/**
 * Two-level lookup (outer `comment_id` → inner emoji `reaction` → reaction id
 * array) enabling O(1) "which reactions exist on this comment, grouped by
 * emoji?" queries without scanning `TIssueCommentReactionMap`.
 */
export type TIssueCommentReactionIdMap = {
  [comment_id: string]: { [reaction: string]: string[] };
};
