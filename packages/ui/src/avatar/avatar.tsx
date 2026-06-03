/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Circular Avatar primitive rendering an image with name-derived fallback initials
 * and size/shape tokens.
 *
 * Provides the single visual contract for user/workspace member representation
 * across the `@plane/ui` design system so consumers do not redefine sizing or
 * fallback-rendering rules per call site.
 */

// ui
import { Tooltip } from "@plane/propel/tooltip";
// helpers
import { cn } from "../utils";
import type { TAvatarSize } from "./helper";
import { getBorderRadius, getSizeInfo, isAValidNumber } from "./helper";

type Props = {
  /**
   * The name of the avatar which will be displayed on the tooltip
   */
  name?: string;
  /**
   * The background color if the avatar image fails to load
   */
  fallbackBackgroundColor?: string;
  /**
   * The text to display if the avatar image fails to load
   */
  fallbackText?: string;
  /**
   * The text color if the avatar image fails to load
   */
  fallbackTextColor?: string;
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
  /**
   * The shape of the avatar
   * Possible values: "circle", "square"
   * @default "circle"
   */
  shape?: "circle" | "square";
  /**
   * The source of the avatar image
   */
  src?: string;
  /**
   * The custom CSS class name to apply to the component
   */
  className?: string;
};

/**
 * Image-or-initials avatar primitive used for user/workspace member representation.
 *
 * Renders the `src` image when provided; otherwise falls back to a colored block
 * displaying the first letter of `name` (or `fallbackText`, or `"?"`). A wrapping
 * `Tooltip` surfaces the entity name on hover unless `showTooltip` is disabled.
 *
 * Props (see the local `Props` type for full field-level docs): `src`, `name`,
 * `size` (`TAvatarSize` token or pixel `number`), `shape` (`"circle" | "square"`),
 * `className`, plus the `fallbackBackgroundColor` / `fallbackText` /
 * `fallbackTextColor` overrides for the no-image branch and `showTooltip` to
 * suppress the hover tooltip.
 *
 * Accessibility: the `<img>` element receives the `name` prop as its `alt` text so
 * screen readers announce the entity name on image avatars; the fallback branch
 * relies on the surrounding tooltip for identity. The outer wrapper is explicitly
 * `tabIndex={-1}` because the avatar is decorative within its parent control and
 * focus should land on the interactive ancestor instead.
 */
export function Avatar(props: Props) {
  const {
    name,
    fallbackBackgroundColor,
    fallbackText,
    fallbackTextColor,
    showTooltip = true,
    size = "md",
    shape = "circle",
    src,
    className = "",
  } = props;

  // get size details based on the size prop
  const sizeInfo = getSizeInfo(size);

  return (
    <Tooltip tooltipContent={fallbackText ?? name ?? "?"} disabled={!showTooltip}>
      <div
        className={cn("grid place-items-center overflow-hidden", getBorderRadius(shape), {
          [sizeInfo.avatarSize]: !isAValidNumber(size),
        })}
        style={
          isAValidNumber(size)
            ? {
                height: `${size}px`,
                width: `${size}px`,
              }
            : {}
        }
        tabIndex={-1}
      >
        {src ? (
          <img src={src} className={cn("h-full w-full", getBorderRadius(shape), className)} alt={name} />
        ) : (
          <div
            className={cn(
              sizeInfo.fontSize,
              "grid h-full w-full place-items-center",
              getBorderRadius(shape),
              className
            )}
            style={{
              backgroundColor: fallbackBackgroundColor ?? "#028375",
              color: fallbackTextColor ?? "#ffffff",
            }}
          >
            {name?.[0]?.toUpperCase() ?? fallbackText ?? "?"}
          </div>
        )}
      </div>
    </Tooltip>
  );
}
