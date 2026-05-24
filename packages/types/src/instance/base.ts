/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core instance identity contracts for the `@plane/types/instance` subfolder.
 *
 * Models the singleton record describing a deployed Plane instance — identity,
 * naming, namespace, timestamps, license, version, telemetry/support flags,
 * activation and setup state, signup-screen visitation, user counts, verification,
 * audit references, workspace presence — plus the operational `IInstanceConfig`
 * captured from runtime feature toggles and provider enablement.
 *
 * Mirrors `apps/api/plane/license/` server-side models. Consumed by `apps/admin/`
 * instance management surface (read/write) and `apps/web` (read-only display of
 * `IInstanceConfig` such as `is_smtp_configured`, `has_llm_configured`,
 * `enable_signup`).
 */

import type { IUserLite } from "../users";
import type {
  TInstanceAIConfigurationKeys,
  TInstanceEmailConfigurationKeys,
  TInstanceImageConfigurationKeys,
  TInstanceAuthenticationKeys,
  TInstanceWorkspaceConfigurationKeys,
  TCoreLoginMediums,
} from "./";
import type { TExtendedLoginMediums } from "./auth-ee";

/**
 * Composite payload returned from the instance bootstrap endpoint pairing the
 * persistent `IInstance` record with the runtime `IInstanceConfig` snapshot.
 *
 * Consumers: instance setup wizard in `apps/admin/`, `apps/web` boot
 * (decides which auth UI / sign-up flow to render).
 *
 * @property instance — canonical instance entity (license, version, identity).
 * @property config — runtime configuration flags (feature toggles, base URLs).
 */
export interface IInstanceInfo {
  instance: IInstance;
  config: IInstanceConfig;
}

/**
 * Canonical instance entity — the single source of truth describing a deployed
 * Plane installation. Mirrors `apps/api/plane/license/` models written by the
 * instance registration flow.
 *
 * Non-obvious field semantics:
 * - `instance_id`: opaque server-assigned identifier issued at registration;
 *   distinct from `id` (DB primary key). May be `undefined` before registration.
 * - `license_key`: present only on activated paid deployments; `undefined` for
 *   self-managed community installations.
 * - `current_version` / `latest_version`: current running version vs. latest
 *   published version returned by the registration server; drives the upgrade
 *   prompt in `apps/admin/`.
 * - `last_checked_at`: timestamp of the most recent version-check ping.
 * - `namespace`: tenant namespace identifier; `undefined` on single-tenant
 *   community installs.
 * - `is_telemetry_enabled`: gates anonymous telemetry shipping by the API and
 *   live server.
 * - `is_support_required`: surfaces a paid-support upsell in the admin UI when
 *   true.
 * - `is_activated`: license activation succeeded; license-gated features unlock.
 * - `is_setup_done`: the initial setup wizard has been completed; downstream
 *   sign-up / sign-in screens become reachable.
 * - `is_signup_screen_visited`: tracks whether the deferred sign-up screen has
 *   been shown at least once (used to prevent re-showing it).
 * - `user_count`: cached user total used to enforce seat limits; `undefined`
 *   before the first count materialization.
 * - `is_verified`: ownership of the install has been verified via email or
 *   registration callback.
 * - `workspaces_exist`: at least one workspace has been created on this
 *   instance; redirects sign-in to workspace creation when false.
 */
export interface IInstance {
  id: string;
  created_at: string;
  updated_at: string;
  instance_name: string | undefined;
  whitelist_emails: string | undefined;
  instance_id: string | undefined;
  license_key: string | undefined;
  current_version: string | undefined;
  latest_version: string | undefined;
  last_checked_at: string | undefined;
  namespace: string | undefined;
  is_telemetry_enabled: boolean;
  is_support_required: boolean;
  is_activated: boolean;
  is_setup_done: boolean;
  is_signup_screen_visited: boolean;
  user_count: number | undefined;
  is_verified: boolean;
  created_by: string | undefined;
  updated_by: string | undefined;
  workspaces_exist: boolean;
}

/**
 * Runtime operational configuration toggles for a deployed instance — feature
 * flags, provider enablement, and externally-reachable base URLs surfaced to
 * the frontend at boot.
 *
 * Non-obvious field semantics:
 * - `enable_signup`: master switch for self-serve account creation; when false
 *   only invited users can register.
 * - `is_workspace_creation_disabled`: instance-wide gate matching
 *   `TInstanceWorkspaceConfigurationKeys["DISABLE_WORKSPACE_CREATION"]`.
 * - `is_google_enabled`, `is_github_enabled`, `is_gitlab_enabled`,
 *   `is_gitea_enabled`: OAuth provider enablement; derived from the matching
 *   `ENABLE_*_SYNC` server configuration keys.
 * - `is_magic_login_enabled`, `is_email_password_enabled`: built-in
 *   authentication method toggles; both can be false simultaneously only when
 *   at least one OAuth provider is enabled.
 * - `github_app_name`: optional GitHub App slug used by the integration
 *   install link; `undefined` when the integration is not configured.
 * - `slack_client_id`: optional Slack OAuth client used by the Slack
 *   integration; `undefined` when not configured.
 * - `posthog_api_key`, `posthog_host`: optional PostHog telemetry credentials
 *   pushed to the frontend at boot; `undefined` disables PostHog client init.
 * - `has_unsplash_configured`: derived from `TInstanceImageConfigurationKeys`;
 *   enables the Unsplash cover-image picker in `apps/web` and `apps/admin`.
 * - `has_llm_configured`: derived from `TInstanceAIConfigurationKeys`; enables
 *   the AI assist menu in `@plane/editor`.
 * - `file_size_limit`: maximum upload size in bytes enforced by the API
 *   presigned-URL flow; `undefined` falls back to the API default.
 * - `is_smtp_configured`: derived from `TInstanceEmailConfigurationKeys`;
 *   gates the password-reset and magic-link flows that rely on
 *   `apps/api/plane/bgtasks/email_notification_task.py`.
 * - `app_base_url`, `space_base_url`, `admin_base_url`: externally-reachable
 *   URLs of the three frontends; used to cross-link between apps and to
 *   construct webhook + magic-link payloads.
 * - `is_self_managed`: true on community/self-hosted installs; false on the
 *   managed cloud.
 * - `instance_changelog_url`: optional URL displayed in the in-app changelog
 *   widget; omitted on installs without a changelog feed.
 */
export interface IInstanceConfig {
  enable_signup: boolean;
  is_workspace_creation_disabled: boolean;
  is_google_enabled: boolean;
  is_github_enabled: boolean;
  is_gitlab_enabled: boolean;
  is_gitea_enabled: boolean;
  is_magic_login_enabled: boolean;
  is_email_password_enabled: boolean;
  github_app_name: string | undefined;
  slack_client_id: string | undefined;
  posthog_api_key: string | undefined;
  posthog_host: string | undefined;
  has_unsplash_configured: boolean;
  has_llm_configured: boolean;
  file_size_limit: number | undefined;
  is_smtp_configured: boolean;
  app_base_url: string | undefined;
  space_base_url: string | undefined;
  admin_base_url: string | undefined;
  is_self_managed: boolean;
  instance_changelog_url?: string;
}

/**
 * Membership record linking a user to an instance with an administrative role.
 * Drives instance-wide admin permissions in `apps/admin/` and the API
 * `apps/api/plane/license/` admin guards.
 *
 * Non-obvious field semantics:
 * - `instance`: foreign key to the parent `IInstance.id`.
 * - `role`: opaque role string; downstream code compares against the
 *   instance-admin role values defined server-side.
 * - `user_detail`: denormalized `IUserLite` snapshot embedded in the response
 *   to avoid an extra round-trip when rendering admin lists.
 */
export interface IInstanceAdmin {
  created_at: string;
  created_by: string;
  id: string;
  instance: string;
  role: string;
  updated_at: string;
  updated_by: string;
  user: string;
  user_detail: IUserLite;
}

/**
 * Discriminated union of every configuration key persisted on an instance.
 * Drives the runtime config registry used by `apps/admin/` settings screens
 * and the API `apps/api/plane/license/` configuration store.
 *
 * Composition (one literal-string member per provider domain):
 * - `TInstanceAIConfigurationKeys` — AI provider (`LLM_API_KEY`, `LLM_MODEL`).
 * - `TInstanceEmailConfigurationKeys` — SMTP credentials and TLS/SSL toggles.
 * - `TInstanceImageConfigurationKeys` — Unsplash credentials.
 * - `TInstanceAuthenticationKeys` — auth feature flags and OAuth client
 *   credentials.
 * - `TInstanceWorkspaceConfigurationKeys` — instance-scoped workspace defaults.
 */
export type TInstanceConfigurationKeys =
  | TInstanceAIConfigurationKeys
  | TInstanceEmailConfigurationKeys
  | TInstanceImageConfigurationKeys
  | TInstanceAuthenticationKeys
  | TInstanceWorkspaceConfigurationKeys;

/**
 * A single persisted instance-configuration row, keyed by
 * `TInstanceConfigurationKeys`. Each row is one row of the server-side
 * configuration table in `apps/api/plane/license/`.
 *
 * Non-obvious field semantics:
 * - `key`: the configuration's stable string identifier (e.g. `EMAIL_HOST`,
 *   `IS_GOOGLE_ENABLED`).
 * - `value`: serialized as a string regardless of the underlying value type;
 *   consumers must coerce to bool/number where appropriate.
 * - `created_by`, `updated_by`: user IDs of the operator who last touched the
 *   value; `null` when written by a system migration or initial setup.
 */
export interface IInstanceConfiguration {
  id: string;
  created_at: string;
  updated_at: string;
  key: TInstanceConfigurationKeys;
  value: string;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * Flattened key-to-value map produced by collapsing the array of
 * `IInstanceConfiguration` rows into a single object keyed by
 * `TInstanceConfigurationKeys`. Convenient shape for form binding in
 * `apps/admin/` settings screens.
 *
 * Values are stringified — boolean keys are usually `"1"` / `"0"` and numeric
 * keys are decimal strings; consumers coerce on read.
 */
export type IFormattedInstanceConfiguration = {
  [key in TInstanceConfigurationKeys]: string;
};

/**
 * Discriminated union of every login medium recognized on this instance.
 *
 * Composed from the core mediums (`TCoreLoginMediums` — `email`, `magic-code`,
 * `github`, `gitlab`, `google`, `gitea`) extended by the enterprise hook
 * `TExtendedLoginMediums`, which is `never` in community edition. This allows
 * enterprise builds to extend the union without modifying core code.
 */
export type TLoginMediums = TCoreLoginMediums | TExtendedLoginMediums;
