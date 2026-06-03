/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel composing core-tier and extended-tier per-field-type operator unions
 * into the public derived API consumed by `packages/utils/src/work-item-filters/configs/filters/`
 * and `apps/web/core/components/rich-filters/`.
 */

import type { TFilterValue } from "../expression";
import type {
  TCoreAllAvailableDateFilterOperatorsForDisplay,
  TCoreAllAvailableSelectFilterOperatorsForDisplay,
  TCoreSupportedDateFilterOperators,
  TCoreSupportedSelectFilterOperators,
} from "./core";
import type {
  TExtendedAllAvailableDateFilterOperatorsForDisplay,
  TExtendedAllAvailableSelectFilterOperatorsForDisplay,
  TExtendedSupportedDateFilterOperators,
  TExtendedSupportedSelectFilterOperators,
} from "./extended";

// -------- COMPOSED SUPPORT TYPES --------

/**
 * Public per-value operator union for date-shaped filter fields — unions core + extended date operators.
 *
 * @template V - Filter value type — defaults to `TFilterValue`; allows consumers to specialize when narrower value types are appropriate.
 */
export type TSupportedDateFilterOperators<V extends TFilterValue = TFilterValue> =
  | TCoreSupportedDateFilterOperators<V>
  | TExtendedSupportedDateFilterOperators<V>;

/**
 * Display-tier alias of `TSupportedDateFilterOperators<V>`.
 *
 * @template V - Filter value type — defaults to `TFilterValue`; allows consumers to specialize when narrower value types are appropriate.
 */
export type TAllAvailableDateFilterOperatorsForDisplay<V extends TFilterValue = TFilterValue> =
  | TCoreAllAvailableDateFilterOperatorsForDisplay<V>
  | TExtendedAllAvailableDateFilterOperatorsForDisplay<V>;

/**
 * Public per-value operator union for select-shaped filter fields — unions core + extended select operators.
 *
 * @template V - Filter value type — defaults to `TFilterValue`; allows consumers to specialize when narrower value types are appropriate.
 */
export type TSupportedSelectFilterOperators<V extends TFilterValue = TFilterValue> =
  | TCoreSupportedSelectFilterOperators<V>
  | TExtendedSupportedSelectFilterOperators<V>;

/**
 * Display-tier alias of `TSupportedSelectFilterOperators<V>`.
 *
 * @template V - Filter value type — defaults to `TFilterValue`; allows consumers to specialize when narrower value types are appropriate.
 */
export type TAllAvailableSelectFilterOperatorsForDisplay<V extends TFilterValue = TFilterValue> =
  | TCoreAllAvailableSelectFilterOperatorsForDisplay<V>
  | TExtendedAllAvailableSelectFilterOperatorsForDisplay<V>;

// -------- RE-EXPORTS --------

export * from "./shared";
export * from "./core";
export * from "./extended";
