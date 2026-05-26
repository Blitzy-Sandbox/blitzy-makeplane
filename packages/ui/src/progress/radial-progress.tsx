/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Radial (donut) progress visualization rendering an SVG arc that represents the
 * `progress` percentage as a circular completion ring at a fixed 16×16 px footprint.
 *
 * The arc starts at the top via a -90° rotation and fills clockwise; the track ring
 * sits behind at 10% opacity, sharing the component's current text color (`stroke-current`).
 */

import React, { useState, useEffect } from "react";

/**
 * Props for {@link RadialProgressBar}.
 *
 * @property progress — required; completion value in the 0–100 range used to derive the
 *   SVG stroke dash-offset (`dashOffset = ((100 - progress) / 100) * circumference`).
 *   Values outside 0–100 are not clamped — callers must pre-validate.
 */
interface IRadialProgressBar {
  progress: number;
}

// INTENT UNCLEAR: no `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, or `aria-valuetext` on the wrapping <div> or <svg>; assistive tech receives no progress semantics.
/**
 * Compact 16×16 px donut indicator whose progress arc fills clockwise from the top
 * in proportion to `props.progress`.
 *
 * @param props — see {@link IRadialProgressBar}
 */
export function RadialProgressBar(props: IRadialProgressBar) {
  const { progress } = props;
  const [circumference, setCircumference] = useState(0);

  useEffect(() => {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    setCircumference(circumference);
  }, []);

  const progressOffset = ((100 - progress) / 100) * circumference;

  return (
    <div className="relative h-4 w-4">
      <svg className="absolute top-0 left-0" viewBox="0 0 100 100">
        <circle
          className={"stroke-current opacity-10"}
          cx="50"
          cy="50"
          r="40"
          strokeWidth="12"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
        />
        <circle
          className={`stroke-current`}
          cx="50"
          cy="50"
          r="40"
          strokeWidth="12"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={progressOffset}
          transform="rotate(-90 50 50)"
        />
      </svg>
    </div>
  );
}
