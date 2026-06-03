/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Accessible skeleton loading container composed of `Loader` (role="status" wrapper) and
 * `Loader.Item` (animated skeleton block).
 */

import React from "react";
// helpers
import { cn } from "./utils";

type Props = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Accessible skeleton container that wraps placeholder blocks in a `role="status"` div with a
 * pulsing animation, signalling a busy state to both sighted users and assistive technology.
 *
 * Used in tandem with `Loader.Item` to compose page-level loading skeletons that mirror the
 * eventual content layout.
 *
 * Props (see local `Props` type):
 *   - `children`: skeleton placeholder blocks (typically `<Loader.Item />`).
 *   - `className`: optional Tailwind overrides merged onto the wrapper.
 *
 * Accessibility: `role="status"` is applied so screen readers announce the loading region.
 * INTENT UNCLEAR: no visually-hidden status text (e.g., "Loading...") is rendered inside the
 * region, so screen readers announce the role without an accompanying message.
 */
function Loader({ children, className = "" }: Props) {
  return (
    <div className={cn("animate-pulse", className)} role="status">
      {children}
    </div>
  );
}

type ItemProps = {
  height?: string;
  width?: string;
  className?: string;
};

/**
 * Individual skeleton block (rectangular by default, with rounded corners) rendered inside a
 * `Loader` and exposed publicly as `Loader.Item` for namespaced composition.
 *
 * Width and height are passed through to inline `style` so consumers can match the dimensions
 * of the eventual content without authoring custom Tailwind classes.
 *
 * Props (see local `ItemProps` type):
 *   - `height` / `width`: any CSS length value; defaults to `"auto"`.
 *   - `className`: optional Tailwind overrides (e.g., `rounded-full` for circular skeletons).
 */
function Item({ height = "auto", width = "auto", className = "" }: ItemProps) {
  return <div className={cn("rounded-md bg-layer-1", className)} style={{ height: height, width: width }} />;
}

Loader.Item = Item;

Loader.displayName = "plane-ui-loader";

export { Loader };
