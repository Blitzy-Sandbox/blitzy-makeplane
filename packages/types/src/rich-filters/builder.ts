/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Filter builder contracts for the `@plane/types/rich-filters` subfolder.
 *
 * Defines the type-safe parameters returned from `createFilterBuilder()` — a fluent API
 * for constructing `TFilterExpression` trees programmatically from a flat list of conditions,
 * used in defaults, tests, and any path that must materialize a rich filter from scalar inputs
 * rather than UI interactions.
 *
 * Consumers: `packages/shared-state/src/store/work-item-filters/`,
 *            `packages/utils/src/work-item-filters/configs/filters/`.
 */

import type { SingleOrArray } from "../utils";
import type { IFilterAdapter, TExternalFilter } from "./adapter";
import type { TFilterProperty, TFilterValue } from "./expression";
import type { TAllAvailableOperatorsForDisplay } from "./operators";

/**
 * Flat condition payload supplied as input to the filter builder — describes a single
 * (property, operator, value) triple that the builder converts into a
 * `TFilterConditionNode<P, V>` leaf during expression-tree construction.
 *
 * Fields with non-obvious semantics:
 * - `operator`: `TAllAvailableOperatorsForDisplay` — uses the display-tier operator union
 *   (which currently aliases `TSupportedOperators`); the builder normalizes it onto
 *   the canonical `TSupportedOperators` union before emitting the leaf.
 * - `value`: `SingleOrArray<V>` — single scalar OR array; array is required for
 *   multi-value operators (`IN`, `RANGE`).
 *
 * @template P - Filter property key type, e.g., `EWorkItemFilterProperty`.
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 */
export type TFilterConditionForBuild<P extends TFilterProperty, V extends TFilterValue> = {
  property: P;
  operator: TAllAvailableOperatorsForDisplay;
  value: SingleOrArray<V>;
};

/**
 * Aggregate input passed to the filter builder — the flat list of conditions to fold
 * into the expression tree plus the adapter that knows how to round-trip the result
 * into the consumer's external wire format (legacy `IIssueFilterOptions` blob, automation
 * filter JSON, etc.).
 *
 * @template P - Filter property key type, e.g., `EWorkItemFilterProperty`.
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
 * @template E - External (wire) filter format — extends `TExternalFilter`; threads through
 *   the `adapter` field so the builder is parameterized on the same target serialization
 *   shape as the adapter consumes.
 */
export type TBuildFilterExpressionParams<
  P extends TFilterProperty,
  V extends TFilterValue,
  E extends TExternalFilter,
> = {
  conditions: TFilterConditionForBuild<P, V>[];
  adapter: IFilterAdapter<P, E>;
};
