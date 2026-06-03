/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Blueprint `Tooltip2` wrapper providing standardized delays, placement tokens, and mobile-aware suppression.
 */

import { Tooltip2 } from "@blueprintjs/popover2";
import React, { useEffect, useRef, useState } from "react";
// helpers
import { cn } from "../utils";

/**
 * Placement tokens accepted by the `Tooltip` component's `position` prop. Mirrors the
 * Popper-style placement union surfaced by Blueprint's `Tooltip2` (`@blueprintjs/popover2`) and
 * is re-exported through `packages/ui/src/tooltip/index.ts` so consumers can type their own
 * tooltip-position state. The token names follow Popper conventions — primary axis first
 * (`top`/`right`/`bottom`/`left`/`auto`), optional alignment hint second (`-start`/`-end` for
 * `auto`; corner names like `bottom-left`/`top-right` for fixed sides).
 */
export type TPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "auto"
  | "auto-end"
  | "auto-start"
  | "bottom-left"
  | "bottom-right"
  | "left-bottom"
  | "left-top"
  | "right-bottom"
  | "right-top"
  | "top-left"
  | "top-right";

interface ITooltipProps {
  tooltipHeading?: string;
  tooltipContent: string | React.ReactNode;
  position?: TPosition;
  children: React.ReactElement;
  disabled?: boolean;
  className?: string;
  openDelay?: number;
  closeDelay?: number;
  isMobile?: boolean;
  renderByDefault?: boolean;
}

/**
 * Wraps Blueprint `Tooltip2` to deliver a single tooltip surface across the design system,
 * suppressing tooltips on touch devices since hover semantics do not translate to mobile UX.
 *
 * Mobile suppression: tooltips on touch devices are unreliable (no hover) and tend to obscure
 * adjacent UI; the `isMobile` flag adds a `hidden` class to the panel so the touch experience
 * stays clean.
 *
 * Delay tokens: small open/close delays prevent tooltip flicker as a pointer moves across
 * adjacent elements (e.g. a row of icons).
 *
 * Accessibility: Blueprint `Tooltip2` wires `aria-describedby` between the cloned anchor element
 * and the tooltip popper, providing programmatic association for assistive technology.
 *
 * Props:
 * - `tooltipHeading` (string, optional) — bold heading rendered above the tooltip content.
 * - `tooltipContent` (string | React.ReactNode, required) — body content of the tooltip.
 * - `children` (React.ReactElement, required) — the anchor element the tooltip attaches to;
 *   must be a single React element so Blueprint's `renderTarget` can clone refs/props into it.
 * - `position` (TPosition, optional, default `"top"`) — placement token forwarded to Blueprint.
 * - `disabled` (boolean, optional, default `false`) — disables the tooltip entirely.
 * - `className` (string, optional, default `""`) — additional classes merged into the panel.
 * - `openDelay` (number, optional, default `200`) — hover-open delay in ms.
 * - `closeDelay` (number, optional) — hover-close delay in ms.
 * - `isMobile` (boolean, optional, default `false`) — when true, adds `hidden` to suppress the
 *   tooltip on touch surfaces.
 * - `renderByDefault` (boolean, optional, default `true`) — when false, defers mounting the
 *   Blueprint overlay until first hover. Default `true` is a temporary fix (see FIXME below).
 *
 * INTENT UNCLEAR: tooltip text is hover-only — keyboard-focused users may not receive tooltip
 * text unless Blueprint surfaces it on focus.
 */
export function Tooltip({
  tooltipHeading,
  tooltipContent,
  position = "top",
  children,
  disabled = false,
  className = "",
  openDelay = 200,
  closeDelay,
  isMobile = false,

  //FIXME: tooltip should always render on hover and not by default, this is a temporary fix
  renderByDefault = true,
}: ITooltipProps) {
  const toolTipRef = useRef<HTMLDivElement | null>(null);

  const [shouldRender, setShouldRender] = useState(renderByDefault);

  const onHover = () => {
    setShouldRender(true);
  };

  useEffect(() => {
    const element = toolTipRef.current as any;

    if (!element) return;

    element.addEventListener("mouseenter", onHover);

    return () => {
      element?.removeEventListener("mouseenter", onHover);
    };
  }, [toolTipRef, shouldRender]);

  if (!shouldRender) {
    return (
      <div ref={toolTipRef} className="flex h-full items-center">
        {children}
      </div>
    );
  }

  return (
    <Tooltip2
      disabled={disabled}
      hoverOpenDelay={openDelay}
      hoverCloseDelay={closeDelay}
      content={
        <div
          className={cn(
            "shadow-md relative z-50 block max-w-xs gap-1 overflow-hidden rounded-md bg-surface-1 p-2 text-11 break-words text-secondary",
            {
              hidden: isMobile,
            },
            className
          )}
        >
          {tooltipHeading && <h5 className="font-medium text-primary">{tooltipHeading}</h5>}
          {tooltipContent}
        </div>
      }
      position={position}
      renderTarget={({ isOpen: isTooltipOpen, ref: eleReference, ...tooltipProps }) =>
        React.cloneElement(children, {
          ref: eleReference,
          ...tooltipProps,
          ...children.props,
        })
      }
    />
  );
}
