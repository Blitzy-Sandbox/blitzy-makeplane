/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core filter field-type registry and typed configuration aliases for the
 * `@plane/types/rich-filters/field-types` subfolder.
 *
 * `CORE_FILTER_FIELD_TYPE` declares the runtime discriminant tokens (`"date"`, `"date_range"`,
 * `"single_select"`, `"multi_select"`); each concrete `T*FilterFieldConfig<V>` alias is the
 * typed payload shape paired with one of those tokens in the operator-config and
 * filter-config layers.
 */

import type { TFilterValue } from "../expression";
import type { TSupportedOperators } from "../operators";
import type { TBaseFilterFieldConfig, IFilterOption } from "./shared";

/**
 * Runtime registry of core field-type discriminant tokens. Each value pairs with a
 * `T*FilterFieldConfig<V>` alias defined below; `as const` ensures the value literals
 * stay synchronized with the `TFilterFieldType` union derived in `./index.ts`.
 */
export const CORE_FILTER_FIELD_TYPE = {
  /** Single-date filter — payload is `TDateFilterFieldConfig<V>` with one `Date` value. */
  DATE: "date",
  /** Two-date interval filter — payload is `TDateRangeFilterFieldConfig<V>` with `[start, end]`. */
  DATE_RANGE: "date_range",
  /** Enumerated single-choice filter — payload is `TSingleSelectFilterFieldConfig<V>`. */
  SINGLE_SELECT: "single_select",
  /** Enumerated multi-choice filter — payload is `TMultiSelectFilterFieldConfig<V>`. */
  MULTI_SELECT: "multi_select",
} as const;

// -------- DATE FILTER CONFIGURATIONS --------

/**
 * Shared date config primitive — optional `min`/`max` `Date` bounds that constrain the
 * date picker's selectable range. (Not generic; date bounds are always `Date`.)
 */
type TBaseDateFilterFieldConfig = TBaseFilterFieldConfig & {
  min?: Date;
  max?: Date;
};

/**
 * Single-date field config. Fields with non-obvious semantics: `defaultValue` is the
 * prefilled date when the filter is added (no behavior change if undefined).
 *
 * @template V - Filter value type bound by `TFilterValue`.
 */
export type TDateFilterFieldConfig<V extends TFilterValue> = TBaseDateFilterFieldConfig & {
  type: typeof CORE_FILTER_FIELD_TYPE.DATE;
  defaultValue?: V;
};

/**
 * Date-range field config. Fields with non-obvious semantics: `defaultValue` is a
 * `[start, end]` array; array order matters.
 *
 * @template V - Filter value type bound by `TFilterValue`.
 */
export type TDateRangeFilterFieldConfig<V extends TFilterValue> = TBaseDateFilterFieldConfig & {
  type: typeof CORE_FILTER_FIELD_TYPE.DATE_RANGE;
  defaultValue?: V[];
};

// -------- SELECT FILTER CONFIGURATIONS --------

/**
 * Single-select field config. Fields with non-obvious semantics: `getOptions` may be
 * sync (returns array) or async (returns Promise); the UI shows a loader during the
 * async case.
 *
 * @template V - Filter value type bound by `TFilterValue`.
 */
export type TSingleSelectFilterFieldConfig<V extends TFilterValue> = TBaseFilterFieldConfig & {
  type: typeof CORE_FILTER_FIELD_TYPE.SINGLE_SELECT;
  defaultValue?: V;
  getOptions: IFilterOption<V>[] | (() => IFilterOption<V>[] | Promise<IFilterOption<V>[]>);
};

/**
 * Multi-select field config. Fields with non-obvious semantics: `singleValueOperator`
 * (when set) emits a single condition node carrying an array value instead of multiple
 * condition nodes; affects expression-tree topology.
 *
 * @template V - Filter value type bound by `TFilterValue`.
 */
export type TMultiSelectFilterFieldConfig<V extends TFilterValue> = TBaseFilterFieldConfig & {
  type: typeof CORE_FILTER_FIELD_TYPE.MULTI_SELECT;
  defaultValue?: V[];
  getOptions: IFilterOption<V>[] | (() => IFilterOption<V>[] | Promise<IFilterOption<V>[]>);
  singleValueOperator: TSupportedOperators;
};

// -------- UNION TYPES --------

/**
 * Discriminated union of all core field configs; the consumer discriminates on the
 * paired `CORE_FILTER_FIELD_TYPE` token.
 *
 * @template V - Filter value type bound by `TFilterValue`; defaults to `TFilterValue`.
 */
export type TCoreFilterFieldConfigs<V extends TFilterValue = TFilterValue> =
  | TDateFilterFieldConfig<V>
  | TDateRangeFilterFieldConfig<V>
  | TSingleSelectFilterFieldConfig<V>
  | TMultiSelectFilterFieldConfig<V>;
