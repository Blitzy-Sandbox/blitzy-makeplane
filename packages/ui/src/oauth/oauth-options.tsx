/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Provider-agnostic OAuth sign-in option list used by `@plane/ui`'s auth UI.
 *
 * Exposes the option shape ({@link TOAuthOption}) and the list renderer
 * ({@link OAuthOptions}) that maps each option to an `OAuthButton`. This
 * module is intentionally NOT a provider registry: callers (e.g.
 * `apps/web/core/hooks/oauth/core.tsx`) assemble the `TOAuthOption[]` —
 * including the provider id, label, icon SVG, and `onClick` redirect — so
 * individual providers (Google / GitHub / GitLab / …) can be enabled and
 * configured per-deployment without touching this file.
 */

import * as React from "react";
import { cn } from "../utils";
import { OAuthButton } from "./oauth-button";

/**
 * Shape describing a single OAuth provider entry rendered as one sign-in
 * button by {@link OAuthOptions}.
 *
 * - `id` — stable identifier used both as the React `key` for the rendered
 *   button and as the logical provider tag; required.
 * - `text` — visible label rendered next to the icon when the list is not
 *   in `compact` mode (e.g. "Continue with Google").
 * - `icon` — leading-slot React node, typically a provider logo SVG.
 * - `onClick` — handler invoked on activation; in production this
 *   typically triggers an OAuth authorization redirect owned by the caller.
 * - `enabled` — optional opt-out flag; when `false` the option is filtered
 *   out and not rendered. Omitting the field is treated as enabled, so
 *   callers only need to set `enabled: false` to feature-flag a single
 *   provider without conditionally rebuilding the array.
 */
export type TOAuthOption = {
  id: string;
  text: string;
  icon: React.ReactNode;
  onClick: () => void;
  enabled?: boolean;
};

/**
 * Internal prop contract for {@link OAuthOptions}.
 *
 * - `options` — required list of provider entries to consider for
 *   rendering; entries with `enabled === false` are filtered out before
 *   rendering.
 * - `compact` — optional; switches the layout from the default vertical
 *   full-label column to a horizontal icon-only row. The same flag is
 *   forwarded to each child `OAuthButton` to suppress the per-button text
 *   label so the two visual adjustments stay in sync. Defaults to `false`.
 * - `showDivider` — optional; when `true`, appends a horizontal "or"
 *   separator after the button row. Used by callers that render both an
 *   OAuth list and an email/password form on the same screen (the divider
 *   is suppressed when only one of the two is available). Defaults to `true`.
 * - `className` — extra classes merged into the inner flex container that
 *   holds the buttons.
 * - `containerClassName` — extra classes merged into the outer wrapper
 *   `<div>`.
 */
type OAuthOptionsProps = {
  options: TOAuthOption[];
  compact?: boolean;
  showDivider?: boolean;
  className?: string;
  containerClassName?: string;
};

/**
 * Renders the list of enabled OAuth provider buttons, optionally followed
 * by an "or" divider before an email/password form.
 *
 * Behavior:
 * - Filters `options` by `enabled !== false` and returns `null` when no
 *   providers remain, so callers can gate the entire OAuth row behind a
 *   feature flag (e.g. `isOAuthEnabled`) without conditional rendering at
 *   the call site.
 * - Each enabled option becomes one `OAuthButton` keyed by `option.id`,
 *   with `text`, `icon`, `onClick`, and the shared `compact` flag
 *   forwarded.
 * - `compact` controls both the row/column flex direction here AND
 *   icon-only rendering inside each child button — these two visual
 *   adjustments are coupled so the row does not overflow when icon labels
 *   are also rendered.
 * - `showDivider` appends a presentation-only "— or —" separator commonly
 *   placed between the OAuth list and an email-based auth form when both
 *   are enabled.
 *
 * Side effects: none — the component is purely declarative. The only
 * side-effect surface is the caller-supplied `option.onClick`, which
 * typically performs an OAuth authorization redirect.
 *
 * Accessibility: relies on `OAuthButton`'s native `<button>` semantics
 * (focus, keyboard activation via Enter/Space, "button" role announcement).
 * The "or" divider is presentation-only (`<hr/>` + text "or") and
 * intentionally adds no ARIA role here — callers that need a labeled
 * separator should wrap this component rather than augment it.
 *
 * Consumers (verified via grep):
 * - `apps/web/core/components/account/auth-forms/auth-root.tsx`
 * - `apps/space/components/account/auth-forms/auth-root.tsx`
 */
export function OAuthOptions(props: OAuthOptionsProps) {
  const { options, compact = false, showDivider = true, className = "", containerClassName = "" } = props;

  // Honor per-provider opt-out so callers can feature-flag a single provider via `enabled: false` without rebuilding the array.
  const enabledOptions = options.filter((option) => option.enabled !== false);

  if (enabledOptions.length === 0) return null;

  return (
    <div className={cn("w-full", containerClassName)}>
      <div
        className={cn(
          "flex gap-4 overflow-hidden transition-all duration-500 ease-in-out",
          compact ? "flex-row" : "flex-col",
          className
        )}
      >
        {enabledOptions.map((option) => (
          <OAuthButton
            key={option.id}
            text={option.text}
            icon={option.icon}
            onClick={option.onClick}
            compact={compact}
            className="transition-all duration-300 ease-in-out"
          />
        ))}
      </div>

      {showDivider && (
        <div className="mt-4 flex items-center transition-all duration-300">
          <hr className="w-full border-strong transition-colors duration-300" />
          <p className="mx-3 flex-shrink-0 text-center text-13 text-placeholder transition-colors duration-300">or</p>
          <hr className="w-full border-strong transition-colors duration-300" />
        </div>
      )}
    </div>
  );
}
