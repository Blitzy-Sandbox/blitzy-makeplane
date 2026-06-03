/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Password input wrapper that adds password-strength feedback and visibility-toggle controls on
 * top of the shared `AuthInput` primitive for use across Plane's auth flows.
 */

import React, { useState } from "react";
import type { E_PASSWORD_STRENGTH } from "@plane/constants";
import { cn, getPasswordStrength } from "@plane/utils";
import { PasswordStrengthIndicator } from "../form-fields/password/indicator";
import { AuthInput } from "./auth-input";

/**
 * Props for `AuthPasswordInput`. Extends the standard `<input>` HTML attribute set with
 * password-specific affordances (strength indicator, visibility toggle), labeling overrides,
 * and the two specialized callbacks `onPasswordChange` and `onPasswordStrengthChange` consumed
 * by `AuthForm` to drive validation.
 */
export type TAuthPasswordInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  showPasswordStrength?: boolean;
  showPasswordToggle?: boolean;
  containerClassName?: string;
  errorClassName?: string;
  onPasswordChange?: (password: string) => void;
  onPasswordStrengthChange?: (strength: E_PASSWORD_STRENGTH) => void;
};

/**
 * Password input that wraps the shared `AuthInput` primitive, adding optional password-strength
 * feedback and a visibility-toggle affordance for Plane's auth flows.
 *
 * Strength is computed by `getPasswordStrength` from `@plane/utils` (this component does not
 * define the rules) and is both (a) rendered as inline criteria via `PasswordStrengthIndicator`
 * — only when `showPasswordStrength`, the field has a value, AND the field is focused — and
 * (b) reported upstream via `onPasswordStrengthChange` from a `useEffect`, so the parent form
 * (`AuthForm`) can gate submission on `E_PASSWORD_STRENGTH.STRENGTH_VALID`.
 *
 * Callbacks:
 *   - `onChange(e)`: standard input change passthrough.
 *   - `onPasswordChange(newPassword)`: convenience receiving the raw new value.
 *   - `onPasswordStrengthChange(strength)`: emitted whenever the derived strength changes.
 *
 * Props: see `TAuthPasswordInputProps`.
 *
 * Accessibility: label association is inherited from the inner `AuthInput` via `htmlFor`/`id`
 * wiring. See adjacent INTENT UNCLEAR comments on the export for known accessibility
 * ambiguities.
 */
// INTENT UNCLEAR: `autoComplete` is forced to `"off"` instead of the conventional `"current-password"` (sign-in) or `"new-password"` (sign-up), which suppresses password-manager autofill and save prompts.
// INTENT UNCLEAR: the visibility-toggle button (rendered by `AuthInput` when `showPasswordToggle` is true) has no `aria-label` or `aria-pressed`, so its toggle state is not announced by screen readers.
export function AuthPasswordInput({
  label = "Password",
  error,
  showPasswordStrength = true,
  showPasswordToggle = true,
  containerClassName = "",
  errorClassName = "",
  className = "",
  value = "",
  onChange,
  onPasswordChange,
  onPasswordStrengthChange,
  ...props
}: TAuthPasswordInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    onChange?.(e);
    onPasswordChange?.(newPassword);
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const passwordStrength = getPasswordStrength(value as string);

  // Notify parent of strength change
  React.useEffect(() => {
    onPasswordStrengthChange?.(passwordStrength);
  }, [passwordStrength, onPasswordStrengthChange]);

  return (
    <div className={cn("space-y-2", containerClassName)}>
      <AuthInput
        {...props}
        type="password"
        label={label}
        error={error}
        showPasswordToggle={showPasswordToggle}
        errorClassName={errorClassName}
        className={className}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoComplete="off"
      />
      {showPasswordStrength && value && isFocused && (
        <PasswordStrengthIndicator password={value as string} showCriteria />
      )}
    </div>
  );
}
