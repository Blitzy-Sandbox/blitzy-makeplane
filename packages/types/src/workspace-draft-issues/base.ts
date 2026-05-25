/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type contracts for workspace-scoped draft issues — working-copy issues
 * authored at the workspace level before being promoted to a project-bound
 * issue. A draft lives outside the regular project issues collection until a
 * destination `project_id` is set and the draft is converted into a real
 * project issue.
 *
 * Consumers: `apps/web/core/store/issue/workspace-draft/issue.store.ts`
 * (primary MobX store), `apps/web/core/services/issue/workspace_draft.service.ts`
 * (API service), and the `apps/web/core/components/issues/workspace-draft/`
 * component subtree (loader, root, delete-modal, draft-issue-block,
 * draft-issue-properties) plus the draft branch of
 * `apps/web/core/components/issues/issue-modal/form.tsx`.
 */

import type { TIssuePriorities } from "../issues";

/**
 * A single workspace-scoped draft issue record — the working copy an author
 * is composing at the workspace level before deciding which project to file
 * it against. Draft records flow through the workspace-draft endpoints and
 * become regular project issues once promoted (which requires a `project_id`).
 *
 * Consumers: `issue.store.ts`
 * (`issuesMap: Record<string, TWorkspaceDraftIssue>`),
 * `workspace_draft.service.ts` (HTTP payloads), and the workspace-draft UI
 * components that render and mutate individual rows. `type_id` references
 * the issue-type system and is required at draft creation time.
 */
export type TWorkspaceDraftIssue = {
  id: string;
  name: string;
  sort_order: number;

  state_id: string | undefined;
  priority: TIssuePriorities | undefined;
  label_ids: string[];
  assignee_ids: string[];
  estimate_point: string | undefined;

  /**
   * Destination project the draft will be filed into. Optional because an
   * unpromoted draft may not yet have a destination project; promotion to a
   * real issue requires this to be set.
   */
  project_id: string | undefined;
  /**
   * Optional parent issue ID for draft sub-issue hierarchy; remains
   * `undefined` for top-level drafts that are not children of another issue.
   */
  parent_id: string | undefined;
  /**
   * Optional cycle assignment carried by the draft; honored when the draft
   * is promoted into a real project issue.
   */
  cycle_id: string | undefined;
  /**
   * Optional module assignments carried by the draft; honored when the
   * draft is promoted into a real project issue.
   */
  module_ids: string[] | undefined;

  start_date: string | undefined;
  target_date: string | undefined;
  /**
   * Set when the draft has been marked completed; otherwise `undefined`.
   * Drafts are not typically completed in place, so this field is mostly
   * `undefined` for live draft records.
   */
  completed_at: string | undefined;

  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;

  /**
   * Discriminator asserting this record is a workspace draft rather than a
   * persisted project issue; always `true` for records returned from the
   * workspace-draft endpoints.
   */
  is_draft: boolean;

  type_id: string;
};

/**
 * Cursor-based pagination envelope wrapping a `results: T[]` array for
 * workspace draft issue list responses, where `T` is the per-row item type
 * (typically `TWorkspaceDraftIssue`).
 *
 * Consumers: `issue.store.ts`
 * (`paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined`)
 * and the workspace draft service for list-fetch responses. The
 * `extra_stats`, `grouped_by`, and `sub_grouped_by` fields populate only
 * when the list endpoint is invoked with aggregation/grouping enabled and
 * remain `undefined` for plain ungrouped responses.
 */
export type TWorkspaceDraftPaginationInfo<T> = {
  /** Opaque cursor for the next page; `undefined` when the current page is the last page. */
  next_cursor: string | undefined;
  /** Opaque cursor for the previous page; `undefined` when the current page is the first page. */
  prev_cursor: string | undefined;
  next_page_results: boolean | undefined;
  prev_page_results: boolean | undefined;
  total_pages: number | undefined;
  count: number | undefined; // current paginated results count
  total_count: number | undefined; // total available results count
  total_results: number | undefined;
  results: T[] | undefined;
  /**
   * Stringified aggregation metadata sidecar; present only when the list
   * endpoint is invoked with stats enabled.
   */
  extra_stats: string | undefined;
  /**
   * Primary group key when `results` is a grouped response (e.g., grouped
   * by state or assignee).
   */
  grouped_by: string | undefined;
  /** Secondary group key when the response is two-level grouped. */
  sub_grouped_by: string | undefined;
};

/**
 * Minimal query input contract for fetching workspace draft issue lists.
 * Pagination is intentionally cursor-based (not offset-based); `cursor` is
 * opaque and supplied by a prior
 * `TWorkspaceDraftPaginationInfo.next_cursor` / `prev_cursor`.
 *
 * Consumers: `issue.store.ts`
 * (`queryParams: TWorkspaceDraftQueryParams = { per_page, cursor }`
 * assembled inside the fetch action before each list request).
 */
export type TWorkspaceDraftQueryParams = {
  per_page: number;
  cursor: string;
};

/**
 * String-literal union describing every loader / mutation state the
 * workspace draft issue UI surfaces can be in, plus `undefined` for the
 * idle (no-loader) state. Valid values are `"init-loader"`, `"empty-state"`,
 * `"mutation"`, `"pagination"`, `"loaded"`, `"create"`, `"update"`,
 * `"delete"`, `"move"`, and `undefined`.
 *
 * Consumers: `issue.store.ts`
 * (`loader: TWorkspaceDraftIssueLoader = undefined`) and
 * `apps/web/core/components/issues/workspace-draft/loader.tsx` plus other
 * draft-issue components that branch on loader state.
 */
export type TWorkspaceDraftIssueLoader =
  | "init-loader"
  | "empty-state"
  | "mutation"
  | "pagination"
  | "loaded"
  | "create"
  | "update"
  | "delete"
  | "move"
  | undefined;
