/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Community-edition auth contracts (sign-in modes, feature-flag keys, per-provider
 * OAuth credential keys, login mediums) consumed by `apps/admin/`, `apps/web`
 * auth UI, and `apps/api/plane/authentication/`; EE extensions hook in via
 * `auth-ee.ts`.
 */

/**
 * Community-edition auth-mode identifiers; `"unique-codes"` is magic-link /
 * one-time-code sign-in and `"passwords-login"` is email + password.
 */
export type TCoreInstanceAuthenticationModeKeys =
  | "unique-codes"
  | "passwords-login"
  | "google"
  | "github"
  | "gitlab"
  | "gitea";

/**
 * Active auth-mode key set — identical to `TCoreInstanceAuthenticationModeKeys`
 * in CE; re-aliased here so enterprise builds can widen it without touching
 * downstream call sites.
 */
export type TInstanceAuthenticationModeKeys = TCoreInstanceAuthenticationModeKeys;

/**
 * UI metadata for one auth-mode row in the admin settings; `enabledConfigKey`
 * binds the toggle to the matching `TInstanceAuthenticationMethodKeys` value,
 * and `unavailable=true` renders the row disabled with an upsell label.
 */
export type TInstanceAuthenticationModes = {
  key: TInstanceAuthenticationModeKeys;
  name: string;
  description: string;
  icon: React.ReactNode;
  config: React.ReactNode;
  enabledConfigKey: TInstanceAuthenticationMethodKeys;
  unavailable?: boolean;
};

/**
 * Runtime feature-flag keys for each auth method (master signup switch,
 * magic-link / password modes, and per-provider OAuth enablement) consumed
 * by `apps/api/plane/authentication/`.
 */
export type TInstanceAuthenticationMethodKeys =
  | "ENABLE_SIGNUP"
  | "ENABLE_MAGIC_LINK_LOGIN"
  | "ENABLE_EMAIL_PASSWORD"
  | "IS_GOOGLE_ENABLED"
  | "IS_GITHUB_ENABLED"
  | "IS_GITLAB_ENABLED"
  | "IS_GITEA_ENABLED";

/**
 * Google OAuth credential keys (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
 * `ENABLE_GOOGLE_SYNC`); the client secret is masked on read, and the
 * provider-level sync flag is separate from instance-level `IS_GOOGLE_ENABLED`.
 */
export type TInstanceGoogleAuthenticationConfigurationKeys =
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "ENABLE_GOOGLE_SYNC";

/**
 * GitHub OAuth credential keys; `GITHUB_ORGANIZATION_ID` is an optional
 * restriction (only members of the named org may sign in when set), and the
 * client secret is masked on read.
 */
export type TInstanceGithubAuthenticationConfigurationKeys =
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GITHUB_ORGANIZATION_ID"
  | "ENABLE_GITHUB_SYNC";

/**
 * GitLab OAuth credential keys; `GITLAB_HOST` is the base URL (supports
 * self-hosted instances, defaults to `https://gitlab.com` when unset) and
 * the client secret is masked on read.
 */
export type TInstanceGitlabAuthenticationConfigurationKeys =
  | "GITLAB_HOST"
  | "GITLAB_CLIENT_ID"
  | "GITLAB_CLIENT_SECRET"
  | "ENABLE_GITLAB_SYNC";

/**
 * Gitea OAuth credential keys; `GITEA_HOST` is required (Gitea is self-hosted
 * only — no SaaS host) and the client secret is masked on read.
 */
export type TInstanceGiteaAuthenticationConfigurationKeys =
  | "GITEA_HOST"
  | "GITEA_CLIENT_ID"
  | "GITEA_CLIENT_SECRET"
  | "ENABLE_GITEA_SYNC";

/**
 * Union of every OAuth-provider configuration key across all four supported
 * providers. Composed from the per-provider key unions above.
 */
export type TInstanceAuthenticationConfigurationKeys =
  | TInstanceGoogleAuthenticationConfigurationKeys
  | TInstanceGithubAuthenticationConfigurationKeys
  | TInstanceGitlabAuthenticationConfigurationKeys
  | TInstanceGiteaAuthenticationConfigurationKeys;

/**
 * Full union of all auth-related instance configuration keys — both the
 * feature-flag keys (`TInstanceAuthenticationMethodKeys`) and the OAuth
 * provider credential keys (`TInstanceAuthenticationConfigurationKeys`).
 *
 * Composed into `TInstanceConfigurationKeys` in `./base.ts`.
 */
export type TInstanceAuthenticationKeys = TInstanceAuthenticationMethodKeys | TInstanceAuthenticationConfigurationKeys;

/**
 * Base props for every auth-mode panel in `apps/admin/`; `updateConfig`
 * always receives a string value (the API coerces booleans), and
 * `resolvedTheme` is used to swap brand SVGs that are not theme-aware.
 */
export type TGetBaseAuthenticationModeProps = {
  disabled: boolean;
  updateConfig: (key: TInstanceAuthenticationMethodKeys, value: string) => void;
  resolvedTheme: string | undefined;
};

/**
 * Single OAuth provider button for the public sign-in screens; `onClick`
 * triggers the OAuth redirect handshake, and `enabled` defaults to `true`
 * when omitted (false renders disabled with a tooltip).
 */
export type TOAuthOption = {
  id: string;
  text: string;
  icon: React.ReactNode;
  onClick: () => void;
  enabled?: boolean;
};

/**
 * Aggregate OAuth panel config for public auth screens; `oAuthOptions` is
 * ordered by admin-configured priority and `isOAuthEnabled` is true when at
 * least one of the four providers is enabled at runtime.
 */
export type TOAuthConfigs = {
  isOAuthEnabled: boolean;
  oAuthOptions: TOAuthOption[];
};

/**
 * Community-edition login medium identifiers (`"email"` + password,
 * `"magic-code"` one-time code, and the four OAuth providers); extended in
 * EE via `TExtendedLoginMediums` and unioned into `TLoginMediums` in `./base.ts`.
 */
export type TCoreLoginMediums = "email" | "magic-code" | "github" | "gitlab" | "google" | "gitea";
