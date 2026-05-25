/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-field-type operator subsets derived by intersecting `TOperatorSpecificConfigs`
 * with each concrete field-type config; the aggregated `TCore*FilterOperators`
 * unions are the canonical "operators allowed for this field" sets.
 */

import type { TFilterValue } from "../expression";
import type {
  TDateFilterFieldConfig,
  TDateRangeFilterFieldConfig,
  TSingleSelectFilterFieldConfig,
  TMultiSelectFilterFieldConfig,
} from "../field-types";
import type { TCoreOperatorSpecificConfigs } from "../operator-configs";
import type { TFilterOperatorHelper } from "./shared";

// -------- DATE FILTER OPERATORS --------

/**
 * Single-date field operator union — operators whose payload accepts `TDateFilterFieldConfig<V>`.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedSingleDateFilterOperators<V extends TFilterValue = TFilterValue> = {
  [K in keyof TCoreOperatorSpecificConfigs]: TFilterOperatorHelper<
    TCoreOperatorSpecificConfigs,
    K,
    TDateFilterFieldConfig<V>
  >;
}[keyof TCoreOperatorSpecificConfigs];

/**
 * Date-range field operator union — operators whose payload accepts `TDateRangeFilterFieldConfig<V>`.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedRangeDateFilterOperators<V extends TFilterValue = TFilterValue> = {
  [K in keyof TCoreOperatorSpecificConfigs]: TFilterOperatorHelper<
    TCoreOperatorSpecificConfigs,
    K,
    TDateRangeFilterFieldConfig<V>
  >;
}[keyof TCoreOperatorSpecificConfigs];

/**
 * Union of single-date and range-date operators — used wherever a field is generically a date filter.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedDateFilterOperators<V extends TFilterValue = TFilterValue> =
  | TCoreSupportedSingleDateFilterOperators<V>
  | TCoreSupportedRangeDateFilterOperators<V>;

/**
 * Display-tier alias of `TCoreSupportedDateFilterOperators<V>`; reserved for the UI to surface negated/composite operator forms.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreAllAvailableDateFilterOperatorsForDisplay<V extends TFilterValue = TFilterValue> =
  TCoreSupportedDateFilterOperators<V>;

// -------- SELECT FILTER OPERATORS --------

/**
 * Single-select field operator union — operators whose payload accepts `TSingleSelectFilterFieldConfig<V>`.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedSingleSelectFilterOperators<V extends TFilterValue = TFilterValue> = {
  [K in keyof TCoreOperatorSpecificConfigs]: TFilterOperatorHelper<
    TCoreOperatorSpecificConfigs,
    K,
    TSingleSelectFilterFieldConfig<V>
  >;
}[keyof TCoreOperatorSpecificConfigs];

/**
 * Multi-select field operator union — operators whose payload accepts `TMultiSelectFilterFieldConfig<V>`.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedMultiSelectFilterOperators<V extends TFilterValue = TFilterValue> = {
  [K in keyof TCoreOperatorSpecificConfigs]: TFilterOperatorHelper<
    TCoreOperatorSpecificConfigs,
    K,
    TMultiSelectFilterFieldConfig<V>
  >;
}[keyof TCoreOperatorSpecificConfigs];

/**
 * Union of single-select and multi-select operators.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreSupportedSelectFilterOperators<V extends TFilterValue = TFilterValue> =
  | TCoreSupportedSingleSelectFilterOperators<V>
  | TCoreSupportedMultiSelectFilterOperators<V>;

/**
 * Display-tier alias of `TCoreSupportedSelectFilterOperators<V>`.
 *
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TCoreAllAvailableSelectFilterOperatorsForDisplay<V extends TFilterValue = TFilterValue> =
  TCoreSupportedSelectFilterOperators<V>;
