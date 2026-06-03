/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Variant and size token lookup tables for the `Tag` primitive.
 *
 * Centralizes the supported `Tag` vocabulary (variants + sizes), the Tailwind class
 * tokens each maps to, and the `getTagStyle` resolver consumed by `tag.tsx`. Keeping
 * the lookup tables here lets the `Tag` component remain a thin presentational shell.
 */

/**
 * Supported visual variants for the `Tag` component.
 *
 * Only `OUTLINED` is currently supported — the enum exists to leave room for
 * additional variants (filled / ghost) without changing the public prop type.
 */
export enum ETagVariant {
  OUTLINED = "outlined",
}
/**
 * Supported size tokens for the `Tag` component.
 *
 * @property SM - Compact padding (`p-1.5`) — used in dense applied-filter chip rows.
 * @property LG - Expanded padding (`p-6`) — reserved for prominent / standalone tags.
 */
export enum ETagSize {
  SM = "sm",
  LG = "lg",
}
/** Compile-time alias narrowing `Tag`'s `variant` prop to the supported set. */
export type TTagVariant = ETagVariant.OUTLINED;

/** Compile-time alias narrowing `Tag`'s `size` prop to the supported set. */
export type TTagSize = ETagSize.SM | ETagSize.LG;
/**
 * String-indexed map used to type the variant/size class-name lookup tables.
 *
 * Keys are enum string values (e.g. `"outlined"`); values are Tailwind class strings.
 */
export interface ITagProperties {
  [key: string]: string;
}

/**
 * Lookup tables resolving `ETagVariant` / `ETagSize` to Tailwind class strings.
 *
 * Tokens supported:
 *   - `containerStyle[ETagVariant.OUTLINED]` — outlined container base classes
 *   - `sizes[ETagSize.SM]` — small padding (`p-1.5`)
 *   - `sizes[ETagSize.LG]` — large padding (`p-6`)
 */
export const containerStyle: ITagProperties = {
  [ETagVariant.OUTLINED]:
    "flex items-center rounded-md border border-subtle text-11 text-tertiary hover:text-secondary min-h-[36px] my-auto capitalize flex-wrap cursor-pointer gap-1.5",
};
export const sizes = {
  [ETagSize.SM]: "p-1.5",
  [ETagSize.LG]: "p-6",
};

/**
 * Resolves a `(variant, size)` pair to the concatenated Tailwind class string
 * consumed by `Tag`'s container `<div>`.
 *
 * @param variant - One of `ETagVariant` (currently only `OUTLINED`).
 * @param size - One of `ETagSize` (`SM` or `LG`).
 * @returns Space-joined class string from `containerStyle[variant]` and `sizes[size]`.
 */
export const getTagStyle = (variant: TTagVariant, size: TTagSize) => containerStyle[variant] + " " + sizes[size];
