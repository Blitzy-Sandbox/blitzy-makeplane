/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Jira importer workflow contracts (form payload + discovery response)
 * consumed by `apps/web/core/services/integrations/jira.service.ts` and the
 * Jira importer Celery task in `apps/api/plane/bgtasks/`; Atlassian credentials
 * (`api_token`, `email`) are transmitted over HTTPS and persisted encrypted
 * server-side — never browser-cached.
 */

/**
 * Top-level Jira import form composing credentials (`metadata`), behavior
 * toggles (`config`), user mapping + counts (`data`), and destination
 * `project_id`; submitted to `jira.service.ts::createJiraImporter()`.
 */
export interface IJiraImporterForm {
  metadata: IJiraMetadata;
  config: IJiraConfig;
  data: IJiraData;
  project_id: string;
}

/**
 * Jira import behavior toggles; `epics_to_modules` (when true) imports Epics
 * as Plane modules preserving Epic-Story hierarchy, otherwise Epics are
 * imported as regular issues with an "epic" tag — this toggle materially
 * changes project structure and cannot be changed after import completes.
 */
export interface IJiraConfig {
  epics_to_modules: boolean;
}

/**
 * Per-Jira-project import data: user mapping, `invite_users` flag (sends Plane
 * invites to users marked `import: "invite"`), and pre-computed aggregate
 * counts; `total_modules` is meaningful only when `epics_to_modules` is true.
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
 * Per-Jira-user mapping directive; intentionally named `User` (not `IJiraUser`)
 * because renaming would break import-wizard component bindings — preserved
 * verbatim under the "no renaming" system boundary.
 */
export interface User {
  username: string;
  /**
   * Per-user import directive: `"invite"` (send Plane invitation),
   * `"map"` (match existing member by email), or `false` (skip — attribute
   * authored issues to the importer initiator).
   */
  import: "invite" | "map" | false;
  email: string;
}

/**
 * Atlassian Cloud credentials (`api_token` + `email`) plus `cloud_hostname`
 * (no protocol prefix) and `project_key` (short identifier like "PLN", not
 * the numeric id) — sent to `getJiraProjectInfo()` and persisted encrypted
 * server-side after import submission.
 */
export interface IJiraMetadata {
  cloud_hostname: string;
  api_token: string;
  project_key: string;
  email: string;
}

/**
 * Pre-import discovery response (aggregate counts + Jira user list) returned
 * by `getJiraProjectInfo()` and rendered as the import wizard's summary card
 * plus user-mapping picker rows.
 */
export interface IJiraResponse {
  issues: number;
  modules: number;
  labels: number;
  states: number;
  users: IJiraResponseUser[];
}

/**
 * Single Jira user projection (subset of Atlassian's User schema); `accountId`
 * is Atlassian's stable id (preferred for matching over `displayName`), and
 * `accountType` distinguishes human accounts from service accounts (`app`).
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
 * Per-size avatar URLs for a Jira user (Atlassian's four fixed pixel
 * dimensions); keys are quoted because TypeScript literal keys cannot start
 * with digits.
 */
export interface IJiraResponseAvatarUrls {
  "48x48": string;
  "24x24": string;
  "16x16": string;
  "32x32": string;
}
