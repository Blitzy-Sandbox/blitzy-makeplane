/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Filter expression tree contracts for the `@plane/types/rich-filters` subfolder.
 *
 * **This is the core data structure of the rich filter system.** Defines `TFilterExpression`
 * — a tagged union of group nodes (with logical operator and children) and leaf condition
 * nodes (with property/operator/value triple) — that can represent arbitrarily nested
 * boolean filter trees.
 *
 * The discriminant is the `type` field on each node: `"condition"` for a leaf and
 * `"group"` for a logical aggregator. Group nodes carry a `logicalOperator` (currently
 * only `AND`) and a `children` array of nested expressions.
 *
 * Consumed by every filter store, the issue listing API request builder, and the rich
 * filter UI: `packages/shared-state/src/store/work-item-filters/`,
 * `packages/utils/src/work-item-filters/`,
 * `apps/web/core/components/rich-filters/`.
 */

// local imports
import type { SingleOrArray } from "../utils";
import type { TSupportedOperators, LOGICAL_OPERATOR, TAllAvailableOperatorsForDisplay } from "./operators";

/**
 * Tagged-union discriminant registry for filter tree nodes.
 *
 * - `CONDITION`: leaf node carrying a single property/operator/value triple (e.g., "state is backlog").
 * - `GROUP`: container combining multiple child nodes via a logical operator (currently AND only).
 *
 * Consumed by the `type` discriminant field on every `TFilterExpression`. Runtime tokens are
 * `as const`-frozen so the value-level constants and the `TFilterNodeType` union stay in sync.
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
 * Allowed filter values — primitives plus `null` / `undefined` for empty / not-set states.
 *
 * Fields with non-obvious semantics:
 * - `null`: explicit "is empty" comparand (e.g., assignee IS null).
 * - `undefined`: the slot was never set (treated as "no value" by adapters; serializes to absence).
 * - `Date`: persisted as an ISO 8601 string by adapters but typed here as a `Date` for in-memory use.
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
 * Leaf filter node — a single (property, operator, value) predicate, e.g., "state is backlog"
 * or "due_date between [2024-01-01, 2024-12-31]".
 *
 * Fields with non-obvious semantics:
 * - `type`: literal `"condition"` discriminant — must match `FILTER_NODE_TYPE.CONDITION`.
 * - `operator`: from the canonical `TSupportedOperators` union (NOT the looser display tier).
 * - `value`: `SingleOrArray<V>` — single scalar for `EXACT`, array for `IN` and `RANGE`.
 *
 * @template P - Filter property key type (e.g., `EWorkItemFilterProperty`).
 * @template V - Filter value type — must be a `TFilterValue`-compatible primitive.
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
 * Aggregator node combining multiple child expressions via the AND logical operator.
 *
 * Fields with non-obvious semantics:
 * - `type`: literal `"group"` discriminant — must match `FILTER_NODE_TYPE.GROUP`.
 * - `logicalOperator`: pinned to `LOGICAL_OPERATOR.AND` for the current operator set;
 *   OR/NOT variants are reserved by the operator registry but not yet emitted as group nodes.
 * - `children`: recursive — each child is itself a `TFilterExpression<P>` (condition or group).
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
 * Recursive discriminated union of filter tree nodes — every node in a rich filter is
 * either a leaf condition (`TFilterConditionNode`) or a group of nested expressions
 * (`TFilterGroupNode`). Discriminated by the literal `type` field on each node.
 *
 * Narrowing example:
 * ```ts
 * if (expr.type === FILTER_NODE_TYPE.CONDITION) {
 *   // expr is narrowed to TFilterConditionNode<P, V>
 * } else {
 *   // expr is narrowed to TFilterGroupNode<P>
 * }
 * ```
 *
 * @template P - Filter property key type.
 * @template V - Filter value type — defaults to `TFilterValue` when the consumer does
 *   not specialize, allowing the union to be referenced without explicit value typing.
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
