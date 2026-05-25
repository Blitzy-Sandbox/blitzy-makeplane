/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace global search contracts for the `@plane/types` package.
 *
 * Models the search request payload and per-entity result envelopes returned by the
 * `apps/api/plane/app/views/search/` endpoints. Consumed by the universal search box
 * in `apps/web/ce/components/command-palette/` and `@`-mention pickers in the
 * `@plane/editor` rich-text wrapper.
 */

import type { ICycle } from "./cycle";
import type { TIssue } from "./issues/issue";
import type { IModule } from "./module";
import type { TPage } from "./page";
import type { IProject } from "./project";
import type { IUser } from "./users";
import type { IWorkspace } from "./workspace";

/**
 * Entity-type discriminator for global search results.
 *
 * Union values:
 * - `user_mention`: workspace members (used by @-mention pickers)
 * - `issue`: work items
 * - `project`: projects in the workspace
 * - `cycle`: project cycles
 * - `module`: project modules
 * - `page`: pages
 */
export type TSearchEntities = "user_mention" | "issue" | "project" | "cycle" | "module" | "page";

/**
 * User search result row (workspace member).
 *
 * Fields use Django ORM double-underscore prefixed names (`member__*`) — they come from
 * the join with `WorkspaceMember.member` on the backend.
 */
export type TUserSearchResponse = {
  member__avatar_url: IUser["avatar_url"];
  member__display_name: IUser["display_name"];
  member__id: IUser["id"];
};

/**
 * Project search result row.
 *
 * Includes the project identifier (e.g. "PLN") used for issue sequence display.
 */
export type TProjectSearchResponse = {
  name: IProject["name"];
  id: IProject["id"];
  identifier: IProject["identifier"];
  logo_props: IProject["logo_props"];
  workspace__slug: IWorkspace["slug"];
};

/**
 * Issue search result row.
 *
 * Includes `sequence_id` + `project__identifier` so the UI can render the canonical
 * issue label (e.g. "PLN-1234") without extra lookups.
 */
export type TIssueSearchResponse = {
  name: TIssue["name"];
  id: TIssue["id"];
  sequence_id: TIssue["sequence_id"];
  project__identifier: IProject["identifier"];
  project_id: TIssue["project_id"];
  priority: TIssue["priority"];
  state_id: TIssue["state_id"];
  type_id: TIssue["type_id"];
};

/**
 * Cycle search result row.
 *
 * Fields:
 * - `status`: cycle group (current / upcoming / completed / draft) for UI grouping
 */
export type TCycleSearchResponse = {
  name: ICycle["name"];
  id: ICycle["id"];
  project_id: ICycle["project_id"];
  project__identifier: IProject["identifier"];
  status: ICycle["status"];
  workspace__slug: IWorkspace["slug"];
};

/**
 * Module search result row.
 *
 * Fields:
 * - `status`: module lifecycle status (backlog / planned / in-progress / paused / completed / cancelled)
 */
export type TModuleSearchResponse = {
  name: IModule["name"];
  id: IModule["id"];
  project_id: IModule["project_id"];
  project__identifier: IProject["identifier"];
  status: IModule["status"];
  workspace__slug: IWorkspace["slug"];
};

/**
 * Page search result row.
 *
 * Pages can belong to multiple projects, so `projects__id` is an array (project ids).
 */
export type TPageSearchResponse = {
  name: TPage["name"];
  id: TPage["id"];
  logo_props: TPage["logo_props"];
  projects__id: TPage["project_ids"];
  workspace__slug: IWorkspace["slug"];
};

/**
 * Aggregated global search response — partitioned by entity type.
 *
 * Only the keys requested via `TSearchEntityRequestPayload.query_type` will be present.
 * All keys are optional to allow callers to request a single entity type.
 */
export type TSearchResponse = {
  cycle?: TCycleSearchResponse[];
  issue?: TIssueSearchResponse[];
  module?: TModuleSearchResponse[];
  page?: TPageSearchResponse[];
  project?: TProjectSearchResponse[];
  user_mention?: TUserSearchResponse[];
};

/**
 * Request payload for the global search endpoint.
 *
 * Fields:
 * - `count`: maximum number of results to return PER entity_type
 * - `project_id`: optional — narrow to a single project
 * - `query_type`: array of entity types to include in the response
 * - `query`: free-text search string (matches name + identifier + sequence_id)
 * - `team_id`: optional — narrow to a specific team
 * - `issue_id`: optional — exclude this issue from results (used for relation pickers)
 */
export type TSearchEntityRequestPayload = {
  count: number;
  project_id?: string;
  query_type: TSearchEntities[];
  query: string;
  team_id?: string;
  issue_id?: string;
};
