/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue de-duplication contracts for the `@plane/types` package.
 *
 * Models the request payload (title + description being typed) and response shape
 * (similar existing issues) for the de-dupe endpoint used by the create-issue modal
 * in `apps/web/core/components/issues/issue-modal/` to surface existing similar work
 * items before submission.
 */

import type { TIssuePriorities } from "./issues";

/**
 * Request payload for the de-dupe similarity-search endpoint.
 *
 * Fields:
 * - `title`: required — current title being drafted in the create-issue modal.
 * - `workspace_id`: required — scopes the similarity search to a single workspace.
 * - `issue_id`: optional — when editing an existing issue, its id is excluded from results.
 * - `project_id`: optional — narrows the search to a single project when present.
 * - `description_stripped`: optional — plain-text (HTML/markdown stripped) description used
 *   for richer similarity matching beyond title alone.
 */
export type TDuplicateIssuePayload = {
  title: string;
  workspace_id: string;
  issue_id?: string | null;
  project_id?: string;
  description_stripped?: string;
};

/**
 * Single suggested similar issue returned by the de-dupe endpoint.
 *
 * Slimmed projection of `TIssue` used purely for surfacing as a duplicate suggestion;
 * consumers should navigate to the full issue via `id`/`project_id` if the user picks one.
 * The `priority` field uses the shared `TIssuePriorities` union ("urgent" | "high" |
 * "medium" | "low" | "none"); `type_id` is nullable for projects without an issue type.
 */
export type TDeDupeIssue = {
  id: string;
  type_id: string | null;
  project_id: string;
  sequence_id: number;
  name: string;
  priority: TIssuePriorities;
  state_id: string;
  created_by: string;
};

/**
 * Response envelope from the de-dupe endpoint.
 *
 * Fields:
 * - `dupes`: ordered list of suggested similar issues (most similar first per backend ranking).
 */
export type TDuplicateIssueResponse = {
  dupes: TDeDupeIssue[];
};
