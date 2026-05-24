/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Emoji reaction contracts for the `@plane/types` package.
 *
 * Models reactions to issues and issue comments. Mirrors
 * `apps/api/plane/db/models/issue.py::IssueReaction` and `IssueCommentReaction`,
 * and is consumed by the reaction pill UI in `apps/web/core/components/issues/issue-detail/`.
 */

import type { IUserLite } from "./users";

/**
 * Single emoji reaction on an issue.
 *
 * Fields with non-obvious semantics:
 * - `reaction`: unicode emoji code-point string (e.g. "1f44d") identifying the emoji
 * - `actor`: id of the user who added the reaction
 * - `actor_detail`: hydrated actor profile for avatar/name rendering
 *
 * Uniqueness is enforced server-side per (issue, actor, reaction) — duplicates toggle off.
 */
export interface IIssueReaction {
  /** Id of the user who added the reaction. */
  actor: string;
  /** Hydrated actor profile for avatar/name rendering. */
  actor_detail: IUserLite;
  created_at: Date;
  created_by: string;
  id: string;
  issue: string;
  project: string;
  /** Unicode emoji code-point string (e.g. "1f44d") identifying the emoji. */
  reaction: string;
  updated_at: Date;
  updated_by: string;
  workspace: string;
}

/**
 * Request payload for adding a reaction to an issue.
 *
 * Fields:
 * - `reaction`: unicode emoji code-point string identifying the emoji to add
 */
export interface IssueReactionForm {
  reaction: string;
}

/**
 * Single emoji reaction on an issue comment.
 *
 * Mirrors `IIssueReaction` but references a comment id instead of an issue id.
 */
export interface IssueCommentReaction {
  id: string;
  created_at: Date;
  updated_at: Date;
  reaction: string;
  created_by: string;
  updated_by: string;
  project: string;
  workspace: string;
  actor: string;
  comment: string;
}

/**
 * Request payload for adding a reaction to an issue comment.
 *
 * Fields:
 * - `reaction`: unicode emoji code-point string identifying the emoji to add
 */
export interface IssueCommentReactionForm {
  reaction: string;
}
