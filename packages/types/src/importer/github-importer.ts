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
 * Form payload submitted when starting a new GitHub import.
 *
 * Bundles GitHub-side repository metadata, the user mapping list (controls which GitHub
 * users get invited / mapped / skipped), the sync flag, and the destination Plane project id.
 *
 * Fields with non-obvious semantics:
 * - `metadata.owner` / `metadata.name`: GitHub repo coordinates (owner login + repo name)
 * - `metadata.repository_id`: GitHub's numeric repository id (the stable identifier across
 *   renames; preferred over owner/name for de-duplication on the backend)
 * - `metadata.url`: full HTML URL of the GitHub repository (used for display and audit)
 * - `data.users[]`: per-GitHub-user mapping directive — see field-level JSDoc on `import` below
 * - `config.sync`: when true, the importer enters continuous-sync mode after the initial
 *   import completes (incremental polling for new GitHub issues / updates)
 * - `project_id`: id of the destination Plane project that imported issues will land in
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
 * GitHub repository collaborator projection (mirrors a subset of GitHub's User schema).
 *
 * Returned as part of `IGithubRepoInfo.collaborators` from the GitHub workspace integration's
 * repository-info endpoint; used by the user-mapping picker in the GitHub import wizard
 * to display GitHub avatars and link out to the collaborator's GitHub profile.
 *
 * Fields:
 * - `id`: GitHub's numeric user id (stable across username changes)
 * - `login`: GitHub username (handle)
 * - `avatar_url`: signed/CDN avatar URL from GitHub
 * - `html_url`: full GitHub profile URL (e.g. `https://github.com/<login>`)
 * - `url`: GitHub REST API URL for this user (used for backend follow-up calls)
 */
export interface IGithubRepoCollaborator {
  avatar_url: string;
  html_url: string;
  id: number;
  login: string;
  url: string;
}

/**
 * Pre-import summary of a GitHub repository's importable surface.
 *
 * Returned by the workspace integration's `getGithubRepoInfo` endpoint
 * (`apps/web/core/services/integrations/github.service.ts`) and rendered in the GitHub
 * import wizard so users can confirm what will be pulled in before triggering the import.
 *
 * Fields:
 * - `issue_count`: number of GitHub issues that will be imported
 * - `labels`: number of unique GitHub labels that will be created/mapped
 * - `collaborators`: list of GitHub collaborators eligible to appear in the user-mapping step
 */
export interface IGithubRepoInfo {
  issue_count: number;
  labels: number;
  collaborators: IGithubRepoCollaborator[];
}
