/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared type-derivation helpers for the `@plane/types/rich-filters/derived` subfolder.
 *
 * This module provides the generic compatibility helper used by the core derivation
 * module to filter an operator-config map down to the subset of operator keys whose
 * config payload is bidirectionally assignable to a target filter field-type config.
 */

/**
 * Conditional helper: yields `K` when operator-config `TOperatorConfigs[K]` is bidirectionally
 * assignable to target filter type `TTargetFilter`; yields `never` otherwise. Used as a mapped-type
 * key filter to compute the operator union supported by a given field-type config.
 *
 * @template TOperatorConfigs - Operator-config map type (typically a fragment of `TCoreOperatorSpecificConfigs`).
 * @template K - Operator key under `TOperatorConfigs` being tested.
 * @template TTargetFilter - Target field-type configuration the operator must accept.
 */
export type TFilterOperatorHelper<
  TOperatorConfigs,
  K extends keyof TOperatorConfigs,
  TTargetFilter,
> = TTargetFilter extends TOperatorConfigs[K] ? K : TOperatorConfigs[K] extends TTargetFilter ? K : never;
