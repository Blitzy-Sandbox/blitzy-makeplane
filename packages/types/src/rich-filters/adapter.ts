/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Adapter contracts at the serialize/deserialize boundary between the in-memory
 * `TFilterExpression` tree and the persisted wire formats (legacy
 * `IIssueFilterOptions`, rich-filter JSON); consumed by
 * `packages/shared-state/src/store/work-item-filters/adapter.ts`.
 */

// local imports
import type { TFilterExpression, TFilterProperty } from "./expression";

/**
 * Permissive wire-format shape every adapter accepts and produces; `undefined`
 * means "never configured", `null` means "explicitly cleared".
 */
export type TExternalFilter = Record<string, unknown> | undefined | null;

/**
 * Bidirectional contract for round-tripping `TFilterExpression<P>` against an
 * external wire format `E`; implementations must be inverses on the subset of
 * filters representable in `E`.
 */
export interface IFilterAdapter<P extends TFilterProperty, E extends TExternalFilter> {
  /**
   * Decodes the external wire format into an internal expression tree, returning
   * `null` when the external input has no representable filter.
   */
  toInternal(externalFilter: E): TFilterExpression<P> | null;
  /**
   * Encodes the internal expression tree back into the external wire format;
   * accepts `null` to represent an explicit "clear all filters" state.
   */
  toExternal(internalFilter: TFilterExpression<P> | null): E;
}
