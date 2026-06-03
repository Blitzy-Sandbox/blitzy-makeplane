/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Variant and size token lookup tables driving `Button` styling.
 *
 * This module is the single source of truth for the design-system tokens (`variant`, `size`) and
 * for the Tailwind class strings that map them to button appearance. The `Button` component in
 * `./button` reads from these tables via `getButtonStyling` and `getIconStyling`; consumers
 * import the token unions (`TButtonVariant`, `TButtonSizes`) to type their own button-rendering
 * surfaces consistently.
 */

/**
 * Design-token union enumerating every supported visual variant for the `Button` primitive.
 *
 * - `primary` / `accent-primary` / `outline-primary` / `neutral-primary` / `link-primary`:
 *   neutral and brand-accent variants used for affirmative actions and navigation.
 * - `danger` / `accent-danger` / `outline-danger` / `link-danger` / `tertiary-danger`:
 *   destructive variants used for delete/leave/cancel actions.
 * - `link-neutral`: text-only inline action without surrounding chrome.
 *
 * Adding a new variant requires a matching entry in `buttonStyling` so `getButtonStyling`
 * resolves it correctly.
 */
export type TButtonVariant =
  | "primary"
  | "accent-primary"
  | "outline-primary"
  | "neutral-primary"
  | "link-primary"
  | "danger"
  | "accent-danger"
  | "outline-danger"
  | "link-danger"
  | "tertiary-danger"
  | "link-neutral";

/**
 * Design-token union enumerating supported `Button` sizes. Each token maps to a distinct
 * padding/font-size pair in `buttonSizeStyling` and a matching icon-container size in
 * `buttonIconStyling`.
 */
export type TButtonSizes = "sm" | "md" | "lg" | "xl";

/**
 * Shape of the variant-state lookup table. Every entry must declare Tailwind class strings for
 * the four interaction states (`default`, `hover`, `pressed`, `disabled`) so `getButtonStyling`
 * can compose them at runtime.
 */
export interface IButtonStyling {
  [key: string]: {
    default: string;
    hover: string;
    pressed: string;
    disabled: string;
  };
}

/**
 * Size-token lookup table mapping each `TButtonSizes` value to the Tailwind class string that
 * controls button padding, font size, and flexbox alignment. Supported keys: `sm`, `md`, `lg`, `xl`.
 *
 * Internal — consumed only by `getButtonStyling`; consumers should never read this enum directly.
 */
enum buttonSizeStyling {
  sm = `px-3 py-1.5 font-medium text-11 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center`,
  md = `px-4 py-1.5 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center`,
  lg = `px-5 py-2 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center`,
  xl = `px-5 py-3.5 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center`,
}

/**
 * Size-token lookup table mapping each `TButtonSizes` value to the Tailwind class string applied
 * to the `prependIcon` / `appendIcon` container `<div>` inside `Button`. Supported keys: `sm`,
 * `md`, `lg`, `xl`.
 *
 * Internal — consumed only by `getIconStyling`; consumers should never read this enum directly.
 */
enum buttonIconStyling {
  sm = "h-3 w-3 flex justify-center items-center overflow-hidden my-0.5 flex-shrink-0",
  md = "h-3.5 w-3.5 flex justify-center items-center overflow-hidden my-0.5 flex-shrink-0",
  lg = "h-4 w-4 flex justify-center items-center overflow-hidden my-0.5 flex-shrink-0",
  xl = "h-4 w-4 flex justify-center items-center overflow-hidden my-0.5 flex-shrink-0 ",
}

/**
 * Variant lookup table mapping every `TButtonVariant` token to its four interaction-state class
 * strings (`default`, `hover`, `pressed`, `disabled`).
 *
 * Supported variants (must stay aligned with `TButtonVariant`):
 *   - `primary`, `accent-primary`, `outline-primary`, `neutral-primary`, `link-primary`
 *   - `danger`, `accent-danger`, `outline-danger`, `link-danger`, `tertiary-danger`
 *   - `link-neutral`
 *
 * Read by `getButtonStyling` only — modifications here propagate to every `Button` instance.
 */
export const buttonStyling: IButtonStyling = {
  primary: {
    default: `text-on-color bg-accent-primary`,
    hover: `hover:bg-accent-primary/80`,
    pressed: `focus:text-custom-brand-40 focus:bg-accent-primary/80`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-on-color-disabled`,
  },
  "accent-primary": {
    default: `bg-accent-primary/20 text-accent-primary`,
    hover: `hover:bg-accent-primary/10 hover:text-accent-secondary`,
    pressed: `focus:bg-accent-primary/10`,
    disabled: `cursor-not-allowed !text-accent-primary/60`,
  },
  "outline-primary": {
    default: `text-accent-primary bg-transparent border border-accent-strong`,
    hover: `hover:bg-accent-primary/20`,
    pressed: `focus:text-accent-primary focus:bg-accent-primary/30`,
    disabled: `cursor-not-allowed !text-accent-primary/60 !border-accent-strong-60 `,
  },
  "neutral-primary": {
    default: `text-secondary bg-surface-1 border border-subtle`,
    hover: `hover:bg-surface-2`,
    pressed: `focus:text-tertiary focus:bg-surface-2`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-placeholder`,
  },
  "link-primary": {
    default: `text-accent-primary bg-surface-1`,
    hover: `hover:text-accent-secondary`,
    pressed: `focus:text-accent-primary/80 `,
    disabled: `cursor-not-allowed !text-accent-primary/60`,
  },
  danger: {
    default: `bg-danger-primary text-on-color`,
    hover: ` hover:bg-danger-primary-hover`,
    pressed: `focus:bg-danger-primary-active`,
    disabled: `cursor-not-allowed bg-layer-disabled! text-disabled!`,
  },
  "accent-danger": {
    default: `text-danger-primary bg-red-50`,
    hover: `hover:text-danger-primary hover:bg-red-100`,
    pressed: `focus:text-danger-primary focus:bg-red-100`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-placeholder`,
  },
  "outline-danger": {
    default: `bg-layer-2 text-danger-primary border border-danger-strong`,
    hover: `hover:bg-danger-subtle`,
    pressed: `focus:bg-danger-subtle-hover`,
    disabled: `cursor-not-allowed text-disabled! border-subtle-1!`,
  },
  "link-danger": {
    default: `text-danger-primary bg-surface-1`,
    hover: `hover:text-danger-primary`,
    pressed: `focus:text-danger-primary`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-placeholder`,
  },
  "tertiary-danger": {
    default: `text-danger-primary bg-surface-1 border border-danger-subtle`,
    hover: `hover:bg-red-50 hover:border-danger-subtle`,
    pressed: `focus:text-danger-primary`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-placeholder`,
  },
  "link-neutral": {
    default: `text-tertiary`,
    hover: `hover:text-secondary`,
    pressed: `focus:text-primary`,
    disabled: `cursor-not-allowed !bg-layer-1 !text-placeholder`,
  },
};

/**
 * Resolves a `TButtonVariant` + `TButtonSizes` pair into a Tailwind class string by concatenating
 * the matched entry from `buttonStyling` (with `hover` swapped to `disabled` when applicable) and
 * the matched entry from `buttonSizeStyling`.
 *
 * Called by `Button` on every render; `disabled` should be `disabled || loading` to align the
 * visual state with the HTML `disabled` attribute the component applies.
 */
export const getButtonStyling = (variant: TButtonVariant, size: TButtonSizes, disabled: boolean = false): string => {
  let tempVariant: string = ``;
  const currentVariant = buttonStyling[variant];

  tempVariant = `${currentVariant.default} ${disabled ? currentVariant.disabled : currentVariant.hover} ${
    currentVariant.pressed
  }`;

  let tempSize: string = ``;
  if (size) tempSize = buttonSizeStyling[size];
  return `${tempVariant} ${tempSize}`;
};

/**
 * Returns the Tailwind class string for the `prependIcon` / `appendIcon` container `<div>` based
 * on the requested `TButtonSizes` token.
 */
export const getIconStyling = (size: TButtonSizes): string => {
  let icon: string = ``;
  if (size) icon = buttonIconStyling[size];
  return icon;
};
