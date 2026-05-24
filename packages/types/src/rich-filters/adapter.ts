/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Filter adapter contracts for the `@plane/types/rich-filters` subfolder.
 *
 * Defines the serialize/deserialize boundary between the in-memory `TFilterExpression`
 * tree and the wire formats — the legacy unstructured filter blob (in `IIssueFilterOptions`)
 * and the rich-filter JSON shape persisted by saved views, cycles, modules, and workspace
 * views. Every save/load boundary in the filter pipeline goes through an `IFilterAdapter`
 * implementation.
 *
 * Consumers: `packages/shared-state/src/store/work-item-filters/adapter.ts`,
 *            `apps/web/core/components/work-item-filters/`.
 */

// local imports
import type { TFilterExpression, TFilterProperty } from "./expression";

/**
 * Permissive wire-format shape that every adapter must accept on input and produce on output.
 *
 * Fields with non-obvious semantics:
 * - `Record<string, unknown>`: the populated/legacy filter blob (e.g., `IIssueFilterOptions`).
 * - `undefined`: no filter has been configured (initial state).
 * - `null`: filter is explicitly cleared (distinct from never-set).
 */
export type TExternalFilter = Record<string, unknown> | undefined | null;

/**
 * Bidirectional contract for converting between the internal `TFilterExpression<P>` tree
 * and an external (wire-format) representation `E`. Implementations are the single
 * point of round-trip serialization for the rich-filter system; both methods must be
 * inverses on the subset of filters representable in `E`.
 *
 * @template P - Filter property key type (e.g., `EWorkItemFilterProperty` — the union of
 *   `state_id`, `priority`, `assignee_ids`, etc. accepted by the consumer's filter surface).
 * @template E - External (wire) filter format — extends `TExternalFilter`; concrete adapters
 *   tighten this to e.g., `IIssueFilterOptions` for work-item adapters or automation filter
 *   JSON for automation adapters.
 */
export interface IFilterAdapter<P extends TFilterProperty, E extends TExternalFilter> {
  /**
   * Decode the external wire format into an internal expression tree.
   * Returns `null` when the external input has no representable filter
   * (e.g., the external input is empty or `null`).
   */
  toInternal(externalFilter: E): TFilterExpression<P> | null;
  /**
   * Encode the internal expression tree back into the external wire format.
   * Accepts `null` to represent an explicit "clear all filters" state.
   */
  toExternal(internalFilter: TFilterExpression<P> | null): E;
}
