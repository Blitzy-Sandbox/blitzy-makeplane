/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace home dashboard contracts for the `@plane/types` package.
 *
 * Models the home dashboard widgets (quick links, recents, stickies, tutorial, new-at-plane),
 * recent-activity filter keys, and the polymorphic recent-activity entity payload (page,
 * project, issue, workspace_page). Consumed by `apps/web/core/components/home/`.
 */

import type { TLogoProps } from "./common";
import type { TIssuePriorities } from "./issues";

/**
 * Filter selection for the recent-activity widget.
 *
 * Union values:
 * - `all item`: show all recent entity visits
 * - `issue` | `page` | `project` | `workspace_page`: narrow to one entity type
 */
export type TRecentActivityFilterKeys = "all item" | "issue" | "page" | "project" | "workspace_page";

/**
 * Stable identifiers for the home dashboard widgets.
 *
 * Union values:
 * - `quick_links`: pinned URLs
 * - `recents`: recently-visited entities
 * - `my_stickies`: user's sticky-note widget
 * - `quick_tutorial`: onboarding video panel
 * - `new_at_plane`: changelog/feature announcements
 */
export type THomeWidgetKeys = "quick_links" | "recents" | "my_stickies" | "quick_tutorial" | "new_at_plane";

/**
 * Common props passed to every home widget component.
 *
 * Fields:
 * - `workspaceSlug`: URL-safe identifier of the active workspace; used by widgets to scope
 *   their data fetches and route navigations.
 */
export type THomeWidgetProps = {
  workspaceSlug: string;
};

/**
 * Hydrated page-entity payload embedded in recent-activity rows.
 *
 * Fields with non-obvious semantics:
 * - `project_id` / `project_identifier`: optional — present for project-scoped pages,
 *   undefined for workspace-level pages.
 * - `logo_props`: emoji / icon descriptor rendered alongside the page title.
 * - `owned_by`: user id of the page creator (used for permission and avatar display).
 */
export type TPageEntityData = {
  id: string;
  name: string;
  logo_props: TLogoProps;
  project_id?: string;
  owned_by: string;
  project_identifier?: string;
};

/**
 * Hydrated project-entity payload embedded in recent-activity rows.
 *
 * Fields with non-obvious semantics:
 * - `identifier`: short project code (e.g. "PLN") used as the issue sequence prefix.
 * - `project_members`: user ids of all members; used to render the avatar stack.
 */
export type TProjectEntityData = {
  id: string;
  name: string;
  logo_props: TLogoProps;
  project_members: string[];
  identifier: string;
};

/**
 * Hydrated issue-entity payload embedded in recent-activity rows.
 *
 * Fields with non-obvious semantics:
 * - `priority`: from `TIssuePriorities` (urgent / high / medium / low / none).
 * - `type`: issue-type id or `null` when no type is assigned.
 * - `is_epic`: true when this issue is an epic container (rendered differently in the UI).
 * - `state`: workflow state id (not the state name); resolved by the consumer against the state store.
 * - `sequence_id`: monotonically increasing issue number within the project; combined with
 *   `project_identifier` to render the canonical "PLN-123" tag.
 */
export type TIssueEntityData = {
  id: string;
  name: string;
  state: string;
  priority: TIssuePriorities;
  assignees: string[];
  type: string | null;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  is_epic: boolean;
};

/**
 * Single recent-activity row.
 *
 * Polymorphic via the `entity_name` discriminant:
 * - `entity_name === "page"` → `entity_data` is `TPageEntityData`
 * - `entity_name === "project"` → `entity_data` is `TProjectEntityData`
 * - `entity_name === "issue"` → `entity_data` is `TIssueEntityData`
 * - `entity_name === "workspace_page"` → `entity_data` is `TPageEntityData`
 *   (workspace pages reuse the page-entity shape; the discriminant distinguishes routing only)
 *
 * Fields with non-obvious semantics:
 * - `entity_identifier`: id of the underlying entity referenced in `entity_data`.
 * - `visited_at`: ISO 8601 timestamp of the visit, used for chronological sorting.
 */
export type TActivityEntityData = {
  id: string;
  entity_name: "page" | "project" | "issue" | "workspace_page";
  entity_identifier: string;
  visited_at: string;
  entity_data: TPageEntityData | TProjectEntityData | TIssueEntityData;
};

/**
 * Fields editable in the quick-links widget add/edit dialog.
 *
 * Forms the user-supplied subset of `TLink`; server-managed fields (id, timestamps, ownership)
 * are appended at persistence time and exposed via the full `TLink` intersection below.
 */
export type TLinkEditableFields = {
  title: string;
  url: string;
};

/**
 * Persisted link record for the quick-links widget.
 *
 * Intersects `TLinkEditableFields` (title, url) with server-managed metadata.
 *
 * Fields with non-obvious semantics:
 * - `metadata`: opaque blob (e.g. OpenGraph preview cache); shape varies by link source.
 * - `created_at`: `Date` object (not ISO string) — already deserialized by the workspace API consumer.
 * - `created_by_id`: user id of the link creator; used for permission checks on edit/delete.
 * - `workspace_slug`: scopes the link to a single workspace; also used as the key in `TLinkMap`/`TLinkIdMap`.
 */
export type TLink = TLinkEditableFields & {
  created_by_id: string;
  id: string;
  metadata: any;
  workspace_slug: string;

  //need
  created_at: Date;
};

/**
 * Map of links keyed by `workspace_slug`.
 *
 * Stored on the MobX link store for fast O(1) lookup of the most-recent link per workspace.
 */
export type TLinkMap = {
  [workspace_slug: string]: TLink;
};

/**
 * Map of link id arrays keyed by `workspace_slug` — used for ordered listing.
 *
 * Preserves the server-returned ordering separately from the entity map above, so the UI
 * can render rows in stable order even as `TLinkMap` is mutated by individual updates.
 */
export type TLinkIdMap = {
  [workspace_slug: string]: string[];
};

/**
 * Single home-widget toggle row used in widget preferences.
 *
 * Fields with non-obvious semantics:
 * - `key`: stable identifier from `THomeWidgetKeys` — distinguishes the widget across all users.
 * - `is_enabled`: whether the widget is shown for this user on the home dashboard.
 * - `sort_order`: ordering position on the home dashboard (ascending; ties resolved by `key`).
 * - `name`: display label shown in the widget-preferences dialog.
 */
export type TWidgetEntityData = {
  key: THomeWidgetKeys;
  name: string;
  is_enabled: boolean;
  sort_order: number;
};
