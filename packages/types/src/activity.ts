/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Generic activity-log entry contracts for the `@plane/types` package.
 *
 * Provides parameterized base activity row shapes used by workspace/project/issue
 * activity feeds rendered in `apps/web/core/components/issues/issue-detail/` and
 * cross-entity activity timelines. The concrete issue activity row is in
 * `./issues/activity/`.
 */

/**
 * Base activity-log row shape (workspace/project/issue scopes extend this).
 *
 * Type parameters:
 * - `TFieldKey`: string-literal union of allowed field names (e.g. "state", "priority")
 *   that the activity describes
 * - `TVerbKey`: string-literal union of activity verbs (e.g. "created", "updated", "deleted")
 *
 * Fields:
 * - `field`: name of the field that changed (undefined for non-field activities like comments)
 * - `epoch`: server-side ordering epoch (monotonic counter, NOT a date)
 * - `comment`: optional inline comment associated with the activity
 * - `old_value` / `new_value`: human-readable value strings (used for display)
 * - `old_identifier` / `new_identifier`: machine identifiers (used to resolve linked entities)
 */
export type TBaseActivity<TFieldKey extends string = string, TVerbKey extends string = string> = {
  id: string;
  field: TFieldKey | undefined;
  epoch: number;
  verb: TVerbKey;
  comment: string | undefined;
  // updates
  old_value: string | undefined;
  new_value: string | undefined;
  old_identifier: string | undefined;
  new_identifier: string | undefined;
  // actor detail
  actor: string;
  // timestamp
  created_at: string;
  updated_at: string;
};

/**
 * Activity row scoped to a workspace.
 *
 * Adds a `workspace` field to `TBaseActivity` carrying the workspace id.
 */
export type TWorkspaceBaseActivity<K extends string = string, V extends string = string> = TBaseActivity<K, V> & {
  workspace: string;
};

/**
 * Activity row scoped to a project within a workspace.
 *
 * Adds a `project` field to `TWorkspaceBaseActivity` carrying the project id.
 */
export type TProjectBaseActivity<K extends string = string, V extends string = string> = TWorkspaceBaseActivity<
  K,
  V
> & {
  project: string;
};

/**
 * Default verbs accepted by `TBaseActivity` activity rows.
 *
 * Union values:
 * - `created`: entity was created
 * - `updated`: entity field changed
 * - `deleted`: entity was removed
 */
export type TBaseActivityVerbs = "created" | "updated" | "deleted";
