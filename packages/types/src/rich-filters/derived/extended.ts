/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extension-tier operator-union placeholders reserved for future operator
 * families; all aliases currently resolve to `never` so they contribute no
 * members when unioned into the public types in `./index.ts`.
 */

import type { TFilterValue } from "../expression";

// -------- DATE FILTER OPERATORS --------

/**
 * Reserved widening point for additional date-filter operators; widen this
 * alias to introduce new operators without touching `./index.ts` consumers.
 */
export type TExtendedSupportedDateFilterOperators<_V extends TFilterValue = TFilterValue> = never;

/**
 * Reserved display-tier widening point for additional date-filter operators;
 * widen alongside `TExtendedSupportedDateFilterOperators`.
 */
export type TExtendedAllAvailableDateFilterOperatorsForDisplay<_V extends TFilterValue = TFilterValue> = never;

// -------- SELECT FILTER OPERATORS --------

/**
 * Reserved widening point for additional select-filter operators; widen this
 * alias to introduce new operators without touching `./index.ts` consumers.
 */
export type TExtendedSupportedSelectFilterOperators<_V extends TFilterValue = TFilterValue> = never;

/**
 * Reserved display-tier widening point for additional select-filter operators;
 * widen alongside `TExtendedSupportedSelectFilterOperators`.
 */
export type TExtendedAllAvailableSelectFilterOperatorsForDisplay<_V extends TFilterValue = TFilterValue> = never;
