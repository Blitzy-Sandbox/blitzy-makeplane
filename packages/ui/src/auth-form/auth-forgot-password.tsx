/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Forgot-password action button used inside the `AuthForm` sign-in layout to navigate users to
 * the password-recovery flow.
 */

import React from "react";
import { cn } from "../utils";

/**
 * Props for `AuthForgotPassword`. The `onForgotPassword` callback is the only behavioral input;
 * `text`, `className`, and `disabled` are presentational overrides with sensible defaults.
 */
export interface AuthForgotPasswordProps {
  onForgotPassword?: () => void;
  className?: string;
  text?: string;
  disabled?: boolean;
}

/**
 * Stateless forgot-password trigger button rendered inside the `AuthForm` sign-in layout.
 *
 * Always renders a `<button type="button">` (never an `<a>`) so that clicks inside the parent
 * `<form>` element never trigger submission — the click default is explicitly suppressed via
 * `e.preventDefault()` and `type="button"` opts out of native submit propagation. When
 * `disabled` is true the native `disabled` attribute is applied (removing the element from the
 * tab order) and the `onForgotPassword` callback is suppressed.
 *
 * Navigation to the actual password-recovery route is the consumer's responsibility — wire
 * `onForgotPassword` to a React Router `useNavigate(...)` call, a router `Link` action, or any
 * other handoff at the call site.
 *
 * Props: see `AuthForgotPasswordProps`.
 *
 * Accessibility: native `<button>` focus + activation semantics; see adjacent INTENT UNCLEAR
 * comment on the export for known accessibility ambiguities.
 */
// INTENT UNCLEAR: no `aria-label` is applied — the accessible name comes entirely from the visible `text` prop (defaults to `"Forgot your password?"`).
export function AuthForgotPassword({
  onForgotPassword,
  className = "",
  text = "Forgot your password?",
  disabled = false,
}: AuthForgotPasswordProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!disabled && onForgotPassword) {
      onForgotPassword();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "text-13 text-accent-primary transition-colors duration-200 hover:text-accent-secondary",
        {
          "cursor-not-allowed opacity-50": disabled,
          "cursor-pointer": !disabled,
        },
        className
      )}
    >
      {text}
    </button>
  );
}
