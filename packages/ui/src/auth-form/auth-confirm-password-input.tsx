/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Password-confirmation field that validates equality against the primary password during sign-up
 * and password-reset flows.
 */

import React, { useState } from "react";
import { cn } from "@plane/utils";
import { AuthInput } from "./auth-input";

/**
 * Props for `AuthConfirmPasswordInput`. Extends the standard `<input>` HTML attribute set with
 * the parent password value (`password`), labeling overrides, and an `onPasswordMatchChange`
 * subscription used by `AuthForm` to gate submission on equality.
 */
export type TAuthConfirmPasswordInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  password: string;
  label?: string;
  error?: string;
  showPasswordToggle?: boolean;
  containerClassName?: string;
  labelClassName?: string;
  errorClassName?: string;
  onPasswordMatchChange?: (matches: boolean) => void;
};

/**
 * Confirm-password field that compares its controlled value against the parent `password` prop
 * and emits the equality result upstream via `onPasswordMatchChange`.
 *
 * To avoid flicker-y mismatch copy on every keystroke, the rendered error is gated by
 * `showMatchError` — the mismatch message only appears once the user has blurred the field OR
 * the confirm-value length reaches the primary password length, whichever comes first. When the
 * values match and the field is non-empty, a green "Passwords match" affirmation is rendered.
 *
 * Error precedence: an explicit `error` prop wins over the derived "Passwords don't match"
 * string.
 *
 * Props: see `TAuthConfirmPasswordInputProps`.
 *
 * Accessibility: native HTML input semantics from the inner `AuthInput`; see adjacent INTENT
 * UNCLEAR comments on the export for known accessibility ambiguities.
 */
// INTENT UNCLEAR: rendered "Passwords don't match" error and "Passwords match" success messages have no `aria-describedby` link to the underlying input, so screen readers do not announce match state with the field.
// INTENT UNCLEAR: `autoComplete` is forced to `"off"` on the inner `AuthInput` instead of the conventional `"new-password"`, which suppresses password-manager save prompts.
export function AuthConfirmPasswordInput({
  password,
  label = "Confirm Password",
  error,
  showPasswordToggle = true,
  containerClassName = "",
  errorClassName = "",
  className = "",
  value = "",
  onChange,
  onPasswordMatchChange,
  ...props
}: TAuthConfirmPasswordInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const confirmPassword = value as string;
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const showMatchError =
    confirmPassword.length > 0 && !passwordsMatch && (!isFocused || confirmPassword.length >= password.length);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newConfirmPassword = e.target.value;
    onChange?.(e);
    onPasswordMatchChange?.(password === newConfirmPassword && password.length > 0);
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const getError = () => {
    if (error) return error;
    if (showMatchError) return "Passwords don't match";
    return "";
  };

  return (
    <div className={cn("space-y-2", containerClassName)}>
      <AuthInput
        {...props}
        type="password"
        label={label}
        error={getError()}
        showPasswordToggle={showPasswordToggle}
        errorClassName={errorClassName}
        className={className}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoComplete="off"
      />
      {confirmPassword && passwordsMatch && <p className="text-13 text-success-primary">Passwords match</p>}
    </div>
  );
}
