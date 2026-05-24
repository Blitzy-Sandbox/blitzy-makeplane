/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project link contracts for the `@plane/types/project` subfolder.
 *
 * Models URLs attached to a project (e.g., external repo links, documentation links).
 * Mirrors `apps/api/plane/db/models/project.py::ProjectLink`. Consumed by the home
 * dashboard links widget in `apps/web/core/components/home/widgets/links/`.
 */

/**
 * Fields editable in the project-link add/edit dialog (the create/update form payload shape).
 *
 * Fields:
 * - `title`: human-readable label rendered in the project links list
 * - `url`: target URL the link navigates to (absolute, typically https://)
 */
export type TProjectLinkEditableFields = {
  title: string;
  url: string;
};

/**
 * Persisted project-link record (full shape returned by the API).
 *
 * Extends `TProjectLinkEditableFields` with server-managed fields. Mirrors
 * `apps/api/plane/db/models/project.py::ProjectLink`.
 *
 * Fields with non-obvious semantics:
 * - `created_by_id`: id of the user who created the link; used for "added by" attribution
 * - `metadata`: opaque blob holding OpenGraph preview cache (favicon, title, description);
 *   `any`-typed because the structure varies by source URL and is treated as display-only
 * - `created_at`: persisted as a `Date` object (not an ISO string) — the project-link
 *   service hydrates the API string into a `Date` before reaching the store
 */
export type TProjectLink = TProjectLinkEditableFields & {
  created_by_id: string;
  id: string;
  metadata: any;
  project_id: string;

  //need
  created_at: Date;
};

/**
 * Map of project links keyed by `project_id`.
 *
 * Stores one `TProjectLink` per project id. Used by the home dashboard links widget
 * to look up a project's primary link without an additional fetch.
 */
export type TProjectLinkMap = {
  [project_id: string]: TProjectLink;
};

/**
 * Map of project-link id arrays keyed by `project_id`.
 *
 * Used for ordered listing — each project_id maps to the ordered list of its link ids,
 * allowing the UI to render links in a stable order while the link objects themselves
 * live in a flat normalized cache.
 */
export type TProjectLinkIdMap = {
  [project_id: string]: string[];
};
