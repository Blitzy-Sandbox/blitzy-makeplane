/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core rich-filter expression tree (`TFilterExpression`) — a tagged union of leaf condition nodes (property/operator/value triple) and group nodes (logical operator + children), discriminated by the literal `type` field.
 * Consumed by `packages/shared-state/src/store/work-item-filters/`, `packages/utils/src/work-item-filters/`, and `apps/web/core/components/rich-filters/`.
 */

// local imports
import type { SingleOrArray } from "../utils";
import type { TSupportedOperators, LOGICAL_OPERATOR, TAllAvailableOperatorsForDisplay } from "./operators";

/**
 * `as const`-frozen discriminant registry mapping filter-node kinds to their literal `type` tokens (`CONDITION` = `"condition"` leaf, `GROUP` = `"group"` aggregator); paired with `TFilterNodeType` so value and type stay in sync.
 */
export const FILTER_NODE_TYPE = {
  /** Leaf node — a single (property, operator, value) filter predicate. */
  CONDITION: "condition",
  /** Aggregator node — combines child expressions with a logical operator (AND). */
  GROUP: "group",
} as const;
/**
 * Union of the runtime `FILTER_NODE_TYPE` token values: `"condition" | "group"`.
 * Used as the discriminant on `TFilterExpression`.
 */
export type TFilterNodeType = (typeof FILTER_NODE_TYPE)[keyof typeof FILTER_NODE_TYPE];

/**
 * Field property key that can be filtered (e.g., "state_id", "assignee_ids", "created_at").
 * Consumers narrow this to a concrete enum like `EWorkItemFilterProperty` from
 * `@plane/constants` when instantiating the generic types in this file.
 */
export type TFilterProperty = string;

/**
 * Allowed filter value primitives plus `null` (explicit "is empty" comparand) / `undefined` (never set — serialized to absence by adapters); `Date` is in-memory only and adapters persist it as an ISO 8601 string.
 */
export type TFilterValue = string | number | Date | boolean | null | undefined;

/**
 * Shared structural fields for every filter tree node.
 *
 * Fields with non-obvious semantics:
 * - `id`: client-generated UUID used as the React/MobX reactivity key; NOT persisted by
 *   adapters (regenerated on hydration).
 */
type TBaseFilterNode = {
  id: string;
  type: TFilterNodeType;
};

/**
 * Leaf filter node carrying a single `(property, operator, value)` predicate; `operator` is the canonical `TSupportedOperators` (not the looser display tier) and `value` is `SingleOrArray<V>` — scalar for `EXACT`, array for `IN`/`RANGE`.
 *
 * @template P - Filter property key type (e.g., `EWorkItemFilterProperty`).
 * @template V - Filter value type; must be a `TFilterValue`-compatible primitive.
 */
export type TFilterConditionNode<P extends TFilterProperty, V extends TFilterValue> = TBaseFilterNode & {
  type: typeof FILTER_NODE_TYPE.CONDITION;
  property: P;
  operator: TSupportedOperators;
  value: SingleOrArray<V>;
};

/**
 * Display-tier variant of `TFilterConditionNode` — widens the `operator` field to
 * `TAllAvailableOperatorsForDisplay`, which currently aliases `TSupportedOperators`
 * but is reserved for the UI to surface negated/composite operator forms that are
 * subsequently normalized onto canonical `TSupportedOperators` for persistence.
 *
 * @template P - Filter property key type.
 * @template V - Filter value type.
 */
export type TFilterConditionNodeForDisplay<P extends TFilterProperty, V extends TFilterValue> = Omit<
  TFilterConditionNode<P, V>,
  "operator"
> & {
  operator: TAllAvailableOperatorsForDisplay;
};

/**
 * Aggregator node combining children via AND; `logicalOperator` is currently pinned to `LOGICAL_OPERATOR.AND` (OR/NOT variants are reserved by the operator registry but not yet emitted), and `children` is recursive — each entry is itself a `TFilterExpression<P>`.
 *
 * @template P - Filter property key type.
 */
export type TFilterAndGroupNode<P extends TFilterProperty> = TBaseFilterNode & {
  type: typeof FILTER_NODE_TYPE.GROUP;
  logicalOperator: typeof LOGICAL_OPERATOR.AND;
  children: TFilterExpression<P>[];
};

/**
 * Union of all supported group-node shapes. Currently only the AND variant is realized;
 * the alias exists so future OR/NOT group nodes can be added to the union without
 * widening every consumer's narrow on `TFilterAndGroupNode`.
 *
 * @template P - Filter property key type.
 */
export type TFilterGroupNode<P extends TFilterProperty> = TFilterAndGroupNode<P>;

/**
 * Recursive discriminated union of filter tree nodes (leaf `TFilterConditionNode` or aggregator `TFilterGroupNode`), narrowed by the literal `type` discriminant (`FILTER_NODE_TYPE.CONDITION` vs `.GROUP`).
 *
 * @template P - Filter property key type.
 * @template V - Filter value type; defaults to `TFilterValue` so consumers can reference the union without explicit value typing.
 */
export type TFilterExpression<P extends TFilterProperty, V extends TFilterValue = TFilterValue> =
  | TFilterConditionNode<P, V>
  | TFilterGroupNode<P>;

/**
 * Pre-creation payload for a condition node — strips out `TBaseFilterNode` fields
 * (`id`, `type`) so the consumer supplies only the semantic triple, and the builder
 * fills in the discriminant + UUID.
 *
 * @template P - Filter property key type.
 * @template V - Filter value type.
 */
export type TFilterConditionPayload<P extends TFilterProperty, V extends TFilterValue> = Omit<
  TFilterConditionNode<P, V>,
  keyof TBaseFilterNode
>;

/**
 * Pre-creation payload for an AND group node — strips out `TBaseFilterNode` fields.
 *
 * @template P - Filter property key type.
 */
export type TFilterAndGroupPayload<P extends TFilterProperty> = Omit<TFilterAndGroupNode<P>, keyof TBaseFilterNode>;

/**
 * Pre-creation payload union for any group node — currently equivalent to
 * `TFilterAndGroupPayload<P>`, but kept as a separate alias so future OR/NOT
 * group payloads can extend the union without touching consumers.
 *
 * @template P - Filter property key type.
 */
export type TFilterGroupPayload<P extends TFilterProperty> = TFilterAndGroupPayload<P>;
