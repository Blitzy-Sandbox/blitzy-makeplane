/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Builder parameters for `createFilterBuilder()` — a fluent API that folds a flat
 * list of `(property, operator, value)` triples into a `TFilterExpression` tree
 * for defaults, tests, and any path materializing rich filters from scalar inputs.
 */

import type { SingleOrArray } from "../utils";
import type { IFilterAdapter, TExternalFilter } from "./adapter";
import type { TFilterProperty, TFilterValue } from "./expression";
import type { TAllAvailableOperatorsForDisplay } from "./operators";

/**
 * Flat `(property, operator, value)` condition the builder folds into a leaf
 * `TFilterConditionNode<P, V>`; the builder normalizes the display-tier operator
 * onto canonical `TSupportedOperators` and accepts `SingleOrArray<V>` for both
 * single-value and multi-value operators (`IN`, `RANGE`).
 */
export type TFilterConditionForBuild<P extends TFilterProperty, V extends TFilterValue> = {
  property: P;
  operator: TAllAvailableOperatorsForDisplay;
  value: SingleOrArray<V>;
};

/**
 * Aggregate builder input: the flat condition list to fold plus the `adapter`
 * that round-trips the resulting tree into the consumer's external wire format
 * (legacy `IIssueFilterOptions`, automation JSON, etc.).
 */
export type TBuildFilterExpressionParams<
  P extends TFilterProperty,
  V extends TFilterValue,
  E extends TExternalFilter,
> = {
  conditions: TFilterConditionForBuild<P, V>[];
  adapter: IFilterAdapter<P, E>;
};
