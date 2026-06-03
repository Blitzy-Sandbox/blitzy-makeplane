/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Styled wrapper around `@radix-ui/react-scroll-area` providing size presets and horizontal/vertical
 * scrollbar geometry tokens.
 */

import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import React from "react";
import { cn } from "./utils";

type TScrollAreaProps = {
  type?: "auto" | "always" | "scroll" | "hover";
  className?: string;
  scrollHideDelay?: number;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
};

/**
 * Size-token lookup tables driving Radix scrollbar dimensions and the invisible "hit area"
 * pseudo-element that enlarges the touch target on the thumb.
 *
 * Keys must stay aligned with the `size` prop union in `TScrollAreaProps` (sm | md | lg).
 */
const sizeStyles = {
  sm: "p-[0.112rem] data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:h-2.5",
  md: "p-[0.152rem] data-[orientation=vertical]:w-3 data-[orientation=horizontal]:h-3",
  lg: "p-[0.225rem] data-[orientation=vertical]:w-4 data-[orientation=horizontal]:h-4",
};

const thumbSizeStyles = {
  sm: "before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2",
  md: "before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-14 before:min-w-14 before:-translate-x-1/2 before:-translate-y-1/2",
  lg: "before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-17 before:min-w-17 before:-translate-x-1/2 before:-translate-y-1/2",
};

/**
 * Custom-styled scroll container built on top of `@radix-ui/react-scroll-area` so all four
 * Plane apps (web, admin, space, live) share one scrollbar look-and-feel regardless of browser
 * or platform defaults.
 *
 * Both vertical and horizontal scrollbars are always rendered (Radix shows them only when the
 * content overflows). The `size` token controls bar thickness via `sizeStyles` and enlarges the
 * thumb's invisible hit-area for touch via `thumbSizeStyles`.
 *
 * Props (see local `TScrollAreaProps`):
 *   - `type` (default `"always"`): Radix scrollbar visibility mode.
 *   - `className`: extra classes merged onto the `Root`.
 *   - `scrollHideDelay` (default `600`): fade delay in ms when `type` is `"scroll"` or `"hover"`.
 *   - `size` (default `"md"`): scrollbar thickness preset.
 *   - `children`: scrollable content rendered inside the Radix `Viewport`.
 *
 * Accessibility: keyboard scrolling (arrow keys, PageUp/PageDown, Home/End) is inherited from
 * Radix; the wrapper does not add or override ARIA attributes.
 */
export function ScrollArea(props: TScrollAreaProps) {
  const { type = "always", className = "", scrollHideDelay = 600, size = "md", children } = props;

  return (
    <RadixScrollArea.Root
      type={type}
      className={cn("group overflow-hidden", className)}
      scrollHideDelay={scrollHideDelay}
    >
      <RadixScrollArea.Viewport className="size-full">{children}</RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        className={cn(
          "group/track flex touch-none bg-transparent transition-colors duration-150 ease-out select-none",
          sizeStyles[size]
        )}
        orientation="vertical"
      >
        <RadixScrollArea.Thumb
          className={cn(
            "relative flex-1 rounded-[10px] bg-scrollbar-thumb group-hover:bg-scrollbar-thumb-surface-hover group-hover/track:bg-scrollbar-thumb-hover group-active/track:bg-scrollbar-thumb-active",
            thumbSizeStyles[size]
          )}
        />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Scrollbar
        className={cn(
          "group/track flex touch-none bg-transparent transition-colors duration-150 ease-out select-none",
          sizeStyles[size]
        )}
        orientation="horizontal"
      >
        <RadixScrollArea.Thumb
          className={cn(
            "relative flex-1 rounded-[10px] bg-scrollbar-thumb group-hover:bg-scrollbar-thumb-surface-hover group-hover/track:bg-scrollbar-thumb-hover group-active/track:bg-scrollbar-thumb-active",
            thumbSizeStyles[size]
          )}
        />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
