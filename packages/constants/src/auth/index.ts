/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Auth constants barrel — login-medium labels, password policy, auth page/mode/step
 * enums, and structured auth error contracts shared by `apps/{web,admin,space}` auth flows.
 */

import type { TLoginMediums } from "@plane/types";
import { CORE_LOGIN_MEDIUM_LABELS } from "./core";
import { EXTENDED_LOGIN_MEDIUM_LABELS } from "./extended";

/**
 * Password strength state identifiers (EMPTY / LENGTH_NOT_VALID / STRENGTH_NOT_VALID /
 * STRENGTH_VALID) driving criteria-met UI and submit-button enablement.
 * Consumers: `packages/ui/src/{auth-form,form-fields/password}/**`,
 * `apps/web/core/components/account/auth-forms/**`, `apps/{space,admin}` auth forms.
 */
export enum E_PASSWORD_STRENGTH {
  EMPTY = "empty",
  LENGTH_NOT_VALID = "length_not_valid",
  STRENGTH_NOT_VALID = "strength_not_valid",
  STRENGTH_VALID = "strength_valid",
}

/**
 * Minimum password length (bound to `min_8_char` in `SPACE_PASSWORD_CRITERIA`).
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Password validation rules (`{key,label,isCriteriaValid}` triples); only `min_8_char`
 * is enabled today (upper-case/number/special-char checks commented out for future).
 * Consumers: `packages/ui/src/form-fields/password/**`, `packages/utils/src/auth.ts`.
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
 * Page-level auth requirement classification (PUBLIC / NON_AUTHENTICATED /
 * SET_PASSWORD / ONBOARDING / AUTHENTICATED) consumed by route wrappers for redirects.
 * Consumer: `apps/web/core/lib/wrappers/authentication-wrapper.tsx`.
 */
export enum EAuthPageTypes {
  PUBLIC = "PUBLIC",
  NON_AUTHENTICATED = "NON_AUTHENTICATED",
  SET_PASSWORD = "SET_PASSWORD",
  ONBOARDING = "ONBOARDING",
  AUTHENTICATED = "AUTHENTICATED",
}

/**
 * Bootstrap auth-wrapper state (INIT / PUBLIC / NON_AUTHENTICATED / ONBOARDING /
 * AUTHENTICATED) used during user/instance fetch before a final `EAuthPageTypes` renders.
 * Consumer: `apps/web/core/lib/wrappers/authentication-wrapper.tsx`.
 */
export enum EPageTypes {
  INIT = "INIT",
  PUBLIC = "PUBLIC",
  NON_AUTHENTICATED = "NON_AUTHENTICATED",
  ONBOARDING = "ONBOARDING",
  AUTHENTICATED = "AUTHENTICATED",
}

/**
 * Auth flow variant selector (SIGN_IN / SIGN_UP) for the shared auth form.
 * Consumers: `apps/{web,space}/core/components/account/auth-forms/**`.
 */
export enum EAuthModes {
  SIGN_IN = "SIGN_IN",
  SIGN_UP = "SIGN_UP",
}

/**
 * Multi-step auth form progression (EMAIL → PASSWORD for password flow or EMAIL →
 * UNIQUE_CODE for magic-code flow).
 * Consumers: `apps/{web,space}/core/components/account/auth-forms/**`.
 */
export enum EAuthSteps {
  EMAIL = "EMAIL",
  PASSWORD = "PASSWORD",
  UNIQUE_CODE = "UNIQUE_CODE",
}

/**
 * Auth error surface rendering discriminator (BANNER / TOAST / INLINE per field).
 * Consumers: `apps/{web,space}/helpers/authentication.helper.tsx`, `packages/utils/src/auth.ts`.
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
 * Structured auth-error payload (`type`/`code`/`title`/`message`) where `message`
 * accepts React nodes to embed localized links/formatting.
 * Consumers: `apps/{web,space}/helpers/authentication.helper.tsx`.
 */
export type TAuthErrorInfo = {
  type: EErrorAlertType;
  code: EAuthErrorCodes;
  title: string;
  message: string | React.ReactNode;
};

/**
 * Admin-instance auth error codes (stringified 5150–5190) mirroring backend admin
 * authentication endpoint responses; parity with admin section of `EAuthErrorCodes`.
 * Consumer: `apps/admin/app/(all)/(home)/**`.
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
 * Admin-instance counterpart to `TAuthErrorInfo` typed against `EAdminAuthErrorCodes`.
 * Consumer: `apps/admin/app/(all)/(home)/**`.
 */
export type TAdminAuthErrorInfo = {
  type: EErrorAlertType;
  code: EAdminAuthErrorCodes;
  title: string;
  message: string | React.ReactNode;
};

/**
 * End-user auth error codes (stringified backend codes) — see inline `// Group`
 * markers below for ranges (Global 5000s, Password 5020s, Sign Up 5030s, Sign In
 * 5060s, Magic 5090s, OAuth 5104+, Reset 5125+, Change 5135+, Set 5145, Admin 5150s, Rate 5900).
 * Consumers: `apps/{web,space}/helpers/authentication.helper.tsx`, `packages/utils/src/auth.ts`.
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
 * Unified `TLoginMediums` → label map (merge of core + extended); the canonical
 * lookup for translating login-medium keys (`email`, `github`, …) into display text.
 * Consumer: `apps/web/ce/components/workspace/settings/useMemberColumns.tsx`.
 */
export const LOGIN_MEDIUM_LABELS: Record<TLoginMediums, string> = {
  ...CORE_LOGIN_MEDIUM_LABELS,
  ...EXTENDED_LOGIN_MEDIUM_LABELS,
} as const;
