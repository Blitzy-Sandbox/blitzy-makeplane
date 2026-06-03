/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Base styled input primitive used across all auth form fields (email, username, password) to
 * provide consistent visual treatment, optional labeling, error display, and password-visibility
 * toggling.
 */

import { Eye, EyeOff } from "lucide-react";
import React, { useState } from "react";
import { Input } from "../form-fields/input";
import { cn } from "../utils";

/**
 * Props for `AuthInput`. Extends the standard `<input>` HTML attribute set so any native input
 * attribute (`name`, `value`, `onChange`, `placeholder`, `required`, `id`, ...) is forwarded
 * through to the underlying `Input` primitive, plus auth-specific affordances: optional `label`,
 * inline `error` message, password-visibility toggle, and an `errorClassName` override.
 */
export type TAuthInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  showPasswordToggle?: boolean;
  errorClassName?: string;
};

/**
 * Vertical-stack layout for the label + input + error region. Kept as a module-scope constant
 * so the same gap rhythm is applied across every auth form field.
 */
const baseContainerClassName = "flex flex-col gap-1.5";

/**
 * Base styled input primitive for Plane's auth form, providing consistent label / input / error
 * layout and an optional password-visibility toggle.
 *
 * This is the lowest-level field component in the `auth-form` folder — `AuthPasswordInput` and
 * `AuthConfirmPasswordInput` both wrap it. Field state (value, validation) is owned entirely
 * by the consumer; the only local state is the password-visibility toggle.
 *
 * Behavior notes:
 *   - The visibility toggle only renders when `showPasswordToggle=true` AND `type="password"`;
 *     for other input types the prop is ignored.
 *   - When `error` is truthy, the input border gains a `border-danger-strong` class and the
 *     error string is rendered as a sibling `<p>`.
 *
 * Props: see `TAuthInputProps`. Any native `<input>` attribute is forwarded via `...props`.
 *
 * Accessibility: label association relies on the consumer passing `id`; the
 * `<label htmlFor={id}>` link only resolves when an `id` prop is supplied. See adjacent
 * INTENT UNCLEAR comments on the export for known accessibility ambiguities.
 */
// INTENT UNCLEAR: no fallback ID generation (e.g., `useId`) is implemented, so a `label` prop without a matching `id` produces an orphan label.
// INTENT UNCLEAR: error rendering does not set `aria-invalid` on the input and does not link the error `<p>` via `aria-describedby`, so assistive technology does not announce validation state alongside the field value.
// INTENT UNCLEAR: the visibility-toggle button has no `aria-label` / `aria-pressed`, so its toggle state is not announced by screen readers.
export function AuthInput({
  label,
  error,
  showPasswordToggle = false,
  errorClassName = "",
  className = "",
  type = "text",
  autoComplete = "off",
  ...props
}: TAuthInputProps) {
  const { id } = props;
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordType = type === "password";

  const inputType = isPasswordType && showPasswordToggle && showPassword ? "text" : type;

  return (
    <div className={cn(baseContainerClassName)}>
      {label && (
        <label htmlFor={id} className={cn("text-13 font-semibold text-tertiary")}>
          {label}
        </label>
      )}
      <div className={cn("relative flex items-center rounded-md border border-strong px-3 py-2 transition-all")}>
        <Input
          {...props}
          type={inputType}
          autoComplete={autoComplete}
          className={cn(
            "h-6 w-full rounded-md border-none p-0 disable-autofill-style placeholder:text-14 placeholder:text-placeholder",
            {
              "border-danger-strong": error,
            },
            className
          )}
        />
        {showPasswordToggle && isPasswordType && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 h-5 w-5 stroke-placeholder hover:cursor-pointer"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        )}
      </div>

      {error && <p className={cn("text-13 text-danger-primary", errorClassName)}>{error}</p>}
    </div>
  );
}
