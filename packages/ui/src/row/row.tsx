/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `Row` layout primitive — tokenized horizontal-padding `<div>` container.
 *
 * Centralizes the design system's page-gutter vocabulary so consumers don't hand-roll
 * `px-page-x` / `px-0` Tailwind classes. The `variant` token resolves to a single Tailwind
 * padding class via `rowStyle` in `./helper.tsx`; all other layout concerns (flex, alignment,
 * gap, item ordering) are left to the caller via `className` and inherited
 * `React.HTMLAttributes<HTMLDivElement>`.
 *
 * Consumers: `apps/web`, `apps/admin`, `apps/space` (via `@plane/ui` workspace dependency)
 * for any layout container that needs the standard page-edge gutter or an explicit edge-hugging
 * variant for flush full-bleed sections.
 */

import * as React from "react";
import { cn } from "../utils";
import type { TRowVariant } from "./helper";
import { ERowVariant, rowStyle } from "./helper";

/**
 * Props for the `Row` component.
 *
 * Inherits every native `<div>` HTML attribute (event handlers, `id`, `style`, `aria-*`, etc.)
 * via `React.HTMLAttributes<HTMLDivElement>`, so the component behaves like a plain `<div>`
 * augmented with a single design-system token.
 *
 * - `variant`: optional token controlling horizontal padding; defaults to `ERowVariant.REGULAR`
 *   (`"px-page-x"`). Pass `ERowVariant.HUGGING` for flush edges (`"px-0"`).
 * - `className`: optional Tailwind class appended AFTER the variant class via `cn`, so callers
 *   can extend (e.g. add `flex items-center gap-4`) or override styling.
 * - `children`: required; rendered inside the underlying `<div>`.
 */
export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: TRowVariant;
  className?: string;
  children: React.ReactNode;
}

/**
 * Ref-forwarding layout container that applies variant-controlled horizontal padding to a `<div>`.
 *
 * Resolves `variant` → Tailwind class via `rowStyle`, composes it with the caller-provided
 * `className` via `cn`, and spreads any remaining `<div>` HTML attributes onto the rendered
 * element. Defaults `variant` to `ERowVariant.REGULAR` when omitted; sets the React DevTools
 * display name to `"plane-ui-row"` for clearer identification in component trees.
 *
 * Accessibility: renders as a presentational `<div>` with no inherent ARIA semantics. Callers
 * needing landmark, list, or other semantic meaning should pass an appropriate `role` and/or
 * `aria-*` attributes through the spread props.
 * // INTENT UNCLEAR: no default `role` is applied by the component even in contexts where the
 * // row is the outermost layout container — surrounding sections are expected to own semantics.
 *
 * @param props - {@link RowProps} including the variant token, `className`, `children`, and any
 *   standard `<div>` HTML attributes.
 * @param ref - Forwarded ref attached to the underlying `<div>` element.
 * @returns A `<div>` styled by the resolved variant + caller-provided `className`.
 */
const Row = React.forwardRef(function Row(props: RowProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const { variant = ERowVariant.REGULAR, className = "", children, ...rest } = props;

  const style = rowStyle[variant];

  return (
    <div ref={ref} className={cn(style, className)} {...rest}>
      {children}
    </div>
  );
});

Row.displayName = "plane-ui-row";

export { Row, ERowVariant };
