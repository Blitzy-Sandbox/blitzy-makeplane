/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Singleton instance identity + runtime config contracts mirroring
 * `apps/api/plane/license/` models; consumed by `apps/admin/` (read/write)
 * and `apps/web` (read-only display of `is_smtp_configured`/`has_llm_configured`/
 * `enable_signup` etc.).
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
 * Canonical instance entity mirroring `apps/api/plane/license/` models;
 * `instance_id` (server-assigned at registration) is distinct from `id`
 * (DB PK), `license_key` is present only on activated paid deployments, and
 * `workspaces_exist=false` redirects sign-in to workspace creation.
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
 * Runtime feature-flag + provider-enablement + base-URL snapshot surfaced to
 * the frontend at boot; `has_*_configured` booleans are derived from the
 * presence of the matching server-side configuration rows, and the magic-link
 * and email/password toggles may both be false only when at least one OAuth
 * provider is enabled.
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
 * Instance-admin membership row driving admin permissions in `apps/admin/`
 * and `apps/api/plane/license/` guards; `user_detail` is a denormalized
 * `IUserLite` embedded to avoid a second round-trip when rendering lists.
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
 * Union of every configuration key persisted on an instance, composed from
 * the per-domain unions (AI, email, image, auth, workspace); drives
 * `apps/admin/` settings screens and the API license configuration store.
 */
export type TInstanceConfigurationKeys =
  | TInstanceAIConfigurationKeys
  | TInstanceEmailConfigurationKeys
  | TInstanceImageConfigurationKeys
  | TInstanceAuthenticationKeys
  | TInstanceWorkspaceConfigurationKeys;

/**
 * Single persisted instance-configuration row keyed by `TInstanceConfigurationKeys`;
 * `value` is always a string (consumers coerce to bool/number) and the audit
 * `created_by`/`updated_by` are `null` when written by migrations or setup.
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
 * Flattened key→value map collapsed from `IInstanceConfiguration` rows for
 * admin form binding; boolean keys are typically `"1"`/`"0"` and numeric keys
 * are decimal strings (consumers coerce on read).
 */
export type IFormattedInstanceConfiguration = {
  [key in TInstanceConfigurationKeys]: string;
};

/**
 * Union of every login medium recognized on the instance — core mediums
 * (`TCoreLoginMediums`) extended by `TExtendedLoginMediums` (`never` in CE,
 * widened by the EE overlay).
 */
export type TLoginMediums = TCoreLoginMediums | TExtendedLoginMediums;
