/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel merging the core + extended operator registries into the public runtime
 * registries and the corresponding TypeScript unions; runtime string tokens are
 * part of the persisted wire format (see `./core.ts`).
 */

import type { TCoreSupportedOperators } from "./core";
import {
  CORE_LOGICAL_OPERATOR,
  CORE_EQUALITY_OPERATOR,
  CORE_COLLECTION_OPERATOR,
  CORE_COMPARISON_OPERATOR,
  CORE_MULTI_VALUE_OPERATORS,
} from "./core";
import type { TExtendedSupportedOperators } from "./extended";
import {
  EXTENDED_LOGICAL_OPERATOR,
  EXTENDED_EQUALITY_OPERATOR,
  EXTENDED_COLLECTION_OPERATOR,
  EXTENDED_COMPARISON_OPERATOR,
  EXTENDED_MULTI_VALUE_OPERATORS,
} from "./extended";

// -------- COMPOSED OPERATORS --------

/**
 * Composed runtime registry: spread of `CORE_LOGICAL_OPERATOR` + `EXTENDED_LOGICAL_OPERATOR`.
 * Currently contains only AND.
 */
export const LOGICAL_OPERATOR = {
  ...CORE_LOGICAL_OPERATOR,
  ...EXTENDED_LOGICAL_OPERATOR,
} as const;

/**
 * Composed equality registry: spread of `CORE_EQUALITY_OPERATOR` + `EXTENDED_EQUALITY_OPERATOR`.
 */
export const EQUALITY_OPERATOR = {
  ...CORE_EQUALITY_OPERATOR,
  ...EXTENDED_EQUALITY_OPERATOR,
} as const;

/**
 * Composed collection registry: spread of `CORE_COLLECTION_OPERATOR` + `EXTENDED_COLLECTION_OPERATOR`.
 */
export const COLLECTION_OPERATOR = {
  ...CORE_COLLECTION_OPERATOR,
  ...EXTENDED_COLLECTION_OPERATOR,
} as const;

/**
 * Composed comparison registry: spread of `CORE_COMPARISON_OPERATOR` + `EXTENDED_COMPARISON_OPERATOR`.
 */
export const COMPARISON_OPERATOR = {
  ...CORE_COMPARISON_OPERATOR,
  ...EXTENDED_COMPARISON_OPERATOR,
} as const;

/**
 * Composed tuple of operators whose payload is an array rather than a scalar.
 * `ReadonlyArray<TSupportedOperators>` so consumers can iterate but not mutate.
 */
export const MULTI_VALUE_OPERATORS: ReadonlyArray<TSupportedOperators> = [
  ...CORE_MULTI_VALUE_OPERATORS,
  ...EXTENDED_MULTI_VALUE_OPERATORS,
] as const;

// -------- COMPOSED TYPES --------

/** Union of all logical-operator token literals from `LOGICAL_OPERATOR`. */
export type TLogicalOperator = (typeof LOGICAL_OPERATOR)[keyof typeof LOGICAL_OPERATOR];
/** Union of all equality-operator token literals from `EQUALITY_OPERATOR`. */
export type TEqualityOperator = (typeof EQUALITY_OPERATOR)[keyof typeof EQUALITY_OPERATOR];
/** Union of all collection-operator token literals from `COLLECTION_OPERATOR`. */
export type TCollectionOperator = (typeof COLLECTION_OPERATOR)[keyof typeof COLLECTION_OPERATOR];
/** Union of all comparison-operator token literals from `COMPARISON_OPERATOR`. */
export type TComparisonOperator = (typeof COMPARISON_OPERATOR)[keyof typeof COMPARISON_OPERATOR];

/**
 * Canonical union of all operators that can appear on a `TFilterConditionNode.operator`.
 * Unions the core + extended comparison-family operator unions. Does NOT include
 * logical operators — those live on group-node `logicalOperator` fields.
 */
export type TSupportedOperators = TCoreSupportedOperators | TExtendedSupportedOperators;

/**
 * Display-tier alias of `TSupportedOperators` — currently identical to it.
 * Reserved for the UI to surface negated/composite operator forms (e.g., "is not")
 * that may later be normalized back onto canonical `TSupportedOperators` for persistence.
 */
export type TAllAvailableOperatorsForDisplay = TSupportedOperators;

// -------- RE-EXPORTS --------

export * from "./core";
export * from "./extended";
