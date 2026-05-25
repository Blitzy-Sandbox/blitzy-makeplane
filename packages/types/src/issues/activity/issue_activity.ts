/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-activity audit-trail row + normalized lookup contracts (`TIssueActivity`, `TIssueActivityMap`, `TIssueActivityIdMap`), mirroring `apps/api/plane/db/models/issue.py::IssueActivity` and produced by `apps/api/plane/bgtasks/issue_activities_task.py::issue_activity` via the `ACTIVITY_MAPPER` dispatch table.
 * Consumed by `apps/web/core/store/issue/issue-details/activity.store.ts` and the activity-feed components in `apps/web/core/components/issues/issue-detail/issue-activity/`.
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
 * Immutable audit-trail row emitted by `apps/api/plane/bgtasks/issue_activities_task.py::issue_activity` (dispatched via `ACTIVITY_MAPPER`) whenever an issue or its comments change; the activity store derives the `TIssueActivityComment` `activity_type` discriminant from these rows at render time.
 */
export type TIssueActivity = {
  /** Primary key of the activity row. */
  id: string;
  /** FK to the workspace; carried on project-scoped rows so tenant-isolation queries avoid a join. */
  workspace: string;
  /** Denormalized workspace snapshot so the feed renders workspace context without an extra join (see `./base::TIssueActivityWorkspaceDetail`). */
  workspace_detail: TIssueActivityWorkspaceDetail;
  /** FK to the project that owns the issue. */
  project: string;
  /** Denormalized project snapshot (identifier prefix, icon, cover) for in-feed rendering without an extra join (see `./base::TIssueActivityProjectDetail`). */
  project_detail: TIssueActivityProjectDetail;
  /** FK to the issue this activity row describes. */
  issue: string;
  /** Denormalized issue snapshot — the issue's CURRENT state at fetch time, NOT a point-in-time snapshot when the activity occurred (see `./base::TIssueActivityIssueDetail`). */
  issue_detail: TIssueActivityIssueDetail;
  /** FK to the user (or bot) that produced the activity. */
  actor: string;
  /** Denormalized actor identity for avatar rendering; `actor_detail.is_bot === true` flags automated activities (webhooks, automations). */
  actor_detail: TIssueActivityUserDetail;
  /** ISO-8601 timestamp of when the row was persisted. */
  created_at: string;
  /** ISO-8601 timestamp; mutated only by the rare back-fill path, never by normal user edits to the underlying issue. */
  updated_at: string;
  /** Author user FK; `undefined` when the row was system-created (signal-triggered or automation-emitted). */
  created_by: string | undefined;
  /** Editor user FK; `undefined` when the row was system-created (signal-triggered or automation-emitted). */
  updated_by: string | undefined;
  /** Attachment metadata snapshots; typed `any[]` deliberately because the legacy shape predates the typed attachment schema — do not tighten without coordinating with the activity store. */
  attachments: any[];

  /**
   * Action verb (e.g., `"created"`, `"updated"`, `"deleted"`) emitted by the `ACTIVITY_MAPPER` handlers in `apps/api/plane/bgtasks/issue_activities_task.py`; the feed picks its rendering template per row from this value.
   */
  verb: string;
  /**
   * Name of the issue field that changed (e.g., `"name"`, `"state"`, `"priority"`), populated by the relevant `ACTIVITY_MAPPER` handler in `apps/api/plane/bgtasks/issue_activities_task.py`; `undefined` for non-field-scoped activities such as issue creation.
   */
  field: string | undefined;
  /**
   * String-encoded previous value of `field` as emitted by the `ACTIVITY_MAPPER` handler in `apps/api/plane/bgtasks/issue_activities_task.py` (encoding is field-specific — display name for state, ISO date for date fields); `undefined` when not applicable to the verb.
   */
  old_value: string | undefined;
  /** String-encoded new value of `field`; same `ACTIVITY_MAPPER`-driven encoding rules as `old_value`. */
  new_value: string | undefined;
  /** Free-text annotation on the activity row itself — distinct from `TIssueComment`; this is an inline narrative attached to the row. */
  comment: string | undefined;
  /** Id-form of the old value when `field` references another entity (e.g., previous state id, previous assignee id); pairs with `old_value` which holds the displayed name. */
  old_identifier: string | undefined;
  /** Id-form of the new value; pairs with `old_identifier` for entity-reference fields. */
  new_identifier: string | undefined;
  /** Unix milliseconds used for stable client-side ordering when two activities share `created_at` (common for batched signal-emitted rows). */
  epoch: number;
  /** Nullable FK to the `TIssueComment.id` that generated this row; populated only for `activity_type === "COMMENT"` rows in the discriminated `TIssueActivityComment` projection. */
  issue_comment: string | null;
  /**
   * Provenance for activities originating from intake/import paths (e.g., inbox email, form submission); `source` follows `../../inbox::EInboxIssueSource`, `source_email` is the sender address when `source === EMAIL`, and `extra.username` carries an external handle when available.
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
 * Normalized activity-row lookup for the activity store's O(1) access by id; the index label `issue_id` is legacy naming preserved per the no-refactoring boundary — the actual keys are activity ids.
 */
export type TIssueActivityMap = {
  [issue_id: string]: TIssueActivity;
};

/**
 * Ordered activity ids per issue, paired with `TIssueActivityMap` so the store resolves a feed in two hops (issue id → activity ids → activity rows) without scanning the flat map.
 */
export type TIssueActivityIdMap = {
  [issue_id: string]: string[];
};
