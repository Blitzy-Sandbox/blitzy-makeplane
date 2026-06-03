/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Token-to-styling helpers backing the Avatar primitives (size scale + shape resolution).
 *
 * Centralizes the avatar design tokens so `Avatar` and `AvatarGroup` stay visually
 * aligned and consumers cannot drift off the supported size/shape set.
 */

/**
 * Supported avatar size tokens plus a raw pixel escape hatch.
 *
 * String tokens (`"sm"`, `"md"`, `"base"`, `"lg"`) map to the design-system size
 * scale through `getSizeInfo`; a `number` value means "render at this exact pixel
 * dimension" and bypasses the token map for ad-hoc sizing requirements.
 */
export type TAvatarSize = "sm" | "md" | "base" | "lg" | number;

/**
 * Resolve a size token to the Tailwind class fragments used by the avatar primitives.
 *
 * Returned class fragments are consumed by both `Avatar` (wrapper dimension + font
 * size on the initial fallback) and `AvatarGroup` (inter-avatar spacing) so the two
 * components stay visually aligned. Numeric (pixel) sizes fall through to the `md`
 * default class set — callers must apply pixel sizing via inline `style`, not via
 * the returned `avatarSize` class.
 *
 * @param size Avatar size token; non-string inputs fall through to the `md` default.
 * @returns Object with `avatarSize`, `fontSize`, and `spacing` Tailwind class fragments.
 */
export const getSizeInfo = (size: TAvatarSize) => {
  switch (size) {
    case "sm":
      return {
        avatarSize: "h-4 w-4",
        fontSize: "text-11",
        spacing: "-space-x-1",
      };
    case "md":
      return {
        avatarSize: "h-5 w-5",
        fontSize: "text-11",
        spacing: "-space-x-1",
      };
    case "base":
      return {
        avatarSize: "h-6 w-6",
        fontSize: "text-13",
        spacing: "-space-x-1.5",
      };
    case "lg":
      return {
        avatarSize: "h-7 w-7",
        fontSize: "text-13",
        spacing: "-space-x-1.5",
      };
    default:
      return {
        avatarSize: "h-5 w-5",
        fontSize: "text-11",
        spacing: "-space-x-1",
      };
  }
};

/**
 * Resolve the avatar's wrapper border-radius class from its shape token.
 *
 * Encodes the "circle vs square" choice in a single helper so the image and
 * fallback branches inside `Avatar` cannot drift apart visually.
 *
 * @param shape Either `"circle"` (default — `rounded-full`) or `"square"` (`rounded-sm`).
 * @returns Tailwind border-radius class fragment.
 */
export const getBorderRadius = (shape: "circle" | "square") => {
  switch (shape) {
    case "circle":
      return "rounded-full";
    case "square":
      return "rounded-sm";
    default:
      return "rounded-full";
  }
};

/**
 * Type-narrow a raw value into the "render at exact pixel dimension" branch.
 *
 * Required because `TAvatarSize` accepts both string tokens and numbers; the
 * avatar components call this guard to choose between inline-style pixel sizing
 * and the Tailwind token map returned by `getSizeInfo`. Rejects `NaN` so a failed
 * coercion upstream cannot pass through silently.
 *
 * @param value Arbitrary value to test (typically the `size` prop).
 * @returns `true` only for real finite numbers; `false` for `NaN` and non-number types.
 */
export const isAValidNumber = (value: unknown) => typeof value === "number" && !isNaN(value);
