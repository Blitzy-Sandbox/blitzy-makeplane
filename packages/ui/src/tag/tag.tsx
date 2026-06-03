/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Lightweight visual label rendered as a `<div>` for non-interactive tokenized
 * content (status, category, version pills).
 *
 * Distinct from `Badge` (which renders a `<button>` with click handlers and disabled
 * state) — `Tag` is presentational only and forwards a ref to the underlying `HTMLDivElement`.
 * Consumed by applied-filter chip rows across `apps/web/core/components/{cycles,modules,views,project,pages,inbox,workspace-notifications}/applied-filters/**`.
 */

import * as React from "react";
import { cn } from "../utils";
import type { TTagSize, TTagVariant } from "./helper";
import { ETagSize, ETagVariant, getTagStyle } from "./helper";

/**
 * Props for the `Tag` component.
 *
 * Extends every native `<div>` attribute via `React.ComponentProps<"div">`, so
 * callers may forward `id`, `role`, `aria-*`, `onClick`, etc. directly.
 *
 * @property variant - Visual variant token (defaults to `ETagVariant.OUTLINED`).
 * @property size - Sizing token controlling padding (defaults to `ETagSize.SM`).
 * @property className - Additional Tailwind classes merged into the resolved variant/size style via `cn(...)`.
 * @property children - Required label content rendered inside the tag.
 */
export interface TagProps extends React.ComponentProps<"div"> {
  variant?: TTagVariant;
  size?: TTagSize;
  className?: string;
  children: React.ReactNode;
}

/**
 * Visual chip/label primitive built on a presentational `<div>`.
 *
 * Resolves variant + size into a Tailwind class string via `getTagStyle`, merges
 * caller `className` with `cn`, and forwards the ref to the underlying `HTMLDivElement`.
 *
 * Accessibility: this is a presentational `<div>` with no inherent interactive
 * semantics — consumers MUST pass `role` / `aria-label` themselves if the tag conveys
 * meaningful information to assistive technology, or wrap it in a semantic element
 * (e.g., `<button>` for a removable filter chip).
 *
 * // INTENT UNCLEAR: `Tag.displayName = "plane-ui-container"` does not match the component name —
 * // observed behavior: React DevTools displays this tag as "plane-ui-container"; this may be a
 * // copy-paste residue from a generic container primitive. Preserved as-is per the system
 * // boundary "no refactoring / renaming of any kind."
 *
 * @param props - See `TagProps`.
 * @param ref - Forwarded ref to the underlying `HTMLDivElement`.
 */
const Tag = React.forwardRef(function Tag(props: TagProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const { variant = ETagVariant.OUTLINED, className = "", size = ETagSize.SM, children, ...rest } = props;

  const style = getTagStyle(variant, size);
  return (
    <div ref={ref} className={cn(style, className)} {...rest}>
      {children}
    </div>
  );
});

Tag.displayName = "plane-ui-container";

export { Tag, ETagVariant, ETagSize };
