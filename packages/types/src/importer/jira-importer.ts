/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Jira importer workflow contracts for the `@plane/types/importer` subfolder.
 *
 * Models the Jira import flow:
 * - Form payload sent when initiating an import (`IJiraImporterForm` + `IJiraConfig` +
 *   `IJiraData` + `IJiraMetadata`): bundles Atlassian-cloud credentials, project key,
 *   user mapping list, and the epics-to-modules configuration toggle
 * - Pre-import discovery response (`IJiraResponse` + `IJiraResponseUser` +
 *   `IJiraResponseAvatarUrls`): counts of issues / modules / labels / states + the
 *   collaborator list returned by the workspace integration's `getJiraProjectInfo` endpoint
 *
 * Consumers:
 * - `apps/web/core/services/integrations/jira.service.ts` — `getJiraProjectInfo()` accepts
 *   `IJiraMetadata` and returns `IJiraResponse`; `createJiraImporter()` accepts `IJiraImporterForm`
 * - Backend Jira importer Celery task in `apps/api/plane/bgtasks/` (Celery → RabbitMQ,
 *   NOT Redis — Redis is caching/session only per AAP §0.2.2 architectural context)
 *
 * The persisted importer-job record produced after submission is modeled by
 * `IImporterService` in `./index.ts`.
 *
 * Credential handling note: `IJiraMetadata.api_token` + `IJiraMetadata.email` are
 * collected from the user in the import wizard, transmitted over HTTPS, and persisted
 * server-side as encrypted credentials by `apps/api`; they are NOT browser-cached or
 * client-side persisted.
 */

/**
 * Top-level form payload submitted when starting a new Jira import.
 *
 * Composes the four facets of a Jira import: source connection credentials
 * (`metadata`), behavior toggles (`config`), the user mapping list + aggregate counts
 * (`data`), and the destination Plane project (`project_id`).
 *
 * Submitted to `apps/web/core/services/integrations/jira.service.ts::createJiraImporter()`,
 * which forwards it to the backend importer task in `apps/api/plane/bgtasks/`.
 */
export interface IJiraImporterForm {
  metadata: IJiraMetadata;
  config: IJiraConfig;
  data: IJiraData;
  project_id: string;
}

/**
 * Jira import behavior configuration toggles.
 *
 * Fields with non-obvious semantics:
 * - `epics_to_modules`: when true, Jira Epics are imported as Plane modules
 *   (preserving the Epic-Story hierarchy as Module-Issue parent/child); when false,
 *   Jira Epics are imported as regular Plane issues with an "epic" issue-type tag.
 *   This toggle materially changes the resulting Plane project structure and cannot
 *   be changed after import completes.
 */
export interface IJiraConfig {
  epics_to_modules: boolean;
}

/**
 * Per-Jira-project import data — user mapping + invitation flag + aggregate counts.
 *
 * The aggregate counts (`total_issues` / `total_labels` / `total_states` / `total_modules`)
 * are pre-computed by the workspace integration's discovery endpoint and shown in the
 * import wizard confirmation step so users can preview what will be imported.
 *
 * Fields with non-obvious semantics:
 * - `users[]`: per-Jira-user mapping (see the `User` interface for the directive semantics)
 * - `invite_users`: when true, any user marked `import: "invite"` in `users[]` receives a
 *   Plane workspace invitation email after the import completes
 * - `total_modules`: only meaningful when `IJiraConfig.epics_to_modules` is true; otherwise
 *   the count of Jira Epics is reflected in `total_issues`
 */
export interface IJiraData {
  users: User[];
  invite_users: boolean;
  total_issues: number;
  total_labels: number;
  total_states: number;
  total_modules: number;
}

/**
 * Per-Jira-user mapping directive used when importing issues.
 *
 * NOTE: This interface is intentionally named `User` (not `IJiraUser`) because the
 * legacy Jira import flow shares the shape with the GitHub user mapping at runtime;
 * renaming would break the existing import wizard component bindings. The system
 * boundary "no renaming or restructuring" preserves this name verbatim.
 *
 * Fields:
 * - `username`: Jira display name / username (provider-specific identity)
 * - `email`: email used for invitation OR to match an existing Plane workspace member
 * - `import`: directive — see field-level JSDoc on the union below
 */
export interface User {
  username: string;
  /**
   * Per-user import directive for this Jira user.
   *
   * Tri-state union semantics:
   * - `"invite"`: send a Plane workspace invitation to this user's email so they
   *   join the workspace and become the issue assignee
   * - `"map"`: map this Jira user to an EXISTING Plane workspace member (resolved
   *   server-side by `email` match)
   * - `false` (boolean literal): skip — do not import or assign issues to this user;
   *   their authored issues will be attributed to the importer initiator instead
   */
  import: "invite" | "map" | false;
  email: string;
}

/**
 * Atlassian Cloud connection credentials + project key for the Jira import.
 *
 * Sent to `apps/web/core/services/integrations/jira.service.ts::getJiraProjectInfo()`
 * as query params for the pre-import discovery call. Server-side persisted encrypted
 * after import submission for any subsequent re-sync operations.
 *
 * Fields with non-obvious semantics (CREDENTIAL FIELDS — server-only after capture):
 * - `cloud_hostname`: Atlassian Cloud base hostname (e.g. `mycompany.atlassian.net`),
 *   without the protocol prefix; the backend constructs the full Jira REST API URL
 * - `api_token`: Atlassian Cloud API token issued by the user from their Atlassian
 *   account profile (the user's password is NOT accepted — Atlassian requires API tokens
 *   for cloud connections). NEVER persisted client-side; transmitted over HTTPS and stored
 *   encrypted by `apps/api`.
 * - `project_key`: Jira project key (the short identifier like "PLN" or "PROJ", NOT the
 *   numeric project id) — used to scope the import to a single Jira project
 * - `email`: Atlassian account email associated with `api_token` (Atlassian's basic-auth
 *   pairs email + API token). Used server-side only for the Jira API call; not stored
 *   in clear text on the client.
 */
export interface IJiraMetadata {
  cloud_hostname: string;
  api_token: string;
  project_key: string;
  email: string;
}

/**
 * Pre-import discovery response from the workspace integration's `getJiraProjectInfo` endpoint.
 *
 * Returns aggregate counts (rendered as a summary card in the import wizard) and the
 * Jira user list (rendered as the user-mapping picker rows). After the user reviews
 * this summary and submits the form, the actual import is performed asynchronously by
 * the Jira importer Celery task in `apps/api/plane/bgtasks/`.
 *
 * Fields:
 * - `issues` / `modules` / `labels` / `states`: counts that will be imported
 * - `users`: Jira users discovered in the project — surfaced for per-user import mapping
 */
export interface IJiraResponse {
  issues: number;
  modules: number;
  labels: number;
  states: number;
  users: IJiraResponseUser[];
}

/**
 * Single Jira user projection from the discovery response (mirrors Atlassian's User schema subset).
 *
 * Returned as part of `IJiraResponse.users` and rendered in the user-mapping picker step
 * of the Jira import wizard.
 *
 * Fields with non-obvious semantics:
 * - `self`: Jira REST API URL pointing to this user (used for backend cross-reference)
 * - `accountId`: Atlassian's stable user id (preferred over `displayName` for matching)
 * - `accountType`: Atlassian account type (e.g. `atlassian` for cloud users, `app` for
 *   service accounts) — used to filter out non-human accounts in the picker
 * - `emailAddress`: Jira user's email (matched against Plane workspace members when the
 *   user picks the "map" directive)
 * - `avatarUrls`: per-size avatar URLs (see `IJiraResponseAvatarUrls`)
 * - `active`: false for deactivated Jira accounts — surfaced with a visual indicator
 *   so users avoid mapping to defunct accounts
 * - `locale`: Atlassian locale code (e.g. `en_US`); informational only in Plane
 */
export interface IJiraResponseUser {
  self: string;
  accountId: string;
  accountType: string;
  emailAddress: string;
  avatarUrls: IJiraResponseAvatarUrls;
  displayName: string;
  active: boolean;
  locale: string;
}

/**
 * Per-size avatar URLs for a Jira user (mirrors Atlassian's User.avatarUrls schema).
 *
 * Atlassian returns avatars at four fixed pixel dimensions. The Plane import wizard
 * picks the size most appropriate for its rendering context (32×32 for picker rows,
 * 48×48 for the confirmation summary).
 *
 * Keys are quoted because they start with digits (TypeScript literal-key requirement).
 */
export interface IJiraResponseAvatarUrls {
  "48x48": string;
  "24x24": string;
  "16x16": string;
  "32x32": string;
}
