/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Linear (horizontal bar) progress indicator with segmented fill — each segment's
 * width is proportional to its `value` share of the total of all segments.
 *
 * Consumed by `apps/web/core/components/cycles/active-cycle/progress.tsx` and
 * `apps/web/core/components/modules/module-card-item.tsx` to visualize issue
 * status distribution within a cycle or module.
 */

import React from "react";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "../utils";

/**
 * Props for {@link LinearProgressIndicator}.
 *
 * @property data — required; array of segment descriptors. Each item is consumed as `{ id, value, color, name? }`:
 *   - `id` keys the React iteration
 *   - `value` (number) contributes to the total; segment width = `value / sum(all values) * 100%`
 *   - `color` sets the segment's `backgroundColor` inline style
 *   - `name` is used in the tooltip label when `noTooltip === false`
 *   Typed as `any` to accept any caller-defined shape; runtime expects the four fields above.
 * @property noTooltip — optional; when `true`, segments render as bare `<div>`s without the propel `<Tooltip>` wrapper. Default `false`.
 * @property inPercentage — optional; when `true`, the tooltip label appends `%` after the value. Default `false`.
 * @property size — optional; controls the outer bar height via Tailwind classes (`sm=h-2`, `md=h-3`, `lg=h-3.5`, `xl=h-[14px]`). Default `"sm"`.
 * @property className — optional; extra classes merged onto the inner segment container (the bar with the colored slices). Default `""`.
 * @property barClassName — optional; extra classes merged onto each individual segment `<div>` (only applied when tooltips are enabled). Default `""`.
 */
type Props = {
  data: any;
  noTooltip?: boolean;
  inPercentage?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  barClassName?: string;
};

// INTENT UNCLEAR: no `role="progressbar"` or `aria-value*` attributes on the bar container; tooltips supply visual context but no programmatic accessibility metadata.
/**
 * Renders a segmented horizontal bar where each item in `data` becomes a
 * width-proportional colored slice; zero-value segments are skipped.
 *
 * @param props — see {@link Props}
 */
export function LinearProgressIndicator({
  data,
  noTooltip = false,
  inPercentage = false,
  size = "sm",
  className = "",
  barClassName = "",
}: Props) {
  const total = data.reduce((acc: any, cur: any) => acc + cur.value, 0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let progress = 0;

  const bars = data.map((item: any) => {
    const width = `${(item.value / total) * 100}%`;
    if (width === "0%") return <></>;
    const style = {
      width,
      backgroundColor: item.color,
    };
    progress += item.value;
    if (noTooltip) return <div style={style} key={item.id} />;
    else
      return (
        <Tooltip key={item.id} tooltipContent={`${item.name} ${Math.round(item.value)}${inPercentage ? "%" : ""}`}>
          <div style={style} className={cn("first:rounded-l-xs last:rounded-r-xs", barClassName)} />
        </Tooltip>
      );
  });

  return (
    <div
      className={cn("flex w-full items-center justify-between gap-[1px] rounded-xs", {
        "h-2": size === "sm",
        "h-3": size === "md",
        "h-3.5": size === "lg",
        "h-[14px]": size === "xl",
      })}
    >
      <div className={cn("flex h-full w-full gap-[1.5px] rounded-xs bg-surface-2 p-[2px]", className)}>{bars}</div>
    </div>
  );
}
