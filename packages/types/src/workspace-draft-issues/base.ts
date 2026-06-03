/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace-scoped draft issue contracts mirroring `apps/api/plane/db/models/draft.py::DraftIssue` and serialized by `apps/api/plane/app/serializers/draft.py::DraftIssueSerializer` (with `DraftIssueCreateSerializer` for writes).
 * Consumed by `apps/web/core/store/issue/workspace-draft/issue.store.ts`, `apps/web/core/services/issue/workspace_draft.service.ts`, and the workspace-draft branch of the issue-modal/components subtree.
 */

import type { TIssuePriorities } from "../issues";

/**
 * Single workspace-scoped draft record mirroring `apps/api/plane/db/models/draft.py::DraftIssue` and serialized by `apps/api/plane/app/serializers/draft.py::DraftIssueSerializer`; consumed as `issuesMap: Record<string, TWorkspaceDraftIssue>` in `issue.store.ts` and as the response payload in `workspace_draft.service.ts`.
 * The backend `DraftIssue.type` FK is nullable (`null=True, blank=True`) — `type_id` is documented `string` here because the canonical `DraftIssueSerializer` projection emits the resolved id; consumers MAY observe an empty/missing value in practice and should treat it as "no issue type set".
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

  /** Destination project; `undefined` while unpromoted — must be set before the draft can be promoted into a real project issue. */
  project_id: string | undefined;
  /** Optional parent issue ID for draft sub-issue hierarchy; `undefined` for top-level drafts. */
  parent_id: string | undefined;
  /** Optional cycle assignment carried by the draft; honored on promotion to a real project issue. */
  cycle_id: string | undefined;
  /** Optional module assignments carried by the draft; honored on promotion to a real project issue. */
  module_ids: string[] | undefined;

  start_date: string | undefined;
  target_date: string | undefined;
  /** Set when the draft is marked completed; usually `undefined` because drafts are not typically completed in place. */
  completed_at: string | undefined;

  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;

  /** Always `true` on records returned by the workspace-draft endpoints; distinguishes drafts from persisted project issues. */
  is_draft: boolean;

  /**
   * Issue-type FK projected by `DraftIssueSerializer`; the underlying `DraftIssue.type` column is nullable, so consumers should treat absent / empty values as "no type set" rather than assume creation-time requiredness.
   */
  type_id: string;
};

/**
 * Cursor-paginated list-response envelope for workspace-draft endpoints; `extra_stats`, `grouped_by`, and `sub_grouped_by` populate only when the request opts into aggregation/grouping and remain `undefined` otherwise.
 *
 * @template T - Per-row item type, typically `TWorkspaceDraftIssue`.
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
 * Cursor-based query input for workspace-draft list fetches; `cursor` is opaque and supplied by a prior `TWorkspaceDraftPaginationInfo.next_cursor` / `prev_cursor` from `issue.store.ts`'s fetch action.
 */
export type TWorkspaceDraftQueryParams = {
  per_page: number;
  cursor: string;
};

/**
 * Loader/mutation-state literal union for workspace-draft UI surfaces (`undefined` = idle); read from `issue.store.ts::loader` by `apps/web/core/components/issues/workspace-draft/loader.tsx` and peer components that branch on loader state.
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
