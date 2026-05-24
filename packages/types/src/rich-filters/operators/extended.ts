/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended operator-vocabulary placeholders for the `@plane/types/rich-filters/operators` subfolder.
 *
 * Reserved extension surface that mirrors `./core.ts`. All registries are empty `as const`
 * objects and the multi-value tuple is empty `as const`; the aggregate `EXTENDED_OPERATORS`
 * is the empty object spread. `TExtendedSupportedOperators` resolves to `never`.
 *
 * The file exists so future operator families can plug into the public composition in
 * `./index.ts` (object spread + union) without touching consumers.
 */

/** Reserved logical-operator extension registry; currently empty. */
export const EXTENDED_LOGICAL_OPERATOR = {} as const;

/** Reserved equality-operator extension registry; currently empty. */
export const EXTENDED_EQUALITY_OPERATOR = {} as const;

/** Reserved collection-operator extension registry; currently empty. */
export const EXTENDED_COLLECTION_OPERATOR = {} as const;

/** Reserved comparison-operator extension registry; currently empty. */
export const EXTENDED_COMPARISON_OPERATOR = {} as const;

/** Reserved multi-value-operator extension tuple; currently empty. */
export const EXTENDED_MULTI_VALUE_OPERATORS = [] as const;

/**
 * Aggregate of all extended comparison-family operators. Currently the empty object
 * spread — when new members are added, they should be spread in here so they flow
 * through to the public registries in `./index.ts`.
 */
export const EXTENDED_OPERATORS = {
  ...EXTENDED_EQUALITY_OPERATOR,
  ...EXTENDED_COLLECTION_OPERATOR,
  ...EXTENDED_COMPARISON_OPERATOR,
} as const;

/**
 * Union of all extended operator token literals — currently resolves to `never` since
 * `EXTENDED_OPERATORS` is empty.
 */
export type TExtendedSupportedOperators = (typeof EXTENDED_OPERATORS)[keyof typeof EXTENDED_OPERATORS];
