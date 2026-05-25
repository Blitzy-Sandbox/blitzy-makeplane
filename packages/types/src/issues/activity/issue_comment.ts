/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-comment domain types mirroring `apps/api/plane/db/models/issue.py::IssueComment`;
 * consumed by `comment.store.ts` and `issue-detail/` UI, with separate
 * `apps/space` public-comment shapes that must NOT be consumed from
 * authenticated workspace contexts.
 */

import type { JSONContent } from "../../editor";
import type { EIssueCommentAccessSpecifier } from "../../enums";
import type { TFileSignedURLResponse } from "../../file";
import type { IUserLite } from "../../users";
import type { IWorkspaceLite } from "../../workspace";
import type {
  TIssueActivityWorkspaceDetail,
  TIssueActivityProjectDetail,
  TIssueActivityIssueDetail,
  TIssueActivityUserDetail,
} from "./base";

/**
 * Lightweight reaction embed inlined in `TIssueComment.comment_reactions`;
 * distinct from the persisted standalone `TIssueCommentReaction` row — this
 * shape inlines `actor_detail: IUserLite` so tooltips render without a second fetch.
 */
export type TCommentReaction = {
  /** Reaction row primary key (same id space as `TIssueCommentReaction.id`). */
  id: string;
  /** Emoji code-point string in hex form (e.g., `"1f44d"`). */
  reaction: string;
  /** Foreign key to the reacting user. */
  actor: string;
  /** Embedded {@link IUserLite} for inline display name + avatar without a join. */
  actor_detail: IUserLite;
};
/**
 * Full persisted comment record for the authenticated workspace UI; mirrors
 * `apps/api/plane/db/models/issue.py::IssueComment`.
 *
 * The three parallel rich-text formats (`comment_html`, `comment_stripped`, `comment_json`)
 * are kept in lockstep by the API; clients SHOULD treat them as a read-only triple and
 * write only via the editor's serialization path so the server can re-derive the others.
 */
export type TIssueComment = {
  /** Primary key of the comment row. */
  id: string;
  /** Workspace FK; required for tenant isolation. */
  workspace: string;
  /** Denormalized workspace identity embed. See {@link TIssueActivityWorkspaceDetail}. */
  workspace_detail: TIssueActivityWorkspaceDetail;
  /** Project FK. */
  project: string;
  /** Denormalized project identity. See {@link TIssueActivityProjectDetail}. */
  project_detail: TIssueActivityProjectDetail;
  /** Issue FK. */
  issue: string;
  /** Denormalized issue snapshot. See {@link TIssueActivityIssueDetail}. */
  issue_detail: TIssueActivityIssueDetail;
  /** User FK of the comment author. */
  actor: string;
  /** Denormalized author identity for avatar/display. See {@link TIssueActivityUserDetail}. */
  actor_detail: TIssueActivityUserDetail;
  /** ISO timestamp string of when the comment was first persisted. */
  created_at: string;
  /**
   * ISO timestamp of the last content edit; `undefined` for never-edited comments. A
   * non-null value is the canonical "Edited" badge signal in the UI.
   */
  edited_at?: string | undefined;
  /**
   * ISO timestamp bumped by ANY server-side write — including soft-delete and reaction
   * count mutations — so it is NOT a "content edited" signal (use `edited_at` for that).
   */
  updated_at: string;
  /** Author user FK; nullable for system-generated comments. */
  created_by: string | undefined;
  /** Last-editor user FK; nullable when never edited or when last edited by a system actor. */
  updated_by: string | undefined;
  /** Attachment metadata snapshots; typed `any[]` for legacy parity with `TIssueActivity.attachments`. */
  attachments: any[];
  /** {@link TCommentReaction} embeds; kept untyped (`any[]`) for legacy parity with the activity feed. */
  comment_reactions: any[];
  /** Plain-text projection used for search, notifications, and email render; kept in lockstep server-side. */
  comment_stripped: string;
  /** Sanitized HTML used for non-editor display contexts (notification emails, peek-overview). */
  comment_html: string;
  /**
   * TipTap document JSON consumed by the in-app editor; canonical source of truth for
   * round-trip edits. See {@link JSONContent}.
   */
  comment_json: JSONContent;
  /** ID assigned by an external system (e.g., Jira, GitHub) at import time; `undefined` for native comments. */
  external_id: string | undefined;
  /** Slug identifying the external system that produced this comment when imported. */
  external_source: string | undefined;
  /** Visibility tag (see {@link EIssueCommentAccessSpecifier}): `"INTERNAL"` for workspace-only, `"EXTERNAL"` for public deploy viewers. */
  access: EIssueCommentAccessSpecifier;
};

/**
 * Comments-panel callback contract — keeps the panel stateless so the same
 * subtree can be wired against a workspace-issue store or a draft-issue store
 * (constructed in `issue-detail/issue-activity/helper.tsx`).
 */
export type TCommentsOperations = {
  /** Copies the canonical permalink for the comment to the clipboard. */
  copyCommentLink: (commentId: string) => void;
  /**
   * Creates a new comment from a partial payload; resolves with the persisted record, or
   * `undefined` if the optimistic insert was rolled back on a server error.
   */
  createComment: (data: Partial<TIssueComment>) => Promise<Partial<TIssueComment> | undefined>;
  /** Edits an existing comment; advances `edited_at` server-side. */
  updateComment: (commentId: string, data: Partial<TIssueComment>) => Promise<void>;
  /** Soft-deletes the comment; the activity-row entry remains in the feed for audit. */
  removeComment: (commentId: string) => Promise<void>;
  /**
   * Uploads a file referenced inside the comment editor (block-aware so embed positions
   * are preserved). `commentId` is optional because uploads occur during drafting before
   * the comment is persisted; resolves to {@link TFileSignedURLResponse}.
   */
  uploadCommentAsset: (blockId: string, file: File, commentId?: string) => Promise<TFileSignedURLResponse>;
  /**
   * Duplicates an existing asset onto another comment (used when the user copy-pastes a
   * comment); resolves with the duplicated asset id.
   */
  duplicateCommentAsset: (assetId: string, commentId?: string) => Promise<{ asset_id: string }>;
  /** Records an emoji reaction by the current user on the given comment. */
  addCommentReaction: (commentId: string, reactionEmoji: string) => Promise<void>;
  /** Removes the current user's reaction with the given emoji from the given comment. */
  deleteCommentReaction: (commentId: string, reactionEmoji: string) => Promise<void>;
  /**
   * Toggle helper: adds or removes the current user's reaction based on `userReactions`
   * membership; delegates to `addCommentReaction` / `deleteCommentReaction` internally so
   * call-sites do not need to compute the toggle themselves.
   */
  react: (commentId: string, reactionEmoji: string, userReactions: string[]) => Promise<void>;
  /**
   * Lookup helper returning `{ [reactionLabel]: reactionId[] }` for a comment; backed by
   * `TIssueCommentReactionIdMap` in the store. Returns `undefined` when the comment has
   * no reactions yet.
   */
  reactionIds: (commentId: string) =>
    | {
        [reaction: string]: string[];
      }
    | undefined;
  /** Returns the reaction labels the current user has applied; drives toggle-button UI state. */
  userReactions: (commentId: string) => string[] | undefined;
  /** Formats the user-list string for a reaction tooltip (e.g., `"Alice, Bob and 3 others"`). */
  getReactionUsers: (reaction: string, reactionIds: Record<string, string[]>) => string;
};

/**
 * Normalized `comment_id → TIssueComment` lookup for O(1) store access.
 *
 * The index-signature parameter name `issue_id` is legacy and preserved per the
 * no-refactoring system boundary; the keys are comment IDs, not issue IDs.
 */
export type TIssueCommentMap = {
  [issue_id: string]: TIssueComment;
};

/**
 * `issue_id → comment_ids[]` ordered feed used to render the per-issue comments panel in
 * insertion order; pairs with {@link TIssueCommentMap} for two-hop resolution.
 */
export type TIssueCommentIdMap = {
  [issue_id: string]: string[];
};

/**
 * `apps/space` public-comment shapes — unauthenticated payloads with a
 * different field surface (`is_member`), legacy `Description` rich-text (not
 * `JSONContent`), and `Date` timestamps (not ISO strings); do NOT consume
 * from authenticated workspace contexts.
 */

/**
 * Lightweight actor identity for public comments; every field is optional because guests
 * may have partial profile data on the public deploy surface.
 */
export interface ActorDetail {
  avatar_url?: string;
  display_name?: string;
  first_name?: string;
  is_bot?: boolean;
  id?: string;
  last_name?: string;
}

/**
 * Public-comment issue snapshot embed; structurally similar to
 * {@link TIssueActivityIssueDetail} but uses the legacy {@link Description} rich-text
 * object instead of {@link JSONContent}.
 */
export interface IssueDetail {
  id: string;
  name: string;
  description: Description;
  description_html: string;
  priority: string;
  start_date: null;
  target_date: null;
  sequence_id: number;
  sort_order: number;
}

/**
 * Public-comment rich-text envelope; legacy ProseMirror-style document shape distinct
 * from the TipTap {@link JSONContent} used in the workspace UI.
 */
export interface Description {
  type: string;
  content: DescriptionContent[];
}

/**
 * Top-level node inside a {@link Description} content tree; each node carries an optional
 * {@link Attrs} bag and a list of inline children.
 */
export interface DescriptionContent {
  type: string;
  attrs?: Attrs;
  content: ContentContent[];
}

/** TipTap-compatible attribute bag; currently only carries `level` for heading nodes. */
export interface Attrs {
  level: number;
}

/** Leaf inline node carrying display `text` plus a node `type` discriminator (e.g., `"text"`). */
export interface ContentContent {
  text: string;
  type: string;
}

/**
 * Public-comment project embed; carries the public-facing project identity (cover image,
 * identifier prefix, name, icon, emoji, description) shown on the deploy app surface.
 */
export interface ProjectDetail {
  id: string;
  identifier: string;
  name: string;
  cover_image: string;
  icon_prop: null;
  emoji: string;
  description: string;
}

/**
 * Top-level public comment payload returned by the unauthenticated deploy app API.
 *
 * Diverges from the workspace {@link TIssueComment} in two notable ways: timestamps are
 * serialized as `Date` (not ISO `string`), and `access` is a loose `string` rather than
 * the strict {@link EIssueCommentAccessSpecifier} enum because the deploy serializer
 * emits the enum value as a plain string.
 */
export type TIssuePublicComment = {
  actor_detail: ActorDetail;
  /** `"INTERNAL"` or `"EXTERNAL"` — typed loosely as `string` because the deploy serializer emits a plain string. */
  access: string;
  actor: string;
  attachments: any[];
  comment_html: string;
  comment_reactions: {
    actor_detail: ActorDetail;
    comment: string;
    id: string;
    reaction: string;
  }[];
  comment_stripped: string;
  /** Serialized as `Date` here (deploy serializer) vs. ISO `string` on workspace `TIssueComment.created_at`. */
  created_at: Date;
  created_by: string;
  id: string;
  /** `true` when the current viewer is a workspace member; the UI hides member-only controls when `false`. */
  is_member: boolean;
  issue: string;
  issue_detail: IssueDetail;
  project: string;
  project_detail: ProjectDetail;
  /** Serialized as `Date` here (deploy serializer) vs. ISO `string` on workspace `TIssueComment.updated_at`. */
  updated_at: Date;
  updated_by: string;
  workspace: string;
  workspace_detail: IWorkspaceLite;
};
