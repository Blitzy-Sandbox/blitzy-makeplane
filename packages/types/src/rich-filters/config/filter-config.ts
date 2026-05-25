/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-property filter configuration consumed by the rich-filter UI to render
 * each chip (label, operators, value input, icons, tooltips); concrete configs
 * live in `packages/utils/src/work-item-filters/configs/filters/`.
 */

import type { TFilterProperty } from "../expression";
import type { TOperatorConfigMap } from "../operator-configs";

/**
 * Pairs a filter property `P` with its UI metadata and the operator-configs
 * applicable to it. Non-obvious semantics: `id` matches `TFilterConditionNode.property`;
 * `isEnabled=false` hides the property from the add-filter dropdown but preserves
 * existing conditions; `allowMultipleFilters=true` permits multiple condition
 * nodes per property in the same tree (e.g. disjoint date ranges).
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
