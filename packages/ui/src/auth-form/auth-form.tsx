/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition root for sign-in/sign-up auth flows, wiring together the auth-input, password,
 * confirm-password, and forgot-password primitives into a single controlled form.
 */

import React, { useState, useMemo } from "react";
import { E_PASSWORD_STRENGTH } from "@plane/constants";
import { Button } from "../button/button";
import { Spinner } from "../spinners/circular-spinner";
import { cn } from "../utils";
import { AuthConfirmPasswordInput } from "./auth-confirm-password-input";
import { AuthForgotPassword } from "./auth-forgot-password";
import { AuthInput } from "./auth-input";
import { AuthPasswordInput } from "./auth-password-input";

/**
 * Operating mode of the `AuthForm`: `"sign-in"` exposes the forgot-password link only,
 * `"sign-up"` reveals the confirm-password field and the password-strength indicator.
 */
export type AuthMode = "sign-in" | "sign-up";

/**
 * Controlled form payload emitted by `AuthForm` via `onSubmit`. `confirmPassword` is only
 * populated when `mode === "sign-up"`.
 */
export interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
}

/**
 * Props for `AuthForm`. The form is fully controlled by the parent through `mode`, optional
 * error strings, and the three callback hooks (`onSubmit`, `onForgotPassword`, `onModeChange`).
 *
 * `loading` short-circuits the submit button to a spinner; `disabled` deactivates every input.
 * `showPasswordStrength` only takes effect in sign-up mode (gated internally), and the
 * `*ButtonText` / `alternateMode*` props let consumers override the default sign-in/sign-up
 * copy without subclassing the component.
 */
export interface AuthFormProps {
  mode: AuthMode;
  initialData?: Partial<AuthFormData>;
  onSubmit?: (data: AuthFormData) => void;
  onForgotPassword?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  showForgotPassword?: boolean;
  showPasswordStrength?: boolean;
  emailError?: string;
  passwordError?: string;
  confirmPasswordError?: string;
  submitButtonText?: string;
  alternateModeText?: string;
  alternateModeButtonText?: string;
}

/**
 * Controlled sign-in / sign-up form orchestrating the auth-form primitives in a single layout.
 *
 * Holds local state for the three controlled values (email, password, confirmPassword), the
 * derived password strength reported by `AuthPasswordInput`, and a private match flag updated
 * by `AuthConfirmPasswordInput`. The memoized `isFormValid` gate blocks submission unless the
 * mandatory fields are populated and — in sign-up mode — the password reaches
 * `E_PASSWORD_STRENGTH.STRENGTH_VALID` and matches `confirmPassword`.
 *
 * Sign-in mode renders email + password + (optional) forgot-password link.
 * Sign-up mode additionally renders the confirm-password field and the password-strength UI.
 *
 * Side effects via parent-supplied callbacks (all optional):
 *   - `onSubmit(formData)`: invoked on form submit only when `isFormValid` is true; native
 *     submit default is suppressed.
 *   - `onForgotPassword()`: forwarded from the embedded `AuthForgotPassword` (sign-in only).
 *   - `onModeChange(newMode)`: fired by the alternate-mode toggle (button, type="button" so it
 *     does not submit the form).
 *
 * State neutrality: `@plane/ui` components are state-agnostic primitives. This component does
 * NOT read any MobX store; consumers wire `onSubmit` to Plane's session-based auth flow.
 *
 * Props: see `AuthFormProps`.
 *
 * Accessibility: native HTML form semantics provide submit-on-Enter and focus management.
 * INTENT UNCLEAR: per-field error strings are forwarded to children but no `aria-describedby`
 * linkage from input to error message is wired at this level — error-to-input announcement is
 * delegated to the child components and is not currently implemented there either.
 */
export function AuthForm({
  mode,
  initialData = {},
  onSubmit,
  onForgotPassword,
  onModeChange,
  loading = false,
  disabled = false,
  className = "",
  showForgotPassword = true,
  showPasswordStrength = true,
  emailError,
  passwordError,
  confirmPasswordError,
  submitButtonText,
  alternateModeText,
  alternateModeButtonText,
}: AuthFormProps) {
  const [formData, setFormData] = useState<AuthFormData>({
    email: initialData.email || "",
    password: initialData.password || "",
    confirmPassword: initialData.confirmPassword || "",
  });

  const [passwordStrength, setPasswordStrength] = useState<E_PASSWORD_STRENGTH>(E_PASSWORD_STRENGTH.EMPTY);
  const [_passwordsMatch, setPasswordsMatch] = useState(false);

  const handleInputChange = (field: keyof AuthFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [field]: e.target.value,
    }));
  };

  const handlePasswordChange = (password: string) => {
    setFormData((prev) => ({
      ...prev,
      password,
    }));
  };

  const handlePasswordStrengthChange = (strength: E_PASSWORD_STRENGTH) => {
    setPasswordStrength(strength);
  };

  const handleConfirmPasswordChange = (matches: boolean) => {
    setPasswordsMatch(matches);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit && isFormValid) {
      onSubmit(formData);
    }
  };

  const handleModeChange = () => {
    const newMode = mode === "sign-in" ? "sign-up" : "sign-in";
    onModeChange?.(newMode);
  };

  const isFormValid = useMemo(() => {
    const hasEmail = formData.email.length > 0;
    const hasPassword = formData.password.length > 0;

    if (mode === "sign-in") {
      return hasEmail && hasPassword && !loading && !disabled;
    } else {
      const isPasswordStrong = passwordStrength === E_PASSWORD_STRENGTH.STRENGTH_VALID;
      const passwordsMatch = formData.password === formData.confirmPassword && formData.password.length > 0;
      return hasEmail && hasPassword && isPasswordStrong && passwordsMatch && !loading && !disabled;
    }
  }, [mode, formData, passwordStrength, loading, disabled]);

  const getSubmitButtonText = () => {
    if (submitButtonText) return submitButtonText;
    return mode === "sign-in" ? "Sign In" : "Create Account";
  };

  const getAlternateModeText = () => {
    if (alternateModeText) return alternateModeText;
    return mode === "sign-in" ? "Don't have an account?" : "Already have an account?";
  };

  const getAlternateModeButtonText = () => {
    if (alternateModeButtonText) return alternateModeButtonText;
    return mode === "sign-in" ? "Sign Up" : "Sign In";
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      {/* Email Input */}
      <AuthInput
        id="email"
        name="email"
        type="email"
        label="Email"
        value={formData.email}
        onChange={handleInputChange("email")}
        placeholder="name@company.com"
        error={emailError}
        disabled={disabled}
        // autoComplete="email"
        required
      />

      {/* Password Input */}
      <AuthPasswordInput
        id="password"
        name="password"
        label={mode === "sign-in" ? "Password" : "Set a password"}
        value={formData.password}
        onChange={handleInputChange("password")}
        onPasswordChange={handlePasswordChange}
        onPasswordStrengthChange={handlePasswordStrengthChange}
        placeholder="Enter password"
        error={passwordError}
        showPasswordStrength={showPasswordStrength && mode === "sign-up"}
        disabled={disabled}
        // autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        required
      />

      {/* Confirm Password Input (Sign Up Only) */}
      {mode === "sign-up" && (
        <AuthConfirmPasswordInput
          id="confirmPassword"
          name="confirmPassword"
          password={formData.password}
          value={formData.confirmPassword}
          onChange={handleInputChange("confirmPassword")}
          onPasswordMatchChange={handleConfirmPasswordChange}
          error={confirmPasswordError}
          disabled={disabled}
          // autoComplete="new-password"
          required
        />
      )}

      {/* Forgot Password Link (Sign In Only) */}
      {mode === "sign-in" && showForgotPassword && (
        <div className="flex justify-end">
          <AuthForgotPassword onForgotPassword={onForgotPassword} disabled={disabled} />
        </div>
      )}

      {/* Submit Button */}
      <div className="space-y-2.5">
        <Button type="submit" variant="primary" className="w-full" size="lg" disabled={!isFormValid} loading={loading}>
          {loading ? <Spinner height="20px" width="20px" /> : getSubmitButtonText()}
        </Button>

        {/* Alternate Mode Button */}
        {onModeChange && (
          <div className="text-center">
            <span className="text-13 text-tertiary">{getAlternateModeText()}</span>
            <button
              type="button"
              onClick={handleModeChange}
              className="ml-1 text-13 text-accent-primary transition-colors duration-200 hover:text-accent-secondary"
              disabled={disabled}
            >
              {getAlternateModeButtonText()}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
