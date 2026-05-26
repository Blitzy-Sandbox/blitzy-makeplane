/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubHeading` typography primitive providing the design system's section-heading text style.
 */

import React from "react";
import { cn } from "../utils";

type Props = {
  children: React.ReactNode;
  className?: string;
  noMargin?: boolean;
};

/**
 * Renders a section-label heading styled with the design system's sub-heading typography tokens.
 *
 * Typically placed above tables, lists, panels, and form-section groupings so consumers do not
 * have to repeat the underlying Tailwind class string. The `noMargin` escape hatch lets callers
 * suppress the default bottom margin when the surrounding layout already controls spacing.
 *
 * Props (see local `Props` type):
 *   - `children`: heading content rendered inside the `<h3>` element (required).
 *   - `className`: extra Tailwind classes merged onto the heading via `cn(...)`.
 *   - `noMargin` (default `false`): when true, drops the default `mb-2` bottom margin for tighter layouts.
 *
 * Accessibility: the heading is rendered as a fixed `<h3>` element so it is announced as a
 * level-3 heading by assistive technology.
 */
// INTENT UNCLEAR: the heading level is hardcoded to <h3> with no `as` / polymorphic-tag prop, so callers cannot place this primitive at h1/h2/h4+ positions in a page's heading hierarchy.
function SubHeading({ children, className, noMargin }: Props) {
  return (
    <h3 className={cn("block text-18 leading-7 font-medium text-secondary", !noMargin && "mb-2", className)}>
      {children}
    </h3>
  );
}

export { SubHeading };
