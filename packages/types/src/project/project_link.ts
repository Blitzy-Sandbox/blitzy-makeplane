/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// INTENT UNCLEAR: no direct apps/api Django model mirror found for project links —
// the closest Link-family models are IssueLink (apps/api/plane/db/models/issue.py),
// ModuleLink (apps/api/plane/db/models/module.py), and WorkspaceUserLink
// (apps/api/plane/db/models/workspace.py); the backend persistence path for
// project-scoped links is not identifiable from tracked source.
/**
 * Project link contracts consumed by the home dashboard widget at
 * `apps/web/core/components/home/widgets/links/`.
 */

/**
 * Editable subset of `TProjectLink` used as the create/update form payload.
 */
export type TProjectLinkEditableFields = {
  title: string;
  url: string;
};

/**
 * Persisted project-link record extending the editable fields with
 * server-managed identity, audit, and the OpenGraph preview cache (`metadata`
 * is typed loosely because the cache shape varies by source URL); `created_at`
 * is a `Date` because the service hydrates the ISO string at the network boundary.
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
 * Single-link-per-project lookup used by the home dashboard widget to render
 * a project's primary link without an additional fetch.
 */
export type TProjectLinkMap = {
  [project_id: string]: TProjectLink;
};

/**
 * Ordered link-id list per project, paired with a flat normalized link cache.
 */
export type TProjectLinkIdMap = {
  [project_id: string]: string[];
};
