/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel and composition module for rich-filter operator configs.
 *
 * Unions the core + extended per-operator config aliases and exposes the canonical
 * `TOperatorConfigMap` — a `Map` keyed by operator literal, valued by the union of
 * admissible config-shape aliases. `TOperatorConfigMap` is the type used on
 * `TFilterConfig.supportedOperatorConfigsMap` to declare which operators apply to
 * each filter property and what config payload each operator expects.
 */

import type { EQUALITY_OPERATOR, COLLECTION_OPERATOR, COMPARISON_OPERATOR } from "../operators";
import type { TCoreExactOperatorConfigs, TCoreInOperatorConfigs, TCoreRangeOperatorConfigs } from "./core";
import type {
  TExtendedExactOperatorConfigs,
  TExtendedInOperatorConfigs,
  TExtendedOperatorSpecificConfigs,
  TExtendedRangeOperatorConfigs,
} from "./extended";

// ----------------------------- Composed Operator Configs -----------------------------

/**
 * Public union of core + extended `EXACT`-compatible config shapes; currently equals the core union since extended is `never`.
 */
export type TExactOperatorConfigs = TCoreExactOperatorConfigs | TExtendedExactOperatorConfigs;

/**
 * Public union of core + extended `IN`-compatible config shapes; currently equals the core union.
 */
export type TInOperatorConfigs = TCoreInOperatorConfigs | TExtendedInOperatorConfigs;

/**
 * Public union of core + extended `RANGE`-compatible config shapes; currently equals the core union.
 */
export type TRangeOperatorConfigs = TCoreRangeOperatorConfigs | TExtendedRangeOperatorConfigs;

// ----------------------------- Final Operator Specific Configs -----------------------------

/**
 * Mapped type keying each public operator literal to its admissible config-shape union — composed of core + extended via the unions above.
 */
export type TOperatorSpecificConfigs = {
  [EQUALITY_OPERATOR.EXACT]: TExactOperatorConfigs;
  [COLLECTION_OPERATOR.IN]: TInOperatorConfigs;
  [COMPARISON_OPERATOR.RANGE]: TRangeOperatorConfigs;
} & TExtendedOperatorSpecificConfigs;

/**
 * Runtime-shaped `Map<operatorKey, configUnion>` exposed on `TFilterConfig.supportedOperatorConfigsMap`.
 * Map (not Record) because consumer code iterates with insertion-order semantics and uses `.get()`/`.set()` from `@plane/utils` filter builders.
 */
export type TOperatorConfigMap = Map<
  keyof TOperatorSpecificConfigs,
  TOperatorSpecificConfigs[keyof TOperatorSpecificConfigs]
>;

// -------- RE-EXPORTS --------

export * from "./core";
export * from "./extended";
