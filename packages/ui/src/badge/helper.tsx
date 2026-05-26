/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Token-to-styling lookup tables backing the `Badge` variant and size props.
 *
 * Centralizes the Tailwind class strings for every supported visual variant
 * (color family × solid/accent/outline) and every size step, plus the two
 * resolver functions ({@link getBadgeStyling}, {@link getIconStyling}) that
 * convert typed props into ready-to-use class strings. Kept separate from
 * `badge.tsx` so the component file stays small and the design tokens can
 * be diffed independently when the theme changes.
 */

/**
 * Visual variant tokens accepted by the `Badge` component.
 *
 * Composed as `color × surface` where the five color families are
 * `primary`, `neutral`, `success`, `warning`, `destructive`, and the three
 * surface treatments are the solid family name (e.g., `"primary"`), the
 * `accent-*` family (subtle tinted background with brand-color text), and
 * the `outline-*` family (transparent/surface background with a colored
 * border). Consumers should treat values as a closed union — adding a new
 * variant requires adding a matching entry to {@link badgeStyling}.
 */
export type TBadgeVariant =
  | "primary"
  | "accent-primary"
  | "outline-primary"
  | "neutral"
  | "accent-neutral"
  | "outline-neutral"
  | "success"
  | "accent-success"
  | "outline-success"
  | "warning"
  | "accent-warning"
  | "outline-warning"
  | "destructive"
  | "accent-destructive"
  | "outline-destructive";

/**
 * Size tokens accepted by the `Badge` component, ordered smallest to largest.
 *
 * `sm`/`md`/`lg`/`xl` control horizontal/vertical padding and font size on
 * the badge shell; the icon container scales `sm`<`md`<`lg`=`xl` (the last
 * two share a 4×4 icon box by design — see the `// eslint-disable` line in
 * `badgeIconStyling`).
 */
export type TBadgeSizes = "sm" | "md" | "lg" | "xl";

/**
 * Shape of an entry in the {@link badgeStyling} lookup table.
 *
 * Each variant must declare three orthogonal class strings: `default`
 * (resting/idle state), `hover` (mouse-hover state), and `disabled`
 * (disabled OR loading state — `Badge` collapses both into this slot).
 * Keyed by `string` rather than `TBadgeVariant` to keep the table indexable
 * by computed expressions without TypeScript narrowing churn.
 */
export interface IBadgeStyling {
  [key: string]: {
    default: string;
    hover: string;
    disabled: string;
  };
}

/**
 * Internal size lookup tables for the badge shell and icon container.
 *
 * `badgeSizeStyling` maps {@link TBadgeSizes} → outer button class string
 * (padding, font size, layout); `badgeIconStyling` maps the same key to the
 * icon wrapper class string (icon box dimensions, flex centering). Both
 * are intentionally local — only the {@link getBadgeStyling} and
 * {@link getIconStyling} getters reach into them, so the design tokens
 * have a single point of indirection.
 *
 * Kept as `enum` rather than plain object literals to preserve the
 * compile-time key check; the upstream `// TODO` markers below note an
 * intent to switch to `Record`-typed objects but the migration is out of
 * scope for documentation work.
 */
// TODO: convert them to objects instead of enums
enum badgeSizeStyling {
  sm = `px-2.5 py-1 font-medium text-11 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center inline`,
  md = `px-4 py-1.5 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center inline`,
  lg = `px-4 py-2 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center inline`,
  xl = `px-5 py-3 font-medium text-13 rounded-sm flex items-center gap-1.5 whitespace-nowrap transition-all justify-center inline`,
}

// TODO: convert them to objects instead of enums
enum badgeIconStyling {
  sm = "h-3 w-3 flex justify-center items-center overflow-hidden flex-shrink-0",
  md = "h-3.5 w-3.5 flex justify-center items-center overflow-hidden flex-shrink-0",
  lg = "h-4 w-4 flex justify-center items-center overflow-hidden flex-shrink-0",
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  xl = "h-4 w-4 flex justify-center items-center overflow-hidden flex-shrink-0",
}

/**
 * Per-variant class string lookup table consumed by {@link getBadgeStyling}.
 *
 * Keys mirror {@link TBadgeVariant}; each value carries the three-state
 * payload defined by {@link IBadgeStyling} (`default`, `hover`, `disabled`).
 * Class strings reference design-system color tokens (e.g., `bg-accent-primary`,
 * `text-success-primary`) and Tailwind utilities; theme changes are made
 * by editing this table, not the component.
 */
export const badgeStyling: IBadgeStyling = {
  primary: {
    default: `text-on-color bg-accent-primary`,
    hover: `hover:bg-accent-primary/80`,
    disabled: `cursor-not-allowed !bg-custom-primary-60 hover:bg-custom-primary-60`,
  },
  "accent-primary": {
    default: `bg-accent-subtle text-accent-primary`,
    hover: `hover:bg-custom-primary-20 hover:text-accent-secondary`,
    disabled: `cursor-not-allowed !text-accent-primary/60`,
  },
  "outline-primary": {
    default: `text-accent-primary bg-surface-1 border border-accent-strong`,
    hover: `hover:border-accent-strong-80 hover:bg-accent-subtle`,
    disabled: `cursor-not-allowed !text-accent-primary/60 !border-accent-strong-60 `,
  },

  neutral: {
    default: `text-custom-background-100 bg-layer-1 border border-subtle`,
    hover: `hover:bg-layer-1`,
    disabled: `cursor-not-allowed bg-subtle-1 !text-placeholder`,
  },
  "accent-neutral": {
    default: `text-secondary bg-layer-1`,
    hover: `hover:bg-subtle-1 hover:text-primary`,
    disabled: `cursor-not-allowed !text-placeholder`,
  },
  "outline-neutral": {
    default: `text-secondary bg-surface-1 border border-subtle`,
    hover: `hover:text-primary hover:bg-subtle-1`,
    disabled: `cursor-not-allowed !text-placeholder`,
  },

  success: {
    default: `text-on-color bg-green-500`,
    hover: `hover:bg-green-600`,
    disabled: `cursor-not-allowed !bg-green-300`,
  },
  "accent-success": {
    default: `text-success-primary bg-green-50`,
    hover: `hover:bg-green-100 hover:text-success-primary`,
    disabled: `cursor-not-allowed text-success-secondary!`,
  },
  "outline-success": {
    default: `text-success-primary bg-surface-1 border border-success-strong`,
    hover: `hover:text-success-primary hover:bg-green-50`,
    disabled: `cursor-not-allowed text-success-secondary! border-success-subtle`,
  },

  warning: {
    default: `text-on-color bg-amber-500`,
    hover: `hover:bg-amber-600`,
    disabled: `cursor-not-allowed !bg-amber-300`,
  },
  "accent-warning": {
    default: `text-amber-500 bg-amber-50`,
    hover: `hover:bg-amber-100 hover:text-amber-600`,
    disabled: `cursor-not-allowed !text-amber-300`,
  },
  "outline-warning": {
    default: `text-amber-500 bg-surface-1 border border-amber-500`,
    hover: `hover:text-amber-600 hover:bg-amber-50`,
    disabled: `cursor-not-allowed !text-amber-300 border-amber-300`,
  },

  destructive: {
    default: `text-on-color bg-red-500`,
    hover: `hover:bg-red-600`,
    disabled: `cursor-not-allowed !bg-red-300`,
  },
  "accent-destructive": {
    default: `text-danger-primary bg-red-50`,
    hover: `hover:bg-red-100 hover:text-danger-primary`,
    disabled: `cursor-not-allowed text-danger-secondary!`,
  },
  "outline-destructive": {
    default: `text-danger-primary bg-surface-1 border border-danger-strong`,
    hover: `hover:text-danger-primary hover:bg-red-50`,
    disabled: `cursor-not-allowed text-danger-secondary! border-danger-subtle`,
  },
};

/**
 * Resolve a badge variant + size + interaction-state triple to a single
 * Tailwind class string.
 *
 * Concatenates the variant's `default` classes with either its `hover`
 * classes (when enabled) or its `disabled` classes (when disabled or
 * loading), then appends the size class string. The result is fed
 * straight into `cn(...)` by the `Badge` component.
 *
 * @param variant - One of the {@link TBadgeVariant} tokens; looked up in
 *   {@link badgeStyling}.
 * @param size - One of the {@link TBadgeSizes} tokens; looked up in the
 *   internal `badgeSizeStyling` table.
 * @param disabled - Defaults to `false`; when `true`, swaps the hover
 *   classes for the disabled classes. The Badge component passes
 *   `disabled || loading` so loading visually disables the badge.
 * @returns Space-separated Tailwind class string ready for `cn(...)`.
 */
export const getBadgeStyling = (variant: TBadgeVariant, size: TBadgeSizes, disabled: boolean = false): string => {
  let tempVariant: string = ``;
  const currentVariant = badgeStyling[variant];

  tempVariant = `${currentVariant.default} ${disabled ? currentVariant.disabled : currentVariant.hover}`;

  let tempSize: string = ``;
  if (size) tempSize = badgeSizeStyling[size];
  return `${tempVariant} ${tempSize}`;
};

/**
 * Resolve a badge size to the Tailwind class string used by the
 * `prependIcon`/`appendIcon` wrapper `<div>` inside `Badge`.
 *
 * @param size - One of the {@link TBadgeSizes} tokens; looked up in the
 *   internal `badgeIconStyling` table. `lg` and `xl` return the same
 *   class string by design.
 * @returns Space-separated Tailwind class string for the icon container.
 */
export const getIconStyling = (size: TBadgeSizes): string => {
  let icon: string = ``;
  if (size) icon = badgeIconStyling[size];
  return icon;
};
