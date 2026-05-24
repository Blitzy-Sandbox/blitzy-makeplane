/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended operator-union placeholders for the `@plane/types/rich-filters/derived` subfolder.
 *
 * Reserved extension surface for future operator families. All aliases currently resolve
 * to `never`, so they contribute no members when unioned into the public types in
 * `./index.ts`. Defined here so future operator-config additions can plug in without
 * touching the barrel signatures.
 */

import type { TFilterValue } from "../expression";

// -------- DATE FILTER OPERATORS --------

/**
 * Reserved extension-tier union for additional date-filter operators. Currently `never`;
 * widen this in a follow-up patch to introduce new date operators without touching
 * consumers of `TSupportedDateFilterOperators` in `./index.ts`.
 *
 * @template _V - Filter value type — preserved for future symmetry with the core derivation;
 *   underscore-prefix signals the parameter is intentionally unused in the current `never` body.
 */
export type TExtendedSupportedDateFilterOperators<_V extends TFilterValue = TFilterValue> = never;

/**
 * Reserved extension-tier display-alias for additional date-filter operators. Currently `never`;
 * widen alongside `TExtendedSupportedDateFilterOperators` when introducing new display-tier date operators.
 *
 * @template _V - Filter value type — preserved for future symmetry with the core derivation;
 *   underscore-prefix signals the parameter is intentionally unused in the current `never` body.
 */
export type TExtendedAllAvailableDateFilterOperatorsForDisplay<_V extends TFilterValue = TFilterValue> = never;

// -------- SELECT FILTER OPERATORS --------

/**
 * Reserved extension-tier union for additional select-filter operators. Currently `never`;
 * widen this in a follow-up patch to introduce new select operators without touching
 * consumers of `TSupportedSelectFilterOperators` in `./index.ts`.
 *
 * @template _V - Filter value type — preserved for future symmetry with the core derivation;
 *   underscore-prefix signals the parameter is intentionally unused in the current `never` body.
 */
export type TExtendedSupportedSelectFilterOperators<_V extends TFilterValue = TFilterValue> = never;

/**
 * Reserved extension-tier display-alias for additional select-filter operators. Currently `never`;
 * widen alongside `TExtendedSupportedSelectFilterOperators` when introducing new display-tier select operators.
 *
 * @template _V - Filter value type — preserved for future symmetry with the core derivation;
 *   underscore-prefix signals the parameter is intentionally unused in the current `never` body.
 */
export type TExtendedAllAvailableSelectFilterOperatorsForDisplay<_V extends TFilterValue = TFilterValue> = never;
