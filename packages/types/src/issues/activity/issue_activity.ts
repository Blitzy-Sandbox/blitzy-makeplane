/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-activity record contracts for the activity-feed audit trail.
 *
 * Defines the persisted activity row (`TIssueActivity`) shown in the issue
 * detail activity feed, plus the normalized lookup-map shapes used by the
 * store to avoid array scans during render.
 *
 * Mirrors `apps/api/plane/db/models/issue.py::IssueActivity`. Consumed by
 * `apps/web/core/store/issue/issue-details/activity.store.ts` and the
 * activity-feed components under
 * `apps/web/core/components/issues/issue-detail/issue-activity/`.
 */

// local imports
import type { EInboxIssueSource } from "../../inbox";
import type {
  TIssueActivityWorkspaceDetail,
  TIssueActivityProjectDetail,
  TIssueActivityIssueDetail,
  TIssueActivityUserDetail,
} from "./base";

/**
 * One immutable audit-trail row produced by the API whenever an issue or
 * its comments change; the activity feed renders these rows in order.
 *
 * This shape is the structural source for the discriminated
 * `TIssueActivityComment` union in `./base` — the `activity_type`
 * discriminant is computed by the activity store from these rows, it is
 * not persisted on the row itself.
 */
export type TIssueActivity = {
  /** Primary key of the activity row. */
  id: string;
  /**
   * Foreign key to the workspace; carried even on project-scoped
   * activities so tenant-isolation queries do not need a join.
   */
  workspace: string;
  /**
   * Denormalized workspace snapshot embedded by the API so the feed can
   * render workspace context without an extra join.
   * See `./base::TIssueActivityWorkspaceDetail`.
   */
  workspace_detail: TIssueActivityWorkspaceDetail;
  /** Foreign key to the project that owns the issue. */
  project: string;
  /**
   * Denormalized project snapshot (identifier prefix, icon, cover) so
   * the feed can render project context without an extra join.
   * See `./base::TIssueActivityProjectDetail`.
   */
  project_detail: TIssueActivityProjectDetail;
  /** Foreign key to the issue this activity row describes. */
  issue: string;
  /**
   * Denormalized issue snapshot for in-feed rendering — note this is
   * the issue's CURRENT state at fetch time, NOT a point-in-time
   * snapshot captured when the activity occurred.
   * See `./base::TIssueActivityIssueDetail`.
   */
  issue_detail: TIssueActivityIssueDetail;
  /** Foreign key to the user (or bot) that produced the activity. */
  actor: string;
  /**
   * Denormalized actor identity for avatar/display rendering;
   * `actor_detail.is_bot=true` flags automated activities (webhooks,
   * automations) so the feed can badge them distinctly.
   * See `./base::TIssueActivityUserDetail`.
   */
  actor_detail: TIssueActivityUserDetail;
  /** ISO-8601 timestamp string of when the activity row was persisted. */
  created_at: string;
  /**
   * ISO-8601 timestamp string; mutated only by the rare back-fill path,
   * never by normal user edits to the underlying issue.
   */
  updated_at: string;
  /**
   * Author user FK; `undefined` when the row was system-created
   * (e.g., signal-triggered, automation-emitted).
   */
  created_by: string | undefined;
  /**
   * Editor user FK; `undefined` when the row was system-created
   * (e.g., signal-triggered, automation-emitted).
   */
  updated_by: string | undefined;
  /**
   * Attachment metadata snapshots associated with the activity. Typed
   * `any[]` deliberately because the legacy shape predates the typed
   * attachment schema and is consumed loosely by the activity store —
   * do not tighten without coordinating with that store.
   */
  attachments: any[];

  /**
   * Action verb (e.g., `"created"`, `"updated"`, `"deleted"`); the feed
   * uses this to pick the rendering template per activity row.
   */
  verb: string;
  /**
   * Name of the issue field that changed (e.g., `"name"`, `"state"`,
   * `"priority"`); `undefined` for activities that are not field-scoped
   * such as issue creation.
   */
  field: string | undefined;
  /**
   * String-encoded previous value of `field`; encoding is field-specific
   * (display name for state, ISO date for date fields). `undefined` when
   * not applicable to the activity verb.
   */
  old_value: string | undefined;
  /** String-encoded new value of `field`; same encoding rules as `old_value`. */
  new_value: string | undefined;
  /**
   * Free-text annotation attached to the activity row itself — NOT the
   * same as a `TIssueComment`; this is an inline narrative on the row.
   */
  comment: string | undefined;
  /**
   * Id-form of the old value when `field` references another entity
   * (e.g., previous state id, previous assignee id). Distinguishes
   * "what changed" (identifier) from "what name was displayed"
   * (`old_value`).
   */
  old_identifier: string | undefined;
  /** Id-form of the new value; pairs with `old_identifier` for entity-reference fields. */
  new_identifier: string | undefined;
  /**
   * Unix milliseconds; used for client-side stable ordering when two
   * activities share `created_at` (timestamp ties are common for
   * batched signal-emitted activities).
   */
  epoch: number;
  /**
   * Nullable FK to the `TIssueComment.id` that generated this activity;
   * populated only for `activity_type === "COMMENT"` rows in the
   * discriminated `TIssueActivityComment` projection.
   */
  issue_comment: string | null;
  /**
   * Provenance for activities originating from intake/import paths
   * (e.g., inbox-email-to-issue, form submission). The object is always
   * present, but its inner fields are populated only for non-in-app
   * sources:
   *
   * - `source` — origin channel; see `../../inbox::EInboxIssueSource`.
   * - `source_email` — preserved sender address when `source === EMAIL`.
   * - `extra.username` — preserved external username when available
   *   (e.g., Slack handle, form submitter name).
   */
  source_data: {
    source: EInboxIssueSource;
    source_email?: string;
    extra: {
      username?: string;
    };
  };
};

/**
 * Normalized lookup of activity rows keyed by activity id, used by the
 * activity store for O(1) access by id.
 *
 * The index parameter is labeled `issue_id` for historical reasons, but
 * the actual keys ARE activity ids — the label is legacy naming and is
 * preserved as-is per the no-refactoring system boundary.
 */
export type TIssueActivityMap = {
  [issue_id: string]: TIssueActivity;
};

/**
 * Ordered list of activity ids per issue, used to render the per-issue
 * activity feed in insertion order.
 *
 * Pairs with `TIssueActivityMap`: the store resolves a feed in two hops
 * (issue id → activity ids → activity rows) without scanning the flat
 * map.
 */
export type TIssueActivityIdMap = {
  [issue_id: string]: string[];
};
