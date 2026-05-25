/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Operator-labels sub-barrel — composes the core, extended, and negated
 * operator → display-label maps into the consolidated lookup tables consumed
 * by the rich-filter chip UI, and re-exports the underlying definitions for
 * callers that need direct access to any layer.
 *
 * Consumers: `packages/utils/src/rich-filters/operators/core.ts`
 * (`getOperatorLabel`, `getDateOperatorLabel`, `isDateFilterOperator`) and
 * `packages/shared-state/src/store/rich-filters/config.ts` (config store
 * placeholder for unselected operator state).
 */

import type { TAllAvailableOperatorsForDisplay, TAllAvailableDateFilterOperatorsForDisplay } from "@plane/types";
import { CORE_OPERATOR_LABELS_MAP, CORE_DATE_OPERATOR_LABELS_MAP } from "./core";
import {
  EXTENDED_OPERATOR_LABELS_MAP,
  EXTENDED_DATE_OPERATOR_LABELS_MAP,
  NEGATED_OPERATOR_LABELS_MAP,
  NEGATED_DATE_OPERATOR_LABELS_MAP,
} from "./extended";

/**
 * Sentinel label rendered when no operator is selected or when an operator key
 * has no entry in the resolved label map. The literal `"--"` is the agreed
 * placeholder string for the rich-filter chip UI.
 *
 * Consumers: `packages/utils/src/rich-filters/operators/core.ts` (fallback in
 * `getOperatorLabel` and `getDateOperatorLabel`) and
 * `packages/shared-state/src/store/rich-filters/config.ts` (config store
 * placeholder for unselected operator state).
 */
export const EMPTY_OPERATOR_LABEL = "--";

/**
 * Consolidated operator → display-label table covering every operator surfaced
 * by the rich-filter UI. Composed by spreading `CORE`, `EXTENDED`, and
 * `NEGATED` maps in that order, so later layers override earlier ones on key
 * collision.
 *
 * Consumers: `packages/utils/src/rich-filters/operators/core.ts`
 * (`getOperatorLabel` returns the value at the operator key, falling back to
 * `EMPTY_OPERATOR_LABEL`).
 */
export const OPERATOR_LABELS_MAP: Record<TAllAvailableOperatorsForDisplay, string> = {
  ...CORE_OPERATOR_LABELS_MAP,
  ...EXTENDED_OPERATOR_LABELS_MAP,
  ...NEGATED_OPERATOR_LABELS_MAP,
} as const;

/**
 * Consolidated date-operator → display-label table for the date-aware
 * variants of the rich-filter UI. Composed by spreading the core, extended,
 * and negated date label maps in that order, so later layers override earlier
 * ones on key collision.
 *
 * Consumers: `packages/utils/src/rich-filters/operators/core.ts`
 * (`getDateOperatorLabel` lookup; `isDateFilterOperator` type guard uses
 * `Object.keys(DATE_OPERATOR_LABELS_MAP)` to discriminate date operators).
 */
export const DATE_OPERATOR_LABELS_MAP: Record<TAllAvailableDateFilterOperatorsForDisplay, string> = {
  ...CORE_DATE_OPERATOR_LABELS_MAP,
  ...EXTENDED_DATE_OPERATOR_LABELS_MAP,
  ...NEGATED_DATE_OPERATOR_LABELS_MAP,
} as const;

// -------- RE-EXPORTS --------

export * from "./core";
export * from "./extended";
