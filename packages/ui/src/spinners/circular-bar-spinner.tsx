/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Animated circular spinner composed of rotating bars (12-bar tachometer style).
 *
 * Provides the `CircularBarSpinner` indeterminate loading indicator. Motion is
 * driven by an inline SVG `<animateTransform>` (SMIL) that snaps the bar group
 * through twelve 30° positions over 0.75s with `repeatCount="indefinite"`, so
 * the spinner needs no JS timer or CSS keyframes from the consumer.
 */

import * as React from "react";

/**
 * Props for {@link CircularBarSpinner}.
 *
 * Extends `React.SVGAttributes<SVGElement>` so the type accepts any standard
 * SVG attribute (`aria-*`, `data-*`, event handlers, etc.). Note: the current
 * implementation destructures only `height`, `width`, and `className`; other
 * attributes from the extended type are not forwarded to the underlying `<svg>`.
 */
interface ICircularBarSpinner extends React.SVGAttributes<SVGElement> {
  height?: string;
  width?: string;
  className?: string | undefined;
}

/**
 * Indeterminate loading indicator: a 12-position rotating-bar pattern.
 *
 * @param props - {@link ICircularBarSpinner} props.
 * @param props.height - Optional CSS length applied to the `<svg>` height. Defaults to `"16px"`.
 * @param props.width  - Optional CSS length applied to the `<svg>` width.  Defaults to `"16px"`.
 * @param props.className - Optional class names applied directly to the inner `<svg>` (no class merging).
 *
 * Color: bars use `fill="currentColor"` so the spinner inherits the surrounding text color.
 *
 * Accessibility: the outer `<div>` carries `role="status"`, but the SVG is not
 * marked `aria-hidden` and the component renders no `sr-only` text or
 * `aria-label`. See the `INTENT UNCLEAR` flag below.
 */
// INTENT UNCLEAR: no `sr-only` visually-hidden label or `aria-label` is rendered, and the inner `<svg>` is not marked `aria-hidden="true"`; assistive tech receives no textual status announcement unlike the sibling `Spinner`.
export function CircularBarSpinner({ height = "16px", width = "16px", className = "" }: ICircularBarSpinner) {
  return (
    <div role="status">
      <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24" className={className}>
        <g>
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.14} />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.29} transform="rotate(30 12 12)" />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.43} transform="rotate(60 12 12)" />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.57} transform="rotate(90 12 12)" />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.71} transform="rotate(120 12 12)" />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" opacity={0.86} transform="rotate(150 12 12)" />
          <rect width={2} height={5} x={11} y={1} fill="currentColor" transform="rotate(180 12 12)" />
          <animateTransform
            attributeName="transform"
            calcMode="discrete"
            dur="0.75s"
            repeatCount="indefinite"
            type="rotate"
            values="0 12 12;30 12 12;60 12 12;90 12 12;120 12 12;150 12 12;180 12 12;210 12 12;240 12 12;270 12 12;300 12 12;330 12 12;360 12 12"
          />
        </g>
      </svg>
    </div>
  );
}
