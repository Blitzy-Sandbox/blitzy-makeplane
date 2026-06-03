/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared filter-field primitives for the `@plane/types/rich-filters/field-types` subfolder.
 *
 * Provides building-block types reused across the core and extended field-type configs —
 * the negative-operator opt-in/label pair, the base operator-enable/label config, and the
 * generic `IFilterOption<V>` select-option record consumed by select-shape configs.
 */

import type { TFilterValue } from "../expression";

/**
 * Per-field opt-in for negative operator forms (e.g., "is not"). When `allowNegative` is
 * `false` (or omitted), the UI hides the negated form regardless of the operator-config map;
 * when `true`, `negOperatorLabel` optionally overrides the default negated-label text.
 */
export type TNegativeOperatorConfig = { allowNegative: true; negOperatorLabel?: string } | { allowNegative?: false };

/**
 * Shared operator metadata mixed into every concrete field-type config —
 * `isOperatorEnabled` toggles the operator chip in the UI, `operatorLabel` overrides
 * the default label rendered in the chip. Intersected with `TNegativeOperatorConfig`
 * so concrete configs inherit the negative-operator opt-in.
 */
export type TBaseFilterFieldConfig = {
  isOperatorEnabled?: boolean;
  operatorLabel?: string;
} & TNegativeOperatorConfig;

/**
 * Typed select-option record. Fields with non-obvious semantics:
 *   - `id`: stable React key, distinct from `value` (the value participates in filtering,
 *     the id is purely a UI list-key);
 *   - `iconClassName`: Tailwind-style class applied to the rendered icon;
 *   - `disabled`: renders the option but blocks selection.
 *
 * @template V - Option value type; constrained to `TFilterValue`-compatible primitives.
 */
export interface IFilterOption<V extends TFilterValue> {
  id: string;
  label: string;
  value: V;
  icon?: React.ReactNode;
  iconClassName?: string;
  disabled?: boolean;
  description?: string;
}
