/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * GitHub importer workflow contracts for the `@plane/types/importer` subfolder.
 *
 * Models the GitHub import flow:
 * - Form payload sent when initiating an import (`IGithubServiceImportFormData`):
 *   bundles GitHub repository metadata, per-user import mapping, sync configuration,
 *   and destination project linkage
 * - Repository collaborator summary (`IGithubRepoCollaborator`): GitHub user identity
 *   used in the user-mapping picker
 * - Repository statistics summary (`IGithubRepoInfo`): pre-import counts and collaborator
 *   list returned by the workspace integration's `getGithubRepoInfo` endpoint
 *
 * Consumers:
 * - `apps/web/core/services/integrations/github.service.ts` — `getGithubRepoInfo()` returns
 *   `IGithubRepoInfo`; importer-create endpoints accept `IGithubServiceImportFormData`
 * - Backend GitHub importer Celery task in `apps/api/plane/bgtasks/` (Celery → RabbitMQ,
 *   NOT Redis — Redis is caching/session only per AAP §0.2.2 architectural context)
 *
 * The persisted importer-job record produced after submission is modeled by
 * `IImporterService` in `./index.ts`.
 */

/**
 * Form payload submitted when starting a new GitHub import — bundles repo
 * metadata, the per-user mapping list (invite/map/skip), the `sync` flag
 * (continuous incremental sync after initial import), and the destination
 * Plane project id.
 */
export interface IGithubServiceImportFormData {
  metadata: {
    owner: string;
    name: string;
    repository_id: number;
    url: string;
  };
  data: {
    users: {
      username: string;
      /**
       * Per-user import directive for this GitHub user.
       *
       * Tri-state union semantics:
       * - `"invite"`: send a Plane workspace invitation to this user's email so they
       *   join the workspace and become the issue assignee
       * - `"map"`: map this GitHub user to an EXISTING Plane workspace member (resolved
       *   server-side by email match)
       * - `false` (boolean literal): skip — do not import or assign issues to this user;
       *   their authored issues will be attributed to the importer initiator instead
       *
       * Note: the literal `boolean` type is reused as `false` (no `true` semantic exists);
       * `true` here is reserved/unused at the time of writing.
       */
      import: boolean | "invite" | "map";
      email: string;
    }[];
  };
  config: {
    sync: boolean;
  };
  project_id: string;
}

/**
 * GitHub repository collaborator projection (subset of GitHub's User schema)
 * returned as part of `IGithubRepoInfo.collaborators`; rendered by the
 * user-mapping picker in the import wizard.
 */
export interface IGithubRepoCollaborator {
  avatar_url: string;
  html_url: string;
  id: number;
  login: string;
  url: string;
}

/**
 * Pre-import summary of a GitHub repository's importable surface (issue
 * count, label count, eligible collaborators) returned by `getGithubRepoInfo()`
 * and rendered in the import wizard's confirmation step.
 */
export interface IGithubRepoInfo {
  issue_count: number;
  labels: number;
  collaborators: IGithubRepoCollaborator[];
}
