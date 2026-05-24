/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * User-facing authentication flow contracts for the `@plane/types` package.
 *
 * Models the request/response shapes consumed by `apps/web`'s sign-in/sign-up flow —
 * email-check pre-auth probe, magic-link sign-in, password sign-in, JWT login tokens,
 * and CSRF token retrieval. Distinct from `./instance/auth.ts` which configures the
 * server-side auth provider matrix (admin surface).
 */

/**
 * Sign-in method discriminator returned by the email-check pre-auth probe.
 *
 * Union values:
 * - `magic_code`: the user should receive a one-time code by email
 * - `password`: the user should be prompted for a password
 */
export type TEmailCheckTypes = "magic_code" | "password";

/**
 * Request payload for the email-check pre-auth probe.
 *
 * Sent before showing password vs. magic-code form to determine which path applies.
 */
export interface IEmailCheckData {
  email: string;
}

/**
 * Response from the email-check pre-auth probe.
 *
 * Fields:
 * - `status`: `MAGIC_CODE` if magic-link should be sent, `CREDENTIAL` if password prompt should show
 * - `existing`: true when the email matches an existing user (false routes to sign-up)
 * - `is_password_autoset`: true when the existing user has never set a password — magic-link
 *   should be used even though `status === "CREDENTIAL"` is technically possible
 */
export interface IEmailCheckResponse {
  status: "MAGIC_CODE" | "CREDENTIAL";
  existing: boolean;
  is_password_autoset: boolean;
}

/**
 * JWT envelope returned on successful sign-in.
 *
 * Fields:
 * - `access_token`: short-lived bearer token (sent on every API request)
 * - `refresh_token`: long-lived token used to mint new access tokens
 */
export interface ILoginTokenResponse {
  access_token: string;
  refresh_token: string;
}

/**
 * Request payload for finalizing magic-link sign-in.
 *
 * Fields:
 * - `email`: email being signed in
 * - `key`: opaque server-issued key bound to the magic-link request
 * - `token`: the one-time code from the email
 */
export interface IMagicSignInData {
  email: string;
  key: string;
  token: string;
}

/**
 * Request payload for password-based sign-in.
 */
export interface IPasswordSignInData {
  email: string;
  password: string;
}

/**
 * CSRF token retrieval response.
 *
 * Used to seed the CSRF cookie/header pair before mutating endpoints; required for all
 * `apps/web` POST/PATCH/DELETE calls that originate from form submission.
 */
export interface ICsrfTokenData {
  csrf_token: string;
}
