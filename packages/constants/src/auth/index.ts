/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Auth constants barrel — re-exports login-medium labels, password policy
 * thresholds, auth-page/mode/step enums, and structured auth error contracts
 * shared by `apps/web`, `apps/admin`, and `apps/space` auth flows.
 *
 * Consumers: `apps/web/core/components/account/auth-forms/**`,
 * `apps/web/core/components/auth-screens/**`,
 * `apps/web/core/lib/wrappers/authentication-wrapper.tsx`,
 * `apps/web/helpers/authentication.helper.tsx`,
 * `apps/admin/app/(all)/(home)/**`, `apps/admin/components/instance/setup-form.tsx`,
 * `apps/space/components/account/auth-forms/**`,
 * `apps/space/helpers/authentication.helper.tsx`,
 * `packages/utils/src/auth.ts`, `packages/ui/src/auth-form/**`,
 * `packages/ui/src/form-fields/password/**`.
 */

import type { TLoginMediums } from "@plane/types";
import { CORE_LOGIN_MEDIUM_LABELS } from "./core";
import { EXTENDED_LOGIN_MEDIUM_LABELS } from "./extended";

/**
 * Password strength state identifiers surfaced by password input components
 * to drive criteria-met UI and submit-button enablement.
 *
 * Consumers: `packages/ui/src/auth-form/auth-password-input.tsx`,
 * `packages/ui/src/form-fields/password/{helper,indicator}.tsx`,
 * `packages/utils/src/auth.ts`,
 * `apps/web/core/components/account/auth-forms/{password,set-password,reset-password}.tsx`,
 * `apps/web/core/components/settings/profile/content/pages/security.tsx`,
 * `apps/web/core/components/onboarding/{profile-setup.tsx,steps/profile/root.tsx}`,
 * `apps/space/components/account/auth-forms/password.tsx`,
 * `apps/admin/components/instance/setup-form.tsx`.
 *
 * Values:
 * - EMPTY: no password entered yet
 * - LENGTH_NOT_VALID: password fails the minimum length requirement
 * - STRENGTH_NOT_VALID: password meets length but fails additional criteria
 * - STRENGTH_VALID: password satisfies every enabled criterion
 */
export enum E_PASSWORD_STRENGTH {
  EMPTY = "empty",
  LENGTH_NOT_VALID = "length_not_valid",
  STRENGTH_NOT_VALID = "strength_not_valid",
  STRENGTH_VALID = "strength_valid",
}

/**
 * Minimum password length enforced by password inputs and validation utilities
 * across the auth flows. Bound to the `min_8_char` rule in `SPACE_PASSWORD_CRITERIA`.
 *
 * Consumers: same as `SPACE_PASSWORD_CRITERIA` (password inputs, criteria
 * indicators, `packages/utils/src/auth.ts`).
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Password validation rules evaluated by password input UI to render
 * criteria-met indicators and gate form submission. Each entry pairs a stable
 * key, a human-readable label, and a synchronous predicate over the candidate
 * password. Only the `min_8_char` rule is enabled today; upper-case, number,
 * and special-character checks are intentionally commented out and left as
 * placeholders for future tightening of the policy.
 *
 * Consumers: `packages/ui/src/form-fields/password/{helper,indicator}.tsx`,
 * `packages/utils/src/auth.ts`,
 * `apps/web/core/components/account/auth-forms/{password,set-password,reset-password}.tsx`,
 * `apps/space/components/account/auth-forms/password.tsx`,
 * `apps/admin/components/instance/setup-form.tsx`.
 */
export const SPACE_PASSWORD_CRITERIA = [
  {
    key: "min_8_char",
    label: "Min 8 characters",
    isCriteriaValid: (password: string) => password.length >= PASSWORD_MIN_LENGTH,
  },
  // {
  //   key: "min_1_upper_case",
  //   label: "Min 1 upper-case letter",
  //   isCriteriaValid: (password: string) => PASSWORD_NUMBER_REGEX.test(password),
  // },
  // {
  //   key: "min_1_number",
  //   label: "Min 1 number",
  //   isCriteriaValid: (password: string) => PASSWORD_CHAR_CAPS_REGEX.test(password),
  // },
  // {
  //   key: "min_1_special_char",
  //   label: "Min 1 special character",
  //   isCriteriaValid: (password: string) => PASSWORD_SPECIAL_CHAR_REGEX.test(password),
  // },
];

/**
 * Page-level authentication requirement classification consumed by route
 * wrappers to gate rendering and trigger redirects.
 *
 * Consumers: `apps/web/core/lib/wrappers/authentication-wrapper.tsx`,
 * `apps/web/core/components/auth-screens/auth-base.tsx`,
 * `apps/web/core/components/account/auth-forms/auth-header.tsx`,
 * `apps/web/app/(all)/**` route entries.
 *
 * Values:
 * - PUBLIC: no auth required
 * - NON_AUTHENTICATED: must be signed out (e.g. sign-in/sign-up pages)
 * - SET_PASSWORD: signed in but must set a password before continuing
 * - ONBOARDING: signed in but onboarding flow not yet complete
 * - AUTHENTICATED: fully authenticated and onboarded
 */
export enum EAuthPageTypes {
  PUBLIC = "PUBLIC",
  NON_AUTHENTICATED = "NON_AUTHENTICATED",
  SET_PASSWORD = "SET_PASSWORD",
  ONBOARDING = "ONBOARDING",
  AUTHENTICATED = "AUTHENTICATED",
}

/**
 * Auth wrapper page-state identifier used while resolving the user/instance
 * bootstrap response before a final `EAuthPageTypes` decision is rendered.
 *
 * Consumers: `apps/web/core/lib/wrappers/authentication-wrapper.tsx`,
 * `apps/web/app/(home)/page.tsx`,
 * `apps/web/app/(all)/sign-up/page.tsx`,
 * `apps/web/app/(all)/accounts/{forgot-password,reset-password,set-password}/page.tsx`,
 * `apps/web/app/(all)/workspace-invitations/page.tsx`.
 *
 * Values:
 * - INIT: bootstrap fetch in flight
 * - PUBLIC: no auth gate applied
 * - NON_AUTHENTICATED: render an auth surface for an anonymous visitor
 * - ONBOARDING: render the onboarding surface
 * - AUTHENTICATED: render the post-auth surface
 */
export enum EPageTypes {
  INIT = "INIT",
  PUBLIC = "PUBLIC",
  NON_AUTHENTICATED = "NON_AUTHENTICATED",
  ONBOARDING = "ONBOARDING",
  AUTHENTICATED = "AUTHENTICATED",
}

/**
 * Selects which auth flow variant the shared auth form renders.
 *
 * Consumers: `apps/web/core/components/account/auth-forms/{auth-root,form-root,auth-header,unique-code,password}.tsx`,
 * `apps/space/components/account/auth-forms/auth-root.tsx`.
 *
 * Values:
 * - SIGN_IN: sign-in flow (existing account)
 * - SIGN_UP: sign-up flow (new account)
 */
export enum EAuthModes {
  SIGN_IN = "SIGN_IN",
  SIGN_UP = "SIGN_UP",
}

/**
 * Progressive step identifier driving the multi-step auth form
 * (email → password or email → unique code).
 *
 * Consumers: `apps/web/core/components/account/auth-forms/{form-root,auth-root,unique-code,password}.tsx`,
 * `apps/space/components/account/auth-forms/auth-root.tsx`.
 *
 * Values:
 * - EMAIL: collect email
 * - PASSWORD: collect password (password-login flow)
 * - UNIQUE_CODE: collect magic-link OTP (magic-code flow)
 */
export enum EAuthSteps {
  EMAIL = "EMAIL",
  PASSWORD = "PASSWORD",
  UNIQUE_CODE = "UNIQUE_CODE",
}

/**
 * Discriminator selecting how an auth error surface is rendered — full-width
 * banner, toast, or inline beneath a specific form field.
 *
 * Consumers: `apps/web/helpers/authentication.helper.tsx`,
 * `apps/space/helpers/authentication.helper.tsx`,
 * `apps/admin/app/(all)/(home)/auth-banner.tsx`,
 * `apps/web/core/components/account/auth-forms/{auth-root,form-root,reset-password}.tsx`,
 * `apps/space/components/account/auth-forms/auth-banner.tsx`,
 * `packages/utils/src/auth.ts`.
 *
 * Values:
 * - BANNER_ALERT: page-level banner above the form
 * - TOAST_ALERT: transient toast notification
 * - INLINE_FIRST_NAME: inline error beneath the first-name field
 * - INLINE_EMAIL: inline error beneath the email field
 * - INLINE_PASSWORD: inline error beneath the password field
 * - INLINE_EMAIL_CODE: inline error beneath the magic-code field
 */
export enum EErrorAlertType {
  BANNER_ALERT = "BANNER_ALERT",
  TOAST_ALERT = "TOAST_ALERT",
  INLINE_FIRST_NAME = "INLINE_FIRST_NAME",
  INLINE_EMAIL = "INLINE_EMAIL",
  INLINE_PASSWORD = "INLINE_PASSWORD",
  INLINE_EMAIL_CODE = "INLINE_EMAIL_CODE",
}

/**
 * Structured auth-error payload returned by the error-mapping helpers so that
 * the UI can surface a typed alert (`type`), a stable error identifier (`code`),
 * a heading (`title`), and a body (`message`) without parsing raw strings.
 *
 * Consumers: `apps/web/helpers/authentication.helper.tsx`,
 * `apps/space/helpers/authentication.helper.tsx`,
 * `apps/web/core/components/account/auth-forms/{auth-root,form-root,reset-password}.tsx`,
 * `apps/space/components/account/auth-forms/{auth-root,auth-banner}.tsx`,
 * `packages/utils/src/auth.ts`.
 *
 * Fields:
 * - `message`: accepts plain strings or React nodes so localized links and
 *   formatting can be embedded.
 */
export type TAuthErrorInfo = {
  type: EErrorAlertType;
  code: EAuthErrorCodes;
  title: string;
  message: string | React.ReactNode;
};

/**
 * Admin-instance auth error codes returned by `apps/api`'s admin authentication
 * endpoints. The numeric string values mirror the backend codes one-for-one and
 * are echoed back by the admin UI's error-mapping helper.
 *
 * Consumers: `apps/admin/app/(all)/(home)/{auth-helpers,sign-in-form,auth-banner}.tsx`.
 *
 * Values are 4-digit stringified codes in the 5150–5190 range; see the
 * matching admin-error section in `EAuthErrorCodes` for parity.
 */
export enum EAdminAuthErrorCodes {
  // Admin
  ADMIN_ALREADY_EXIST = "5150",
  REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME = "5155",
  INVALID_ADMIN_EMAIL = "5160",
  INVALID_ADMIN_PASSWORD = "5165",
  REQUIRED_ADMIN_EMAIL_PASSWORD = "5170",
  ADMIN_AUTHENTICATION_FAILED = "5175",
  ADMIN_USER_ALREADY_EXIST = "5180",
  ADMIN_USER_DOES_NOT_EXIST = "5185",
  ADMIN_USER_DEACTIVATED = "5190",
}

/**
 * Admin-instance counterpart to `TAuthErrorInfo` — uses `EAdminAuthErrorCodes`
 * for `code` so that admin UI helpers can render errors typed to admin flows.
 *
 * Consumers: `apps/admin/app/(all)/(home)/{auth-helpers,sign-in-form,auth-banner}.tsx`.
 */
export type TAdminAuthErrorInfo = {
  type: EErrorAlertType;
  code: EAdminAuthErrorCodes;
  title: string;
  message: string | React.ReactNode;
};

/**
 * Canonical end-user auth error codes returned by `apps/api`'s authentication
 * endpoints. The string values mirror the backend numeric codes verbatim so
 * the UI helpers can map them to localized `TAuthErrorInfo` payloads without
 * additional translation tables.
 *
 * Consumers: `apps/web/helpers/authentication.helper.tsx`,
 * `apps/space/helpers/authentication.helper.tsx`,
 * `apps/web/core/components/account/auth-forms/{auth-root,form-root,reset-password}.tsx`,
 * `apps/space/components/account/auth-forms/{auth-root,auth-banner}.tsx`,
 * `packages/utils/src/auth.ts`.
 *
 * Groups (see inline `// Group` comments in source):
 * - Global (5000–5019): instance/email/signup config errors
 * - Password strength (5020–5025): invalid/weak password, SMTP not configured
 * - Sign Up (5030–5055): sign-up validation, magic-code sign-up
 * - Sign In (5060–5085): sign-in validation, magic-code sign-in
 * - Magic both flows (5090–5102): invalid/expired/exhausted magic codes
 * - OAuth (5104–5121): provider not configured / provider error
 * - Reset Password (5125–5130): invalid/expired password token
 * - Change Password (5135–5140): incorrect old / missing / invalid new
 * - Set Password (5145): already set
 * - Admin (5150–5190): mirrored from `EAdminAuthErrorCodes`
 * - Rate limit (5900): request throttling
 */
export enum EAuthErrorCodes {
  // Global
  INSTANCE_NOT_CONFIGURED = "5000",
  INVALID_EMAIL = "5005",
  EMAIL_REQUIRED = "5010",
  SIGNUP_DISABLED = "5015",
  MAGIC_LINK_LOGIN_DISABLED = "5016",
  PASSWORD_LOGIN_DISABLED = "5018",
  USER_ACCOUNT_DEACTIVATED = "5019",
  // Password strength
  INVALID_PASSWORD = "5020",
  PASSWORD_TOO_WEAK = "5021",
  SMTP_NOT_CONFIGURED = "5025",
  // Sign Up
  USER_ALREADY_EXIST = "5030",
  AUTHENTICATION_FAILED_SIGN_UP = "5035",
  REQUIRED_EMAIL_PASSWORD_SIGN_UP = "5040",
  INVALID_EMAIL_SIGN_UP = "5045",
  INVALID_EMAIL_MAGIC_SIGN_UP = "5050",
  MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED = "5055",
  // Sign In
  USER_DOES_NOT_EXIST = "5060",
  AUTHENTICATION_FAILED_SIGN_IN = "5065",
  REQUIRED_EMAIL_PASSWORD_SIGN_IN = "5070",
  INVALID_EMAIL_SIGN_IN = "5075",
  INVALID_EMAIL_MAGIC_SIGN_IN = "5080",
  MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED = "5085",
  // Both Sign in and Sign up for magic
  INVALID_MAGIC_CODE_SIGN_IN = "5090",
  INVALID_MAGIC_CODE_SIGN_UP = "5092",
  EXPIRED_MAGIC_CODE_SIGN_IN = "5095",
  EXPIRED_MAGIC_CODE_SIGN_UP = "5097",
  EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN = "5100",
  EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP = "5102",
  // Oauth
  OAUTH_NOT_CONFIGURED = "5104",
  GOOGLE_NOT_CONFIGURED = "5105",
  GITHUB_NOT_CONFIGURED = "5110",
  GITLAB_NOT_CONFIGURED = "5111",
  GOOGLE_OAUTH_PROVIDER_ERROR = "5115",
  GITHUB_OAUTH_PROVIDER_ERROR = "5120",
  GITLAB_OAUTH_PROVIDER_ERROR = "5121",
  // Reset Password
  INVALID_PASSWORD_TOKEN = "5125",
  EXPIRED_PASSWORD_TOKEN = "5130",
  // Change password
  INCORRECT_OLD_PASSWORD = "5135",
  MISSING_PASSWORD = "5138",
  INVALID_NEW_PASSWORD = "5140",
  // set password
  PASSWORD_ALREADY_SET = "5145",
  // Admin
  ADMIN_ALREADY_EXIST = "5150",
  REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME = "5155",
  INVALID_ADMIN_EMAIL = "5160",
  INVALID_ADMIN_PASSWORD = "5165",
  REQUIRED_ADMIN_EMAIL_PASSWORD = "5170",
  ADMIN_AUTHENTICATION_FAILED = "5175",
  ADMIN_USER_ALREADY_EXIST = "5180",
  ADMIN_USER_DOES_NOT_EXIST = "5185",
  ADMIN_USER_DEACTIVATED = "5190",
  // Rate limit
  RATE_LIMIT_EXCEEDED = "5900",
}

/**
 * Unified human-readable label map for every supported login medium, built by
 * merging `CORE_LOGIN_MEDIUM_LABELS` with `EXTENDED_LOGIN_MEDIUM_LABELS`. This
 * is the single source of truth UI should consume when translating a
 * normalized login-medium key (e.g. `email`, `github`) into display text.
 *
 * Consumers: `apps/web/ce/components/workspace/settings/useMemberColumns.tsx`,
 * and any future consumer needing a `TLoginMediums` → label lookup.
 */
export const LOGIN_MEDIUM_LABELS: Record<TLoginMediums, string> = {
  ...CORE_LOGIN_MEDIUM_LABELS,
  ...EXTENDED_LOGIN_MEDIUM_LABELS,
} as const;
