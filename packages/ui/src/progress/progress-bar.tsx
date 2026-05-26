/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Segmented donut-style progress visualization: an SVG ring built from `maxValue` pie-slice
 * `<path>` wedges, where wedges with index ≤ `value` are filled with `activeStrokeColor` and
 * the remainder with `inactiveStrokeColor`. A concentric inner `<circle>` punches out the
 * center to create a hollow ring effect.
 */

import React from "react";

/**
 * Props for {@link ProgressBar}.
 *
 * @property maxValue — optional; total number of pie-slice wedges to render around the ring. Default `0` (renders an empty ring).
 * @property value — optional; number of wedges (1..maxValue) painted with `activeStrokeColor`. Default `0`.
 * @property radius — optional; radius of the outer SVG circle in pixels; SVG canvas is `radius * 2` square. Default `8`.
 * @property strokeWidth — optional; difference between outer and inner-cutout radii in pixels, controlling ring thickness. Default `2`.
 * @property activeStrokeColor — optional; CSS color for wedges representing completed units. Default `"#3e98c7"`.
 * @property inactiveStrokeColor — optional; CSS color for the remaining wedges. Default `"#ddd"`.
 */
type Props = {
  maxValue?: number;
  value?: number;
  radius?: number;
  strokeWidth?: number;
  activeStrokeColor?: string;
  inactiveStrokeColor?: string;
};

// INTENT UNCLEAR: no ARIA wiring on the <svg> or its child <path>/<circle> elements; the segmented ring is purely decorative to assistive tech without consumer-supplied accessibility attributes.
/**
 * Renders a discrete-segment donut progress ring suitable for low-cardinality counters
 * (e.g., subtask checklists with N items).
 *
 * @param props — see {@link Props}
 */
export function ProgressBar({
  maxValue = 0,
  value = 0,
  radius = 8,
  strokeWidth = 2,
  activeStrokeColor = "#3e98c7",
  inactiveStrokeColor = "#ddd",
}: Props) {
  // PIE Calc Fn
  const generatePie = (value: any) => {
    const x = radius - Math.cos((2 * Math.PI) / (100 / value)) * radius;
    const y = radius + Math.sin((2 * Math.PI) / (100 / value)) * radius;
    const long = value <= 50 ? 0 : 1;
    const d = `M${radius} ${radius} L${radius} ${0} A${radius} ${radius} 0 ${long} 1 ${y} ${x} Z`;

    return d;
  };

  // ----  PIE Area Calc  --------
  const calculatePieValue = (numberOfBars: any) => {
    const angle = 360 / numberOfBars;
    const pieValue = Math.floor(angle / 4);
    return pieValue < 1 ? 1 : Math.floor(angle / 4);
  };

  // ----  PIE Render Fn --------
  const renderPie = (i: any) => {
    const DIRECTION = -1;
    // Rotation Calc
    const primaryRotationAngle = (maxValue - 1) * (360 / maxValue);
    const rotationAngle = -1 * DIRECTION * primaryRotationAngle + i * DIRECTION * primaryRotationAngle;
    const rotationTransformation = `rotate(${rotationAngle}, ${radius}, ${radius})`;
    const pieValue = calculatePieValue(maxValue);
    const dValue = generatePie(pieValue);
    const fillColor = value > 0 && i <= value ? activeStrokeColor : inactiveStrokeColor;

    return (
      <path
        style={{ opacity: i === 0 ? 0 : 1 }}
        key={i}
        d={dValue}
        fill={fillColor}
        transform={rotationTransformation}
      />
    );
  };

  // combining the Pies
  const renderOuterCircle = () => [...Array(maxValue + 1)].map((e, i) => renderPie(i));

  return (
    <svg width={radius * 2} height={radius * 2}>
      {renderOuterCircle()}
      <circle r={radius - strokeWidth} cx={radius} cy={radius} className="progress-bar" />
    </svg>
  );
}
