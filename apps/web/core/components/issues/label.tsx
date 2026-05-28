/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Inline label badge renderer for a work item label list.
 *
 * Rendered purpose: renders each label as a compact pill with its color and name (wrapped in a `Tooltip`)
 * when the total count is at-or-below `maxRender`; otherwise collapses to a single "{n} Labels" pill whose
 * tooltip lists every label name joined by ", ".
 *
 * Props:
 *   - labelDetails (any[], required): the resolved label entities for the work item — each item is expected
 *     to expose `{ id, name, color }`. The `any[]` type is preserved verbatim from the source for compatibility
 *     with multiple label snapshot shapes across the issue layouts.
 *   - maxRender (number, optional, default=1): the threshold for switching between individual label pills and
 *     the collapsed "{n} Labels" badge
 *
 * MobX stores read: none — labels are passed in as a snapshot from the caller (typically resolved upstream via
 * `useLabel()` or similar).
 *
 * Side effects: none.
 *
 * Accessibility notes:
 *   - Each pill is wrapped in `Tooltip` from `@plane/propel/tooltip`, which provides keyboard-accessible tooltips.
 *   - Tooltip `isMobile` is sourced from `usePlatformOS()` so touch devices get the appropriate display behavior.
 *
 * Consumers: rendered by issue list/spreadsheet layouts and preview cards where labels are surfaced inline —
 * e.g., issue-layout properties in `apps/web/core/components/issues/issue-layouts/properties/labels.tsx`.
 */

import React from "react";
// components
import { Tooltip } from "@plane/propel/tooltip";
import { usePlatformOS } from "@/hooks/use-platform-os";
type Props = {
  labelDetails: any[];
  maxRender?: number;
};

export function ViewIssueLabel({ labelDetails, maxRender = 1 }: Props) {
  const { isMobile } = usePlatformOS();
  return (
    <>
      {labelDetails?.length > 0 ? (
        labelDetails.length <= maxRender ? (
          <>
            {labelDetails.map((label) => (
              <div
                key={label.id}
                className="shadow-sm flex flex-shrink-0 cursor-default items-center rounded-md border border-strong px-2.5 py-1 text-11"
              >
                <Tooltip position="top" tooltipHeading="Label" tooltipContent={label.name} isMobile={isMobile}>
                  <div className="flex items-center gap-1.5 text-secondary">
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{
                        backgroundColor: label?.color ?? "#000000",
                      }}
                    />
                    {label.name}
                  </div>
                </Tooltip>
              </div>
            ))}
          </>
        ) : (
          <div className="shadow-sm flex flex-shrink-0 cursor-default items-center rounded-md border border-strong px-2.5 py-1 text-11">
            <Tooltip
              position="top"
              tooltipHeading="Labels"
              tooltipContent={labelDetails.map((l) => l.name).join(", ")}
              isMobile={isMobile}
            >
              <div className="flex items-center gap-1.5 text-secondary">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-primary" />
                {`${labelDetails.length} Labels`}
              </div>
            </Tooltip>
          </div>
        )
      ) : (
        ""
      )}
    </>
  );
}
