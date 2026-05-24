/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type-level utility helpers for the `@plane/types` package.
 *
 * Provides generic TypeScript type transformations (deep-partial, mutually-exclusive
 * presence, optional-key, single-or-array). These helpers are used throughout the
 * monorepo wherever strict type contracts need to be relaxed in specific scenarios
 * — e.g. partial entity updates, form-data shapes, value-or-list inputs, and rich
 * filter expressions consumed by `apps/web`, `apps/space`, `packages/utils`, and
 * `packages/shared-state`.
 */

/**
 * Recursively makes every property of `K` (and every nested object) optional.
 *
 * Unlike TypeScript's built-in `Partial<T>` which only makes the top-level keys
 * optional, this descends into nested object types. Useful for PATCH request bodies
 * and form-state types where any subset of fields may be supplied.
 *
 * @template K - Source type to deeply partial.
 */
export type PartialDeep<K> = {
  [attr in keyof K]?: K[attr] extends object ? PartialDeep<K[attr]> : K[attr];
};

/**
 * Either the fully-populated shape `T` or an empty object — never a partial subset.
 *
 * Modeled as `T | Record<string, never>` so consumers must supply every required
 * key of `T` together, or omit the entire object. Used for paired/grouped fields
 * that must be set as a unit (e.g. rich-filter expressions where partials would be
 * silently dispatched).
 *
 * @template T - Object type whose keys must be present together or absent together.
 */
export type CompleteOrEmpty<T> = T | Record<string, never>;

/**
 * Makes the specified keys `K` of `T` optional while leaving all other keys required.
 *
 * Useful for form/draft variants of full entity types where only specific identifiers
 * (e.g. `id`, `created_at`) are absent before persistence.
 *
 * @template T - Source type.
 * @template K - Keys of `T` to make optional.
 */
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * `T` or an array of `T` — accepts either a single value or a list.
 *
 * Used widely in filter inputs and form values that may be either a single selection
 * or a multi-select; consumers must normalize with `Array.isArray()` before iterating.
 * The conditional guard short-circuits `null` / `undefined` so they are preserved
 * as-is rather than widened to `null | null[]` / `undefined | undefined[]`.
 *
 * @template T - Element type.
 */
export type SingleOrArray<T> = T extends null | undefined ? T : T | T[];
