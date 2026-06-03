/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Token-to-styling lookup tables for Card variant, spacing, and direction props.
 *
 * Centralises the design-system tokens consumed by the `Card` component
 * (`./card.tsx`) so the component stays declarative and the token→Tailwind
 * class mapping has a single source of truth. Imported by `card.tsx`; not
 * intended for direct consumer use outside the `card/` folder.
 */

/**
 * Elevation/border treatment tokens applied to the Card surface.
 *
 * Supported members:
 *   - `WITHOUT_SHADOW` (`"without-shadow"`): flat surface, no hover shadow
 *   - `WITH_SHADOW` (`"with-shadow"`): hover-only elevated shadow over a 300ms duration
 *
 * Used as keys into {@link containerStyle}.
 */
export enum ECardVariant {
  WITHOUT_SHADOW = "without-shadow",
  WITH_SHADOW = "with-shadow",
}
/**
 * Flex axis tokens controlling Card child layout direction.
 *
 * Supported members:
 *   - `ROW` (`"row"`): horizontal flow with `space-x-3` child gap
 *   - `COLUMN` (`"column"`): vertical flow with `space-y-3` child gap
 *
 * Used as keys into {@link directions}.
 */
export enum ECardDirection {
  ROW = "row",
  COLUMN = "column",
}
/**
 * Internal padding tokens controlling Card content density.
 *
 * Supported members:
 *   - `SM` (`"sm"`): compact padding (`p-4`)
 *   - `LG` (`"lg"`): default padding (`p-6`)
 *
 * Used as keys into {@link spacings}.
 */
export enum ECardSpacing {
  SM = "sm",
  LG = "lg",
}
/**
 * Restricts the `Card.variant` prop to the two valid {@link ECardVariant}
 * members so TypeScript catches stray string literals at the call site.
 */
export type TCardVariant = ECardVariant.WITHOUT_SHADOW | ECardVariant.WITH_SHADOW;
/**
 * Restricts the `Card.direction` prop to the two valid {@link ECardDirection}
 * members.
 */
export type TCardDirection = ECardDirection.ROW | ECardDirection.COLUMN;
/**
 * Restricts the `Card.spacing` prop to the two valid {@link ECardSpacing}
 * members.
 */
export type TCardSpacing = ECardSpacing.SM | ECardSpacing.LG;

/**
 * Generic shape for any token → Tailwind class-name lookup map consumed by
 * the Card. Indexed by an enum string value; resolves to a Tailwind class
 * fragment that is concatenated by {@link getCardStyle}.
 */
export interface ICardProperties {
  [key: string]: string;
}

/**
 * Base Tailwind classes applied to every Card surface regardless of tokens
 * (background, rounding, hairline border, full-width, vertical flex container).
 */
const DEFAULT_STYLE = "bg-surface-1 rounded-lg border-[0.5px] border-subtle w-full flex flex-col";
/**
 * Variant token → Tailwind class lookup applied to the Card container.
 *
 * Keyed by {@link ECardVariant} members:
 *   - `WITHOUT_SHADOW`: `""` (no extra classes)
 *   - `WITH_SHADOW`: `"hover:shadow-raised-200 duration-300"`
 *
 * Combined with {@link DEFAULT_STYLE}, {@link directions}, and {@link spacings}
 * by {@link getCardStyle}.
 */
export const containerStyle: ICardProperties = {
  [ECardVariant.WITHOUT_SHADOW]: "",
  [ECardVariant.WITH_SHADOW]: "hover:shadow-raised-200 duration-300",
};
/**
 * Spacing token → Tailwind padding lookup applied to the Card container.
 *
 * Keyed by {@link ECardSpacing} members:
 *   - `SM`: `"p-4"`
 *   - `LG`: `"p-6"`
 *
 * Combined into the final class string by {@link getCardStyle}.
 */
export const spacings = {
  [ECardSpacing.SM]: "p-4",
  [ECardSpacing.LG]: "p-6",
};
/**
 * Direction token → Tailwind flex-direction + child-gap lookup.
 *
 * Keyed by {@link ECardDirection} members:
 *   - `ROW`: `"flex-row space-x-3"`
 *   - `COLUMN`: `"flex-col space-y-3"`
 *
 * Combined into the final class string by {@link getCardStyle}.
 */
export const directions = {
  [ECardDirection.ROW]: "flex-row space-x-3",
  [ECardDirection.COLUMN]: "flex-col space-y-3",
};
/**
 * Concatenates the base Card classes with the chosen direction, variant, and
 * spacing token lookups in a single deterministic pass; no validation or branching.
 *
 * @param variant - {@link TCardVariant} token controlling elevation/border treatment.
 * @param spacing - {@link TCardSpacing} token controlling internal padding.
 * @param direction - {@link TCardDirection} token controlling flex axis.
 * @returns A space-separated Tailwind class string consumable by `cn(...)`.
 */
export const getCardStyle = (variant: TCardVariant, spacing: TCardSpacing, direction: TCardDirection) =>
  DEFAULT_STYLE + " " + directions[direction] + " " + containerStyle[variant] + " " + spacings[spacing];
