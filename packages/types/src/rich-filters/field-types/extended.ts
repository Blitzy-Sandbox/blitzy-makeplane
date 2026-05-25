/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended filter-field-type placeholders for the `@plane/types/rich-filters/field-types` subfolder.
 *
 * Reserved extension surface. `EXTENDED_FILTER_FIELD_TYPE` is an empty const-asserted
 * registry and `TExtendedFilterFieldConfigs<_V>` resolves to `never` — the file exists
 * so future extended field types can be added without touching the public registry
 * composition in `./index.ts`.
 */

import type { TFilterValue } from "../expression";

/**
 * Reserved extension registry for additional field-type discriminant tokens;
 * the empty `as const` literal merges safely into `FILTER_FIELD_TYPE`.
 */
export const EXTENDED_FILTER_FIELD_TYPE = {} as const;

// -------- UNION TYPES --------

/**
 * Reserved widening point for additional field-type configurations; currently `never`.
 */
export type TExtendedFilterFieldConfigs<_V extends TFilterValue = TFilterValue> = never;
