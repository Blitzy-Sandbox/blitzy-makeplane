/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stacked overflow renderer for displaying multiple `Avatar` instances with a `+N`
 * overflow indicator past a max.
 *
 * Centralizes the visual rules for compact avatar stacks (negative-margin overlap,
 * uniform child sizing via `cloneElement`, "+N total" overflow chip) so consumers
 * do not duplicate the layout math at each call site.
 */

import React from "react";
// ui
import { Tooltip } from "@plane/propel/tooltip";
// helpers
import { cn } from "../utils";
// types
import type { TAvatarSize } from "./helper";
import { getSizeInfo, isAValidNumber } from "./helper";

type Props = {
  /**
   * The children of the avatar group.
   * These should ideally should be `Avatar` components
   */
  children: React.ReactNode;
  /**
   * The maximum number of avatars to display.
   * If the number of children exceeds this value, the additional avatars will be replaced by a count of the remaining avatars.
   * @default 2
   */
  max?: number;
  /**
   * Whether to show the tooltip or not
   * @default true
   */
  showTooltip?: boolean;
  /**
   * The size of the avatars
   * Possible values: "sm", "md", "base", "lg"
   * @default "md"
   */
  size?: TAvatarSize;
};

/**
 * Horizontally-stacked Avatar list that overlaps children with a shared spacing
 * token and renders a `+N total` overflow chip when the child count exceeds `max`.
 *
 * Children must be `Avatar` instances; `showTooltip` and `size` are cloned onto
 * each child via `React.cloneElement` so the group enforces a single uniform
 * appearance even if consumers omitted those props on the individual avatars. When
 * the total exactly equals `max + 1`, the extra avatar is shown directly instead
 * of collapsing into the overflow chip — preferring the avatar over a `+1` glyph.
 *
 * Props (see the local `Props` type for full field-level docs): `children` (an
 * array of `Avatar` elements), `max` (default 2), `showTooltip` (default true),
 * and `size` (`TAvatarSize` token or pixel `number`).
 */
// INTENT UNCLEAR: no explicit ARIA list role (e.g., role="list" / role="listitem")
// or aria-label is set on the outer wrapper; the per-Avatar tooltip and the
// overflow chip's "{N} total" tooltip are the only assistive-tech affordances.
export function AvatarGroup(props: Props) {
  const { children, max = 2, showTooltip = true, size = "md" } = props;

  // calculate total length of avatars inside the group
  const totalAvatars = React.Children.toArray(children).length;

  // if avatars are equal to max + 1, then we need to show the last avatar as well, if avatars are more than max + 1, then we need to show the count of the remaining avatars
  const maxAvatarsToRender = totalAvatars <= max + 1 ? max + 1 : max;

  // slice the children to the maximum number of avatars
  const avatars = React.Children.toArray(children).slice(0, maxAvatarsToRender);

  // assign the necessary props from the AvatarGroup component to the Avatar components
  const avatarsWithUpdatedProps = avatars.map((avatar) => {
    const updatedProps: Partial<Props> = {
      showTooltip,
      size,
    };

    return React.cloneElement(avatar as React.ReactElement, updatedProps);
  });

  // get size details based on the size prop
  const sizeInfo = getSizeInfo(size);

  return (
    <div className={cn("flex", sizeInfo.spacing)}>
      {avatarsWithUpdatedProps.map((avatar, index) => (
        <div key={index} className="rounded-full border border-subtle-1">
          {avatar}
        </div>
      ))}
      {maxAvatarsToRender < totalAvatars && (
        <Tooltip tooltipContent={`${totalAvatars} total`} disabled={!showTooltip}>
          <div
            className={cn(
              "grid place-items-center rounded-full border border-subtle-1 bg-accent-subtle text-9 text-accent-primary",
              {
                [sizeInfo.avatarSize]: !isAValidNumber(size),
              }
            )}
            style={
              isAValidNumber(size)
                ? {
                    width: `${size}px`,
                    height: `${size}px`,
                  }
                : {}
            }
          >
            +{totalAvatars - max}
          </div>
        </Tooltip>
      )}
    </div>
  );
}
