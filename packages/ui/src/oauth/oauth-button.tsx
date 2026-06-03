/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Ref-forwarding sign-in button primitive used by `OAuthOptions` to render
 * each OAuth provider entry (Google, GitHub, GitLab, etc.).
 *
 * This module is intentionally generic: provider-specific branding (logo SVG
 * and label string) is supplied by the caller via the `icon` and `text` props
 * rather than embedded in a provider registry here, so the visual treatment
 * (size, border, hover) stays shared while branding remains a caller concern.
 *
 * Not re-exported from `./index.ts` — internal building block for
 * `OAuthOptions`.
 */

import * as React from "react";
import { cn } from "../utils";

/**
 * Public prop contract for {@link OAuthButton}.
 *
 * Extends `React.ButtonHTMLAttributes<HTMLButtonElement>` so callers may pass
 * any native button attribute (`onClick`, `disabled`, `type`, `aria-label`,
 * …) without explicit prop pass-through.
 *
 * - `text` — required visible label rendered alongside the icon when
 *   `compact` is `false` (e.g., "Continue with Google").
 * - `icon` — required leading-slot node; this is the carrier for
 *   provider-specific branding (e.g., a Google logo SVG).
 * - `compact` — optional; when `true`, hides the `text` label and renders an
 *   icon-only button for tight layouts (e.g., when an email/password form is
 *   also visible). Defaults to `false`.
 */
export interface OAuthButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  icon: React.ReactNode;
  compact?: boolean;
}

/**
 * Provider-agnostic ref-forwarding sign-in button used inside the
 * `OAuthOptions` list to render each provider entry.
 *
 * The forwarded ref (`React.ForwardedRef<HTMLButtonElement>`) exposes the
 * underlying native `<button>` so callers can wire focus management,
 * analytics handlers, or imperative loading-state toggles without an
 * additional wrapper.
 *
 * Rendering:
 * - Always renders one `<button>` with the shared OAuth visual treatment
 *   (height, border, hover, padding, typography).
 * - The icon slot is always rendered; the text label is rendered only when
 *   `compact` is `false`.
 * - `cn(...)` merges the default class string with a caller-supplied
 *   `className` so callers can extend (not replace) the base styling.
 * - All extra props are spread onto the `<button>` via `{...rest}`
 *   (`onClick`, `disabled`, `type`, `aria-*`, etc.).
 *
 * DisplayName `"plane-ui-oauth-button"` (set below) improves identification
 * in React DevTools and aligns with the `plane-ui-*` naming convention used
 * across the design system.
 *
 * Side effects: none — purely presentational; the only side-effect surface
 * is the caller-supplied `onClick`.
 *
 * Accessibility: relies on native `<button>` semantics, which give the
 * element focus, keyboard activation (Enter/Space), and a "button" role
 * announcement to assistive tech without extra ARIA. When `compact` is
 * `true` the visible label is hidden, so callers SHOULD pass an `aria-label`
 * (forwarded via `...rest`) to keep the button labeled for screen readers.
 */
const OAuthButton = React.forwardRef(function OAuthButton(
  props: OAuthButtonProps,
  ref: React.ForwardedRef<HTMLButtonElement>
) {
  const { text, icon, compact = false, className = "", ...rest } = props;

  return (
    <button
      ref={ref}
      className={cn(
        "bg-onboarding-background-200 hover:bg-onboarding-background-300 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-strong px-4 py-2.5 text-13 font-medium text-primary duration-300",
        className
      )}
      {...rest}
    >
      <div className="flex flex-shrink-0 items-center justify-center">{icon}</div>
      {/* INTENT UNCLEAR: compact mode hides the text label but the component does not assert an aria-label — caller must supply one when compact={true} or the button will be unlabeled to assistive tech. */}
      {!compact && (
        <span className="flex flex-grow items-center justify-center text-body-sm-regular transition-opacity duration-300">
          {text}
        </span>
      )}
    </button>
  );
});

OAuthButton.displayName = "plane-ui-oauth-button";

export { OAuthButton };
