/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Community-edition authentication contracts for the `@plane/types/instance`
 * subfolder. Models sign-in modes (password / magic-link / Google / GitHub /
 * GitLab / Gitea), method/feature-flag keys, per-provider OAuth client
 * configuration keys, and the core login medium union.
 *
 * CE vs EE: this file covers the community edition only. Enterprise-edition
 * extensions (SAML/OIDC/SCIM) hook in via `auth-ee.ts` through
 * `TExtendedLoginMediums` and `TExtendedInstanceAuthenticationModeKeys`.
 *
 * Consumers: `apps/admin/` authentication settings screens, the auth UI in
 * `apps/web` (sign-in / sign-up forms), and the server-side handler tree in
 * `apps/api/plane/authentication/`.
 */

/**
 * Stable literal-string identifiers for each authentication mode available in
 * the community edition. Each value corresponds to one row in the auth-modes
 * registry rendered on the admin auth settings screen.
 *
 * Non-obvious members:
 * - `unique-codes`: magic-link / one-time-code sign-in.
 * - `passwords-login`: traditional email + password sign-in.
 */
export type TCoreInstanceAuthenticationModeKeys =
  | "unique-codes"
  | "passwords-login"
  | "google"
  | "github"
  | "gitlab"
  | "gitea";

/**
 * Active auth-mode key set — currently identical to
 * `TCoreInstanceAuthenticationModeKeys` in community edition. Re-aliased here
 * so enterprise builds can widen it without touching downstream call sites.
 */
export type TInstanceAuthenticationModeKeys = TCoreInstanceAuthenticationModeKeys;

/**
 * UI metadata describing one authentication mode row in the admin auth
 * settings screen.
 *
 * Non-obvious field semantics:
 * - `key`: stable identifier; matches one member of
 *   `TInstanceAuthenticationModeKeys`.
 * - `icon`, `config`: pre-rendered React nodes — the provider's branded icon
 *   and the inline credential-input panel that becomes visible when the row
 *   is expanded.
 * - `enabledConfigKey`: the matching `IS_*_ENABLED` / `ENABLE_*` key in
 *   `TInstanceAuthenticationMethodKeys` that drives the toggle.
 * - `unavailable`: when true the row renders disabled with an upsell label
 *   (e.g. enterprise-only providers shown in community builds).
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
 * Configuration keys controlling whether each auth method is enabled at
 * runtime. Persisted in the instance configuration table and surfaced on the
 * admin auth settings screen as a toggle per row.
 *
 * Each value is the literal storage key consumed by
 * `apps/api/plane/authentication/`:
 * - `ENABLE_SIGNUP` — master self-serve registration switch.
 * - `ENABLE_MAGIC_LINK_LOGIN` — magic-link / unique-codes mode toggle.
 * - `ENABLE_EMAIL_PASSWORD` — email + password mode toggle.
 * - `IS_GOOGLE_ENABLED` / `IS_GITHUB_ENABLED` / `IS_GITLAB_ENABLED` /
 *   `IS_GITEA_ENABLED` — per-provider OAuth enablement.
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
 * Google OAuth client credential keys.
 *
 * Field-level semantics:
 * - `GOOGLE_CLIENT_ID`: OAuth client identifier from Google Cloud Console
 *   (public, but treated as sensitive in transport).
 * - `GOOGLE_CLIENT_SECRET`: OAuth client secret; never echoed back to the
 *   frontend after write (masked by the API).
 * - `ENABLE_GOOGLE_SYNC`: provider-level enablement flag, separate from the
 *   instance-level `IS_GOOGLE_ENABLED` toggle.
 */
export type TInstanceGoogleAuthenticationConfigurationKeys =
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "ENABLE_GOOGLE_SYNC";

/**
 * GitHub OAuth client credential keys.
 *
 * Field-level semantics:
 * - `GITHUB_CLIENT_ID`: OAuth App client ID from GitHub developer settings.
 * - `GITHUB_CLIENT_SECRET`: OAuth client secret; masked by the API after write.
 * - `GITHUB_ORGANIZATION_ID`: optional organization restriction — when set,
 *   only members of the named GitHub org may sign in via this provider.
 * - `ENABLE_GITHUB_SYNC`: provider-level enablement flag.
 */
export type TInstanceGithubAuthenticationConfigurationKeys =
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GITHUB_ORGANIZATION_ID"
  | "ENABLE_GITHUB_SYNC";

/**
 * GitLab OAuth client credential keys.
 *
 * Field-level semantics:
 * - `GITLAB_HOST`: base URL of the GitLab instance (self-hosted GitLab is
 *   supported); defaults to `https://gitlab.com` when unset.
 * - `GITLAB_CLIENT_ID`: OAuth application ID from the GitLab admin area.
 * - `GITLAB_CLIENT_SECRET`: OAuth secret; masked by the API after write.
 * - `ENABLE_GITLAB_SYNC`: provider-level enablement flag.
 */
export type TInstanceGitlabAuthenticationConfigurationKeys =
  | "GITLAB_HOST"
  | "GITLAB_CLIENT_ID"
  | "GITLAB_CLIENT_SECRET"
  | "ENABLE_GITLAB_SYNC";

/**
 * Gitea OAuth client credential keys.
 *
 * Field-level semantics:
 * - `GITEA_HOST`: base URL of the Gitea instance (self-hosted only — Gitea has
 *   no SaaS host).
 * - `GITEA_CLIENT_ID`: OAuth application client ID from Gitea admin.
 * - `GITEA_CLIENT_SECRET`: OAuth secret; masked by the API after write.
 * - `ENABLE_GITEA_SYNC`: provider-level enablement flag.
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
 * Base props contract shared by every auth-mode panel component in
 * `apps/admin/`.
 *
 * Non-obvious field semantics:
 * - `disabled`: passed through to inner form fields; true while a sibling
 *   update is in flight to prevent overlapping writes.
 * - `updateConfig`: handler that writes a `TInstanceAuthenticationMethodKeys`
 *   value back to the API; the value is always a string (the API coerces
 *   booleans).
 * - `resolvedTheme`: current resolved theme name (`light` / `dark` / etc.);
 *   used to swap brand SVGs that are not theme-aware.
 */
export type TGetBaseAuthenticationModeProps = {
  disabled: boolean;
  updateConfig: (key: TInstanceAuthenticationMethodKeys, value: string) => void;
  resolvedTheme: string | undefined;
};

/**
 * Single OAuth provider button displayed on the public sign-in / sign-up
 * screens.
 *
 * Non-obvious field semantics:
 * - `onClick`: triggers the OAuth redirect handshake; resolves after the
 *   browser navigates away.
 * - `enabled`: optional — when false the button renders disabled with a
 *   tooltip; defaults to true when omitted.
 */
export type TOAuthOption = {
  id: string;
  text: string;
  icon: React.ReactNode;
  onClick: () => void;
  enabled?: boolean;
};

/**
 * Aggregate OAuth panel configuration handed to the public auth screens.
 *
 * - `isOAuthEnabled`: true when at least one of the four providers is
 *   enabled at runtime.
 * - `oAuthOptions`: ordered list of enabled provider buttons; render order
 *   matches admin-configured priority.
 */
export type TOAuthConfigs = {
  isOAuthEnabled: boolean;
  oAuthOptions: TOAuthOption[];
};

/**
 * Core login medium identifiers — the channels a user can authenticate
 * through in community edition.
 *
 * - `email`: email + password.
 * - `magic-code`: one-time code / magic link.
 * - `github`, `gitlab`, `google`, `gitea`: OAuth providers.
 *
 * Extended in enterprise edition through `TExtendedLoginMediums` (see
 * `./auth-ee.ts`); the two are unioned into `TLoginMediums` in `./base.ts`.
 */
export type TCoreLoginMediums = "email" | "magic-code" | "github" | "gitlab" | "google" | "gitea";
