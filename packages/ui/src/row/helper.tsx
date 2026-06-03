/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Token-to-styling lookup table backing the `Row` component's `variant` prop.
 *
 * Centralizes the row layout vocabulary (variant enum + the Tailwind class each variant resolves
 * to) so `Row` and any future consumer of these tokens share a single source of truth for
 * page-gutter spacing. Static data and type definitions only — no rendering, no side effects,
 * no imports.
 */

/**
 * Variant tokens controlling `Row`'s horizontal padding:
 *   - `REGULAR` → resolves to `"px-page-x"` (default page-edge horizontal padding for standard rows).
 *   - `HUGGING` → resolves to `"px-0"` (no horizontal padding so children hug the parent's edges,
 *     used for full-bleed sections nested inside an already-padded layout).
 *
 * String-valued enum so the variant value is human-readable in dev tools and Storybook.
 */
export enum ERowVariant {
  REGULAR = "regular",
  HUGGING = "hugging",
}

/**
 * Compile-time union of valid `Row.variant` inputs, derived from `ERowVariant` so adding a
 * new enum member automatically widens this type.
 */
export type TRowVariant = ERowVariant.REGULAR | ERowVariant.HUGGING;

/**
 * Shape of the variant-to-Tailwind-class lookup map: a plain string-keyed dictionary whose
 * values are single Tailwind class strings. The index signature is intentionally loose to keep
 * the structure reusable should additional row-related token tables be introduced later.
 */
export interface IRowProperties {
  [key: string]: string;
}

/**
 * Variant → Tailwind-class lookup powering `Row`'s padding resolution:
 *   - `ERowVariant.REGULAR` → `"px-page-x"` (the project-wide page-gutter token; ensures content
 *     aligns with the global page edge).
 *   - `ERowVariant.HUGGING` → `"px-0"` (explicit zero so the row stretches edge-to-edge inside
 *     an already-padded parent).
 *
 * Keys MUST stay aligned with `ERowVariant` members — adding a new variant requires a matching
 * entry here or `rowStyle[variant]` will be `undefined` at runtime.
 */
export const rowStyle: IRowProperties = {
  [ERowVariant.REGULAR]: "px-page-x",
  [ERowVariant.HUGGING]: "px-0",
};
