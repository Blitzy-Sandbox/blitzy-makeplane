/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module + shared embed shapes for the issue-activity domain.
 *
 * Re-exports `./issue_activity`, `./issue_comment`, and
 * `./issue_comment_reaction` so consumers can import every activity-domain
 * type from a single path.
 *
 * Additionally declares the four denormalized detail-embed shapes
 * (`workspace_detail`, `project_detail`, `issue_detail`, `actor_detail`) that
 * are inlined inside `TIssueActivity` and `TIssueComment` records, plus the
 * discriminated `TIssueActivityComment` union consumed by the activity-feed
 * renderer.
 *
 * Mirrors the denormalized snapshots emitted by
 * `apps/api/plane/db/models/issue.py::IssueActivity`. Consumed by
 * `apps/web/core/store/issue/issue-details/activity.store.ts` and the
 * components under `apps/web/core/components/issues/issue-detail/issue-activity/`.
 */

export * from "./issue_activity";
export * from "./issue_comment";
export * from "./issue_comment_reaction";

import type { TIssuePriorities } from "../../issues";

// root types
/**
 * Denormalized workspace identity embed inlined on activity rows so the UI
 * can render workspace context (name + slug + id) without a join back to
 * the workspace store.
 */
export type TIssueActivityWorkspaceDetail = {
  /** Workspace display name. */
  name: string;
  /** Workspace URL slug; used to build links back to the workspace. */
  slug: string;
  /** Workspace primary key (UUID). */
  id: string;
};

/**
 * Denormalized project identity embed carrying the public-facing fields
 * needed to render the project chip on an activity row (identifier prefix,
 * name, cover image, icon / emoji, description) without a project-store
 * join.
 */
export type TIssueActivityProjectDetail = {
  /** Project primary key (UUID). */
  id: string;
  /** Short project prefix used in issue keys (e.g., `"PLN"` for `PLN-123`). */
  identifier: string;
  /** Project display name. */
  name: string;
  /** URL string of the project banner / cover image. */
  cover_image: string;
  /** Project description (nullable when the project has no description set). */
  description: string | null;
  /**
   * Project emoji code-point string. Mutually exclusive with `icon_prop` in
   * the UI: when `icon_prop` is non-null the icon renders, otherwise the
   * UI falls back to `emoji`, then to the project initial when both are null.
   */
  emoji: string | null;
  /**
   * Nullable `{ name, color }` icon-component descriptor (Lucide-style icon
   * name + hex color). Mutually exclusive with `emoji`: when set, the UI
   * renders the icon and ignores `emoji`.
   */
  icon_prop: {
    name: string;
    color: string;
  } | null;
};

/**
 * Denormalized issue snapshot inlined on `TIssueActivity` rows for in-feed
 * issue rendering. Deliberately a partial snapshot — does NOT carry
 * assignees, labels, cycles, or modules; consumers needing those joins
 * must hydrate the full issue via the issue store.
 */
export type TIssueActivityIssueDetail = {
  /** Issue primary key (UUID). */
  id: string;
  /** Per-project monotonically increasing issue number (renders as `PLN-{sequence_id}`). */
  sequence_id: number;
  /**
   * Typed as `boolean` here for legacy reasons — the runtime value is a
   * numeric float (drag-and-drop ordering key) everywhere else. Preserved
   * as a `boolean` per the no-restructuring system boundary; do not rely
   * on this static type for ordering logic.
   */
  sort_order: boolean;
  /** Issue title. */
  name: string;
  /** Sanitized HTML projection of the issue description for in-feed render. */
  description_html: string;
  /** Issue priority discriminant; see `../../issues::TIssuePriorities`. */
  priority: TIssuePriorities;
  /** ISO date string (or empty string when unset). */
  start_date: string;
  /** ISO date string (or empty string when unset). */
  target_date: string;
  /** `true` when the issue is in the draft state and excluded from public feeds. */
  is_draft: boolean;
};

/**
 * Denormalized actor identity embed used for avatar + display-name
 * rendering on activity rows. The `is_bot` flag lets the UI render a bot
 * badge instead of a user avatar for automated (webhook / automation)
 * events.
 */
export type TIssueActivityUserDetail = {
  /** Actor user primary key (UUID). */
  id: string;
  /** Actor first name. */
  first_name: string;
  /** Actor last name. */
  last_name: string;
  /** Avatar image URL (empty string when no avatar has been uploaded). */
  avatar_url: string;
  /**
   * `true` when the activity was produced by a service / integration rather
   * than a human user. Drives the bot-badge branch in the avatar renderer.
   */
  is_bot: boolean;
  /** Canonical display label (handles both human users and named bots). */
  display_name: string;
};

/**
 * Discriminated union consumed by the activity-feed renderer at
 * `apps/web/core/components/issues/issue-detail/issue-activity/` to pick
 * the row component per activity kind. Each arm carries the same thin
 * envelope (`id` + optional `created_at`); the structural redundancy is
 * intentional so the UI can exhaustive-switch on `activity_type` and mount
 * a distinct React component per kind (state chip, assignee diff, plain
 * comment, worklog row, etc.) — do not collapse this into a single object
 * with a `kind` field.
 */
export type TIssueActivityComment =
  /**
   * User-authored text comment row; renders the `TIssueComment` content
   * loaded from the comment store.
   */
  | {
      id: string;
      activity_type: "COMMENT";
      created_at?: string;
    }
  /**
   * Generic field-change activity row; renders `verb` / `field` /
   * `old_value` / `new_value` from the corresponding `TIssueActivity`.
   */
  | {
      id: string;
      activity_type: "ACTIVITY";
      created_at?: string;
    }
  /**
   * State-transition activity; special-rendered with a state-color chip
   * pulled from the project state store.
   */
  | {
      id: string;
      activity_type: "STATE";
      created_at?: string;
    }
  /**
   * Assignee add / remove activity; special-rendered with an avatar diff
   * (old assignee → new assignee).
   */
  | {
      id: string;
      activity_type: "ASSIGNEE";
      created_at?: string;
    }
  /**
   * Fallback category for un-categorized activities; renders the verb only.
   */
  | {
      id: string;
      activity_type: "DEFAULT";
      created_at?: string;
    }
  /**
   * Worklog entry row; renders the time-tracking activity card showing
   * logged minutes / hours from the worklog feature.
   */
  | {
      id: string;
      activity_type: "WORKLOG";
      created_at?: string;
    }
  /**
   * Change to a custom issue property surfaced by the issue-types feature;
   * renders via the issue-additional-properties activity row.
   */
  | {
      id: string;
      activity_type: "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY";
      created_at?: string;
    };
