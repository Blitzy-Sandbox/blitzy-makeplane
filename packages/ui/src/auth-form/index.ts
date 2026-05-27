/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Auth-form barrel — public surface of Plane's reusable sign-in / sign-up primitives.
 *
 * Components:
 *   - `AuthForm`                  Composition root wiring email + password + confirm-password +
 *                                 forgot-password into a controlled sign-in / sign-up layout.
 *   - `AuthInput`                 Base styled input used across all auth fields.
 *   - `AuthPasswordInput`         Wraps `AuthInput` with password strength + visibility toggle.
 *   - `AuthConfirmPasswordInput`  Wraps `AuthInput` with password-match validation.
 *   - `AuthForgotPassword`        Stateless `<button>` invoking a parent-supplied callback.
 *
 * Types: `AuthFormProps`, `AuthFormData`, `AuthMode`, `TAuthInputProps`,
 * `TAuthPasswordInputProps`, `TAuthConfirmPasswordInputProps`, `AuthForgotPasswordProps`.
 *
 * These primitives are state-agnostic — they hold only local UI state (focus, visibility
 * toggle) and delegate every behavioral concern (validation, submission, navigation) to the
 * consumer via callback props.
 *
 * INTENT UNCLEAR: this barrel is not re-exported from `packages/ui/src/index.ts`, and no
 * consumer of `AuthForm`, `AuthInput`, `AuthPasswordInput`, `AuthConfirmPasswordInput`, or
 * `AuthForgotPassword` was found in `apps/web`, `apps/admin`, or `apps/space`. The file may
 * be dead code or pending future wiring; `apps/web/core/components/account/auth-forms/`
 * defines its own `AuthFormRoot`/`AuthFormHeader` that do NOT import from this module.
 */

export { AuthForm } from "./auth-form";
export { AuthInput } from "./auth-input";
export { AuthPasswordInput } from "./auth-password-input";
export { AuthConfirmPasswordInput } from "./auth-confirm-password-input";
export { AuthForgotPassword } from "./auth-forgot-password";

export type { AuthFormProps, AuthFormData, AuthMode } from "./auth-form";
export type { TAuthInputProps } from "./auth-input";
export type { TAuthPasswordInputProps } from "./auth-password-input";
export type { TAuthConfirmPasswordInputProps } from "./auth-confirm-password-input";
export type { AuthForgotPasswordProps } from "./auth-forgot-password";
