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
 * Reserved extension registry for additional field-type discriminant tokens. Currently empty.
 * The empty `as const` literal is type-safe to merge into `FILTER_FIELD_TYPE` in `./index.ts`
 * even when no extended members exist.
 */
export const EXTENDED_FILTER_FIELD_TYPE = {} as const;

// -------- UNION TYPES --------

/**
 * Reserved extension union for additional field-type configurations. Currently `never`.
 *
 * @template _V - Reserved for parity with the core generic; intentionally unused in the
 *   current `never` body (the underscore-prefix signals this).
 */
export type TExtendedFilterFieldConfigs<_V extends TFilterValue = TFilterValue> = never;
