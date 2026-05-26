/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Header variant enum, type alias, and class-string lookup tables backing
 * the `Header` composition primitive.
 *
 * Single source of truth for header styling decisions: defines the variant
 * taxonomy, per-variant Tailwind class strings, optional min-height floors,
 * and `getHeaderStyle` which composes them into the final class string
 * consumed by `header.tsx`.
 */

/**
 * Header style variant taxonomy used to select between three layout presets:
 * `PRIMARY` (top-level page header, z-18, hugging row density), `SECONDARY`
 * (sub-header with 52px min-height floor and mobile-visibility toggle, z-15),
 * and `TERNARY` (wrapping action bar with baseline-aligned slot content, z-12).
 */
export enum EHeaderVariant {
  PRIMARY = "primary",
  SECONDARY = "secondary",
  TERNARY = "ternary",
}
/** Union of the three valid `EHeaderVariant` literal members. */
export type THeaderVariant = EHeaderVariant.PRIMARY | EHeaderVariant.SECONDARY | EHeaderVariant.TERNARY;

/** Index-signature contract for variant-keyed class-string lookup tables. */
export interface IHeaderProperties {
  [key: string]: string;
}
/**
 * Per-variant base Tailwind class strings: flex direction, spacing, surface color,
 * borders, and z-index stacking (`PRIMARY` z-18 > `SECONDARY` z-15 > `TERNARY` z-12).
 */
export const headerStyle: IHeaderProperties = {
  [EHeaderVariant.PRIMARY]:
    "relative flex w-full flex-shrink-0 flex-row items-center justify-between gap-x-2 gap-y-4 bg-surface-1 bg-surface-1 z-[18]",
  [EHeaderVariant.SECONDARY]: "!py-0  overflow-y-hidden border-b border-subtle justify-between bg-surface-1 z-[15]",
  [EHeaderVariant.TERNARY]: "flex flex-wrap justify-between py-2  border-b border-subtle gap-2 bg-surface-1 z-[12]",
};
/**
 * Per-variant minimum-height tokens applied when `setMinHeight === true`. Only
 * `SECONDARY` reserves vertical space (52px) to prevent layout shift when its
 * content collapses; `PRIMARY` and `TERNARY` rely on intrinsic child heights.
 */
export const minHeights: IHeaderProperties = {
  [EHeaderVariant.PRIMARY]: "",
  [EHeaderVariant.SECONDARY]: "min-h-[52px]",
  [EHeaderVariant.TERNARY]: "",
};
/**
 * Composes the final header class string by concatenating: `@container` (enables
 * Tailwind container queries) + the variant's base style + optional min-height
 * (when `setMinHeight`) + mobile-visibility (`SECONDARY` only — `flex` or
 * `hidden md:flex` based on `showOnMobile`; other variants ignore `showOnMobile`).
 */
export const getHeaderStyle = (variant: THeaderVariant, setMinHeight: boolean, showOnMobile: boolean) => {
  const height = setMinHeight ? minHeights[variant] : "";
  const display = variant === EHeaderVariant.SECONDARY ? (showOnMobile ? "flex" : "hidden md:flex") : "";
  return " @container " + headerStyle[variant] + " " + height + " " + display;
};
