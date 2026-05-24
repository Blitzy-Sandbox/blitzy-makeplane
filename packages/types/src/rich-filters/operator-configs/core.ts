/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core operator-to-config-shape contract for the `@plane/types/rich-filters/operator-configs` subfolder.
 *
 * For each core operator (`EXACT`, `IN`, `RANGE`) declares which field-type configuration
 * shape is admissible as its payload. `TCoreOperatorSpecificConfigs` is the canonical
 * source of truth for "what config shape does this operator need", consumed by both the
 * derived operator unions (`../derived/`) and the runtime `TOperatorConfigMap` in `./index.ts`.
 */

import type { TFilterValue } from "../expression";
import type {
  TDateFilterFieldConfig,
  TDateRangeFilterFieldConfig,
  TSingleSelectFilterFieldConfig,
  TMultiSelectFilterFieldConfig,
} from "../field-types";
import type { CORE_COLLECTION_OPERATOR, CORE_COMPARISON_OPERATOR, CORE_EQUALITY_OPERATOR } from "../operators";

// ----------------------------- EXACT Operator -----------------------------
/**
 * Admissible config shapes for the `EXACT` equality operator — either a single-select payload (enumerated set selection) or a single-date payload (point-in-time match).
 */
export type TCoreExactOperatorConfigs =
  | TSingleSelectFilterFieldConfig<TFilterValue>
  | TDateFilterFieldConfig<TFilterValue>;

// ----------------------------- IN Operator -----------------------------
/**
 * Admissible config shape for the `IN` collection operator — multi-select payload (set-membership match).
 */
export type TCoreInOperatorConfigs = TMultiSelectFilterFieldConfig<TFilterValue>;

// ----------------------------- RANGE Operator -----------------------------
/**
 * Admissible config shape for the `RANGE` comparison operator — date-range payload (interval match).
 */
export type TCoreRangeOperatorConfigs = TDateRangeFilterFieldConfig<TFilterValue>;

// ----------------------------- Core Operator Specific Configs -----------------------------
/**
 * Mapped type keying each core operator literal (`exact`, `in`, `range`) to its admissible config-shape alias.
 * Used by `../derived/` to compute the per-field-type operator union.
 */
export type TCoreOperatorSpecificConfigs = {
  [CORE_EQUALITY_OPERATOR.EXACT]: TCoreExactOperatorConfigs;
  [CORE_COLLECTION_OPERATOR.IN]: TCoreInOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.RANGE]: TCoreRangeOperatorConfigs;
};
