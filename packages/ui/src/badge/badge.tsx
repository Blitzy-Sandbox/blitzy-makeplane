/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact pill-style label used for status, version, count, and category
 * indicators across the `@plane/ui` design system.
 *
 * Despite the visual "badge" appearance, the underlying element is a
 * `<button>` so consumers get focusable/keyboard-activatable semantics
 * for free — see {@link Badge}. Variant and size tokens are declared in
 * `./helper` and resolved to Tailwind class strings at render time.
 */

import * as React from "react";
// helpers
import { cn } from "../utils";
import type { TBadgeVariant, TBadgeSizes } from "./helper";
import { getIconStyling, getBadgeStyling } from "./helper";

/**
 * Props for the {@link Badge} component.
 *
 * Extends `React.ButtonHTMLAttributes<HTMLButtonElement>`, so any standard
 * button attribute (e.g., `onClick`, `aria-label`, `title`, `id`, `name`,
 * `form`) flows through to the rendered `<button>` via spread.
 *
 * @property variant - Visual token from `TBadgeVariant` (e.g., `"primary"`,
 *   `"accent-success"`, `"outline-destructive"`); defaults to `"primary"`.
 * @property size - Sizing token from `TBadgeSizes` (`"sm" | "md" | "lg" | "xl"`);
 *   defaults to `"md"`.
 * @property className - Extra Tailwind utilities appended to the
 *   variant/size-derived classes via `cn(...)`; defaults to `""`.
 * @property loading - When true, applies the disabled visual state AND sets
 *   the underlying `<button disabled>` attribute; defaults to `false`.
 * @property disabled - Disables the button and applies the disabled token
 *   styling; defaults to `false`. Loading or disabled both gate interaction.
 * @property prependIcon - Optional JSX icon rendered before `children`; must
 *   accept a `strokeWidth` prop because it is cloned with `strokeWidth: 2`.
 * @property appendIcon - Optional JSX icon rendered after `children`; same
 *   `strokeWidth` contract as `prependIcon`.
 * @property children - Required label content rendered between the optional
 *   icons.
 */
export interface BadgeProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TBadgeVariant;
  size?: TBadgeSizes;
  className?: string;
  loading?: boolean;
  disabled?: boolean;
  appendIcon?: any;
  prependIcon?: any;
  children: React.ReactNode;
}

/**
 * Rounded label rendered as a `<button>` with variant- and size-driven
 * Tailwind tokens, exported via `React.forwardRef` so consumers can attach
 * a ref to the underlying button element.
 *
 * The component delegates styling to {@link getBadgeStyling} and
 * {@link getIconStyling} from `./helper`, merges any consumer `className`
 * via `cn(...)`, and clones optional `prependIcon`/`appendIcon` elements
 * with `strokeWidth: 2` to align icon visuals across the design system.
 *
 * Accessibility: ships as a real `<button>` element, so it is focusable,
 * keyboard-activatable (Space/Enter), and announced as a button by
 * assistive technologies. The component does NOT set `aria-label` or any
 * other role override — callers wanting non-interactive badge semantics
 * should wrap the text content instead of rendering this component.
 * // INTENT UNCLEAR: button semantics on a visual "badge" — may be intentional
 * // INTENT UNCLEAR: for interactive count/status pills, or may predate a
 * // INTENT UNCLEAR: separate non-interactive variant.
 *
 * `displayName` is set to `"plane-ui-badge"` so React DevTools surfaces a
 * stable, library-prefixed name regardless of bundler minification.
 */
const Badge = React.forwardRef(function Badge(props: BadgeProps, ref: React.ForwardedRef<HTMLButtonElement>) {
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

  const buttonStyle = getBadgeStyling(variant, size, disabled || loading);
  const buttonIconStyle = getIconStyling(size);

  return (
    <button ref={ref} type={type} className={cn(buttonStyle, className)} disabled={disabled || loading} {...rest}>
      {prependIcon && <div className={buttonIconStyle}>{React.cloneElement(prependIcon, { strokeWidth: 2 })}</div>}
      {children}
      {appendIcon && <div className={buttonIconStyle}>{React.cloneElement(appendIcon, { strokeWidth: 2 })}</div>}
    </button>
  );
});

Badge.displayName = "plane-ui-badge";

export { Badge };
