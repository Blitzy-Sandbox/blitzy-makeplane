/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core operator vocabulary for the `@plane/types/rich-filters/operators` subfolder.
 *
 * Declares the runtime operator-token registries (logical / equality / collection /
 * comparison families) as frozen `as const` objects so that the value-level tokens and
 * the corresponding TypeScript unions stay synchronized. These string tokens are part
 * of the persisted wire format — adapters in `packages/shared-state/src/store/work-item-filters/`
 * serialize them to disk, and changing any token is a breaking schema migration.
 */

/**
 * Logical operators that combine child expressions in a group node. Currently only AND
 * is supported; OR / NOT slots are reserved for future expansion.
 */
export const CORE_LOGICAL_OPERATOR = {
  /** Conjunction — all children must match. Pairs with `TFilterAndGroupNode`. */
  AND: "and",
} as const;

/**
 * Equality-family operators that compare a property to a single canonical value.
 */
export const CORE_EQUALITY_OPERATOR = {
  /** Exact match — `property === value` for primitives, deep equality for `Date`. */
  EXACT: "exact",
} as const;

/**
 * Collection-family operators that compare a property to a set of values.
 */
export const CORE_COLLECTION_OPERATOR = {
  /** Set-membership — `value.includes(property)`; payload value is an array. */
  IN: "in",
} as const;

/**
 * Comparison-family operators that compare a property to a structured value (e.g., a range).
 */
export const CORE_COMPARISON_OPERATOR = {
  /** Date-range interval — `start <= property <= end`; payload is a [start, end] tuple. */
  RANGE: "range",
} as const;

/**
 * Operators whose payload must be an array rather than a scalar. Used by builders and
 * adapters to decide whether to normalize a scalar input into an array on construction.
 */
export const CORE_MULTI_VALUE_OPERATORS = [CORE_COLLECTION_OPERATOR.IN, CORE_COMPARISON_OPERATOR.RANGE] as const;

/**
 * Aggregate of all core comparison-family operators (equality + collection + comparison).
 * Excludes the logical family because logical operators sit on group nodes, not condition leaves.
 */
export const CORE_OPERATORS = {
  ...CORE_EQUALITY_OPERATOR,
  ...CORE_COLLECTION_OPERATOR,
  ...CORE_COMPARISON_OPERATOR,
} as const;

/**
 * Union of all core comparison-family operator token literals — derived from
 * `CORE_OPERATORS` so the type stays synchronized with the runtime registry.
 */
export type TCoreSupportedOperators = (typeof CORE_OPERATORS)[keyof typeof CORE_OPERATORS];
