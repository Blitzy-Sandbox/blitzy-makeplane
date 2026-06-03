/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Card container primitive providing variant, spacing, and direction tokens
 * for content grouping.
 *
 * Re-exports the `ECardVariant`, `ECardSpacing`, and `ECardDirection` enums
 * so consumers configure the component using the same canonical token values
 * the styling helper (`./helper.tsx`) consumes.
 */

import * as React from "react";
import { cn } from "../utils";
import type { TCardDirection, TCardSpacing, TCardVariant } from "./helper";
import { ECardDirection, ECardSpacing, ECardVariant, getCardStyle } from "./helper";

/**
 * Props for {@link Card}; extends `React.HTMLAttributes<HTMLDivElement>` so the
 * wrapper preserves arbitrary div passthrough (id, data-*, aria-*, event handlers).
 *
 * Defaults applied inside `Card` (NOT in this interface):
 *   - `variant` defaults to `ECardVariant.WITH_SHADOW`
 *   - `spacing` defaults to `ECardSpacing.LG`
 *   - `direction` defaults to `ECardDirection.COLUMN`
 *   - `className` defaults to `""`
 *
 * @property variant - Optional elevation/border treatment token.
 * @property spacing - Optional internal padding token.
 * @property direction - Optional flex layout axis token (`row` vs. `column`).
 * @property className - Optional caller-supplied classes appended after the token-derived styles.
 * @property children - Required content rendered inside the card wrapper.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: TCardVariant;
  spacing?: TCardSpacing;
  direction?: TCardDirection;
  className?: string;
  children: React.ReactNode;
}

/**
 * Tokenized container with elevation/border treatments for grouping related
 * content into a card surface.
 *
 * Resolves styling via `getCardStyle(variant, spacing, direction)` and merges
 * the result with the caller's `className` through `cn(...)`. Forwards the
 * `ref` and any remaining `HTMLDivElement` attributes (`...rest`) to the
 * rendered `<div>`. Renders exactly one wrapper element; no state, no effects,
 * no MobX store access.
 *
 * Props: see {@link CardProps}. Defaults — `variant=WITH_SHADOW`,
 * `spacing=LG`, `direction=COLUMN`, `className=""`.
 *
 * Accessibility: this is a presentational `<div>` container with NO inherent
 * landmark role. Consumers that need landmark navigation must pass an explicit
 * `role` (e.g. `role="region"`) together with `aria-label` / `aria-labelledby`
 * via the spread props; no default `role` is applied here.
 */
// INTENT UNCLEAR: no default `role="region"` is applied — whether this is
// intentional (generic-by-design wrapper) or an accessibility oversight is
// not derivable from the implementation or naming alone.
const Card = React.forwardRef(function Card(props: CardProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const {
    variant = ECardVariant.WITH_SHADOW,
    direction = ECardDirection.COLUMN,
    className = "",
    spacing = ECardSpacing.LG,
    children,
    ...rest
  } = props;

  const style = getCardStyle(variant, spacing, direction);
  return (
    <div ref={ref} className={cn(style, className)} {...rest}>
      {children}
    </div>
  );
});

Card.displayName = "plane-ui-card";

export { Card, ECardVariant, ECardSpacing, ECardDirection };
