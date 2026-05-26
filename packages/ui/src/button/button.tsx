/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Primary `Button` primitive for `@plane/ui` supporting variant/size/loading/disabled states
 * plus optional prepend/append icon slots, rendered as a native `<button>` with theme-driven
 * Tailwind classes computed via `./helper`.
 */

import * as React from "react";

import { cn } from "../utils";
import type { TButtonVariant, TButtonSizes } from "./helper";
import { getIconStyling, getButtonStyling } from "./helper";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TButtonVariant;
  size?: TButtonSizes;
  className?: string;
  loading?: boolean;
  disabled?: boolean;
  appendIcon?: any;
  prependIcon?: any;
  children: React.ReactNode;
}

/**
 * Theme-driven ref-forwarding button rendered as a native HTML `<button>` element.
 *
 * Composes Tailwind classes from the variant/size tokens declared in `./helper`. Optional
 * `prependIcon` / `appendIcon` slots wrap a single lucide-react (or similar) icon element inside
 * a size-aware container and clone it with `strokeWidth: 2` for stroke consistency. The `type`
 * attribute defaults to `"button"` to avoid accidental form submission when used inside a `<form>`.
 *
 * Loading state: `loading=true` triggers the disabled-variant styling and sets the underlying
 * HTML `disabled` attribute, so the button becomes non-interactive while an operation is in flight.
 * INTENT UNCLEAR: `aria-busy` is not applied during `loading=true`, and no spinner is rendered by
 * default — assistive technology only sees a disabled button. Consumers needing a visible spinner
 * supply it via `prependIcon`.
 *
 * Props (see `ButtonProps`):
 *   - `variant` (default `"primary"`): one of the 11 tokens in `TButtonVariant`.
 *   - `size` (default `"md"`): one of `"sm" | "md" | "lg" | "xl"`.
 *   - `loading` / `disabled` (default `false`): either sets the underlying `disabled` HTML attribute.
 *   - `prependIcon` / `appendIcon`: optional icon elements rendered before/after `children`.
 *   - `type` (default `"button"`): overrides the browser's `"submit"` default.
 *   - `className`: extra Tailwind classes merged after the generated variant/size classes.
 *   - `children` (required): button label content.
 *   - Plus pass-through `React.ButtonHTMLAttributes<HTMLButtonElement>` props.
 *
 * Forwards `React.ForwardedRef<HTMLButtonElement>` so callers can focus the button imperatively.
 *
 * Accessibility: native `<button>` semantics (focusable, Space/Enter activation). The HTML
 * `disabled` attribute is the only mechanism conveying disabled OR loading state to assistive tech.
 */
const Button = React.forwardRef(function Button(props: ButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) {
  const {
    variant = "primary",
    size = "md",
    className = "",
    type = "button",
    loading = false,
    disabled = false,
    prependIcon = null,
    appendIcon = null,
    children,
    ...rest
  } = props;

  const buttonStyle = getButtonStyling(variant, size, disabled || loading);
  const buttonIconStyle = getIconStyling(size);

  return (
    <button ref={ref} type={type} className={cn(buttonStyle, className)} disabled={disabled || loading} {...rest}>
      {prependIcon && <div className={buttonIconStyle}>{React.cloneElement(prependIcon, { strokeWidth: 2 })}</div>}
      {children}
      {appendIcon && <div className={buttonIconStyle}>{React.cloneElement(appendIcon, { strokeWidth: 2 })}</div>}
    </button>
  );
});

Button.displayName = "plane-ui-button";

export { Button };
