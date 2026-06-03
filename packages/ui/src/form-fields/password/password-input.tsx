/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Password input with built-in show/hide visibility toggle and animated icon transition.
 *
 * The visibility toggle is local state (`useState`) — the parent does not control whether the
 * password is shown, only the value itself. This keeps the security-sensitive default
 * ("password" type) intact while still letting users self-verify their typing.
 */

import { Eye, EyeClosed } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";

type TPasswordInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  showToggle?: boolean;
  error?: boolean;
  autoComplete?: React.HTMLInputAutoCompleteAttribute;
};

/**
 * Controlled password input rendering a native `<input>` with switchable `type="password"` /
 * `type="text"` plus an optional eye/eye-closed toggle button.
 *
 * Local `useState` owns the visibility flag so toggling never leaks into parent re-renders.
 * The toggle button swaps between `Eye` (shown) and `EyeClosed` (hidden) icons with a fade +
 * scale + rotate animation cross-fade driven by Tailwind transition classes.
 *
 * Props (see local `TPasswordInputProps`):
 *   - `id` (required): forwarded to the native input — pair with a sibling `<label htmlFor>` for
 *     accessible labelling.
 *   - `value` (required): controlled string value.
 *   - `onChange` (required): receives the new value (already unwrapped from the input event).
 *   - `placeholder` (default `"Enter your password"`): placeholder text.
 *   - `className`: extra Tailwind classes merged onto the input.
 *   - `showToggle` (default `true`): when false, hides the visibility toggle button entirely.
 *   - `error` (default `false`): paints the error border (`border-danger-strong`).
 *   - `autoComplete` (default `"off"`): the WHY — defaulting to `"off"` keeps password fields
 *     from autofilling in arbitrary contexts; sign-in flows must explicitly pass
 *     `"current-password"` and sign-up flows must pass `"new-password"` to opt back into the
 *     correct browser autofill behavior.
 *
 * Accessibility:
 *   - Native `<input type="password">` semantics with `id` for `htmlFor` linkage.
 *   - The toggle is a `<button type="button">` wrapped in a `Tooltip` whose `tooltipContent`
 *     ("Show password" / "Hide password") announces intent on hover/focus.
 *   - INTENT UNCLEAR: the toggle button has no `aria-pressed` or `aria-label`; sighted users
 *     see the eye icon swap, but screen readers rely on the tooltip's announcement which is
 *     not directly tied to the button via `aria-describedby`.
 *   - INTENT UNCLEAR: `error=true` paints the error border but does not auto-emit `aria-invalid`.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder = "Enter your password",
  className,
  showToggle = true,
  error = false,
  autoComplete = "off",
}: TPasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-md border bg-surface-1 px-3 py-2 pr-10 text-secondary transition-all duration-200 placeholder:text-placeholder focus:border-transparent focus:ring-2 focus:ring-accent-strong focus:outline-none",
          {
            "border-strong": !error,
            "border-danger-strong": error,
          },
          className
        )}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      {showToggle && (
        <Tooltip tooltipContent={showPassword ? "Hide password" : "Show password"} position="top">
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-secondary transition-colors duration-200 hover:text-primary"
          >
            <div className="relative h-4 w-4">
              <Eye
                className={cn(
                  "absolute inset-0 h-4 w-4 transition-all duration-300 ease-in-out",
                  showPassword ? "scale-75 rotate-12 opacity-0" : "scale-100 rotate-0 opacity-100"
                )}
              />
              <EyeClosed
                className={cn(
                  "absolute inset-0 h-4 w-4 transition-all duration-300 ease-in-out",
                  showPassword ? "scale-100 rotate-0 opacity-100" : "scale-75 -rotate-12 opacity-0"
                )}
              />
            </div>
          </button>
        </Tooltip>
      )}
    </div>
  );
}
