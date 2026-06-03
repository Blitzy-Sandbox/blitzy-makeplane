/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact visual chip used by label activity rows to display a label's name
 * with its color dot and a hover tooltip showing the full label name.
 *
 * This is NOT an activity row itself — it is a presentation helper rendered by
 * `IssueLabelActivity` (`label.tsx`) in place of the bare label name.
 *
 * Props:
 *   - name (string, optional): label name shown both inline and inside the tooltip.
 *   - color (string, optional): hex color string for the leading dot; falls back
 *     to `#000000` when undefined (typical for deleted labels whose color can no
 *     longer be resolved via `useLabel().getLabelById`).
 *
 * MobX stores read: none (pure prop-driven).
 *
 * Side effects: none. Read-only / presentational.
 *
 * Accessibility: the colored dot uses `aria-hidden="true"` because the label
 * name is also rendered as visible text — screen readers therefore announce
 * the name once, not duplicated through the decorative dot.
 */

import { Tooltip } from "@plane/propel/tooltip";

type TIssueLabelPill = { name?: string; color?: string };

export function LabelActivityChip(props: TIssueLabelPill) {
  const { name, color } = props;
  return (
    <Tooltip tooltipContent={name}>
      <span className="inline-flex w-min max-w-32 flex-shrink-0 cursor-default items-center gap-2 truncate rounded-full border border-strong px-2 py-0.5 text-11 whitespace-nowrap">
        <span
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{
            backgroundColor: color ?? "#000000",
          }}
          aria-hidden="true"
        />
        <span className="flex-shrink truncate font-medium text-primary">{name}</span>
      </span>
    </Tooltip>
  );
}
