/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel merging the core + extended field-type registries into `FILTER_FIELD_TYPE`
 * and `TFilterFieldType`, and unioning their configs into `TSupportedFilterFieldConfigs<V>`.
 */

import type { TFilterValue } from "../expression";
import type { TCoreFilterFieldConfigs } from "./core";
import { CORE_FILTER_FIELD_TYPE } from "./core";
import type { TExtendedFilterFieldConfigs } from "./extended";
import { EXTENDED_FILTER_FIELD_TYPE } from "./extended";

// -------- COMPOSED FILTER TYPES --------

/**
 * Composed runtime registry of all field-type discriminant tokens — spread of core +
 * extended registries; `as const` so its values stay synchronized with `TFilterFieldType`.
 * Per-value JSDoc is intentionally omitted here because the registry is composed via
 * object spread; consumers see per-value JSDoc on `CORE_FILTER_FIELD_TYPE` in `./core.ts`.
 */
export const FILTER_FIELD_TYPE = {
  ...CORE_FILTER_FIELD_TYPE,
  ...EXTENDED_FILTER_FIELD_TYPE,
} as const;

/**
 * Union of all field-type token literals derived from `FILTER_FIELD_TYPE`'s values;
 * used as a runtime discriminant by consumers that route per field type.
 */
export type TFilterFieldType = (typeof FILTER_FIELD_TYPE)[keyof typeof FILTER_FIELD_TYPE];

// -------- COMPOSED CONFIGURATIONS --------

/**
 * Discriminated union of all core + extended field configurations; the consumer's
 * primary type for working generically with any field type. Defaults `V` to `TFilterValue`.
 *
 * @template V - Filter value type bound by `TFilterValue`; defaults to `TFilterValue`.
 */
export type TSupportedFilterFieldConfigs<V extends TFilterValue = TFilterValue> =
  | TCoreFilterFieldConfigs<V>
  | TExtendedFilterFieldConfigs<V>;

// -------- RE-EXPORTS --------

export * from "./shared";
export * from "./core";
export * from "./extended";
