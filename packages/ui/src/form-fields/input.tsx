/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Base text input primitive with consistent styling, error state, and size variants used
 * across `@plane/ui` form composition.
 *
 * The component extends `React.InputHTMLAttributes<HTMLInputElement>` so all native input
 * attributes pass through unchanged, while three Plane-specific props (`mode`, `inputSize`,
 * `hasError`) control the design-token-driven visual chrome.
 */

import * as React from "react";
// helpers
import { cn } from "../utils";

/**
 * Props for the `Input` component. Extends all native
 * `React.InputHTMLAttributes<HTMLInputElement>`, so every standard input attribute
 * (`type`, `placeholder`, `value`, `onChange`, `disabled`, `id`, `name`, `aria-*`, ...) passes
 * through. Three Plane-specific fields control the design-token-driven visual chrome:
 *
 *   - `mode` (default `"primary"` in the component): visual variant — `"primary"` is bordered,
 *     `"transparent"` is borderless with an accent focus ring, `"true-transparent"` is borderless
 *     with no focus ring (used for inline title/header edits).
 *   - `inputSize` (default `"sm"` in the component): padding preset (`xs` | `sm` | `md`).
 *   - `hasError` (default `false` in the component): applies `border-danger-strong`; the error
 *     border is the only visual signal — no background tint (unlike `TextArea`).
 *   - `className`: extra Tailwind classes merged after the built-in styles.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mode?: "primary" | "transparent" | "true-transparent";
  inputSize?: "xs" | "sm" | "md";
  hasError?: boolean;
  className?: string;
}

/**
 * Ref-forwarding tokenized text input that delivers the design system's input chrome (border,
 * padding, focus ring, error state) while preserving the full native HTML input API.
 *
 * The component extends `React.InputHTMLAttributes<HTMLInputElement>`, so every native attribute
 * (`type`, `placeholder`, `value`, `onChange`, `disabled`, `id`, `name`, `aria-*`, ...) passes
 * through via `{...rest}`. The `autoComplete` default is overridden to `"off"` to suppress
 * browser autofill on non-credential fields; password/email fields must explicitly opt in by
 * passing the correct value.
 *
 * Props (see local `InputProps`):
 *   - `mode` (default `"primary"`): visual variant — bordered, transparent-with-focus-ring, or fully transparent.
 *   - `inputSize` (default `"sm"`): padding preset (`xs` | `sm` | `md`).
 *   - `hasError` (default `false`): applies the error border (no background tint, unlike `TextArea`).
 *   - `className`: extra Tailwind classes merged after the built-in styles.
 *
 * Accessibility: native input semantics; ref is forwarded for autofocus and imperative reads.
 * Pairs with `Label` + `FormField` from `./root` for accessible labelling.
 * INTENT UNCLEAR: `hasError=true` does not auto-emit `aria-invalid`, and there is no automatic
 * `aria-describedby` linkage to a `ValidationMessage` — callers must wire both through `{...rest}`
 * for full screen-reader support.
 */
const Input = React.forwardRef(function Input(props: InputProps, ref: React.ForwardedRef<HTMLInputElement>) {
  const {
    id,
    type,
    name,
    mode = "primary",
    inputSize = "sm",
    hasError = false,
    className = "",
    autoComplete = "off",
    ...rest
  } = props;

  return (
    <input
      id={id}
      ref={ref}
      type={type}
      name={name}
      className={cn(
        "placeholder-tertiary block rounded-md border-subtle-1 bg-layer-2 text-13 focus:outline-none",
        {
          "rounded-md border-[0.5px]": mode === "primary",
          "rounded-sm border-none bg-transparent ring-0 transition-all focus:ring-1 focus:ring-accent-strong":
            mode === "transparent",
          "rounded-sm border-none bg-transparent ring-0": mode === "true-transparent",
          "border-danger-strong": hasError,
          "px-1.5 py-1": inputSize === "xs",
          "px-3 py-2": inputSize === "sm",
          "p-3": inputSize === "md",
        },
        className
      )}
      autoComplete={autoComplete}
      {...rest}
    />
  );
});

Input.displayName = "form-input-field";

export { Input };
