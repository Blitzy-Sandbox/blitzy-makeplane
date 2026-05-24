/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Filter configuration contract for the `@plane/types/rich-filters/config` subfolder.
 *
 * Defines the per-property metadata shape consumed by the rich filter UI to render
 * each filter chip (property label, supported operators, value input, icons, tooltips).
 * A `TFilterConfig<P>` instance is the single source of truth for what a given filter
 * property can do and how it presents itself.
 *
 * Consumers: `packages/utils/src/work-item-filters/configs/filters/` (concrete configs
 *            per property — state, priority, assignee, etc.) and
 *            `apps/web/core/components/rich-filters/` (renders the UI from these configs).
 */

import type { TFilterProperty } from "../expression";
import type { TOperatorConfigMap } from "../operator-configs";

/**
 * Per-property filter configuration — pairs a filter property `P` with its UI metadata
 * and the operator-configs that may be applied to it.
 *
 * Fields with non-obvious semantics:
 * - `id`: the property identifier (e.g., `"state_id"`); shared with `TFilterConditionNode.property`.
 * - `isEnabled`: when `false`, the property is hidden from the add-filter dropdown but
 *   existing conditions on it remain in the expression tree (do not silently drop user data).
 * - `supportedOperatorConfigsMap`: subset of the canonical `TOperatorConfigMap` keyed by
 *   the operators that apply to this property's value type.
 * - `icon`: SVG component rendered as the property icon in the filter chip and dropdown.
 * - `allowMultipleFilters`: when `true`, the property may appear in more than one
 *   condition node within the same expression tree (e.g., multiple disjoint date ranges);
 *   when `false` (default), only one condition per property is allowed.
 * - `rightContent`: React node rendered on the right side of the filter option in the
 *   add-filter dropdown (typically a hint badge).
 * - `tooltipContent`: React node shown when hovering over an already-applied filter chip.
 *
 * @template P - Filter property key type — typically a concrete enum union like
 *   `EWorkItemFilterProperty` rather than the open `TFilterProperty` (= `string`) base.
 */
export type TFilterConfig<P extends TFilterProperty> = {
  id: P;
  label: string;
  icon?: React.FC<React.SVGAttributes<SVGElement>>;
  isEnabled: boolean;
  allowMultipleFilters?: boolean;
  supportedOperatorConfigsMap: TOperatorConfigMap;
  rightContent?: React.ReactNode; // content to display on the right side of the filter option in the dropdown
  tooltipContent?: React.ReactNode; // content to display when hovering over the applied filter item in the filter list
};
