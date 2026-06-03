/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sub-barrel composing core/extended/negated operator→label maps into the consolidated rich-filter lookup tables and re-exporting the underlying definitions.
 * Consumers: `packages/utils/src/rich-filters/operators/core.ts` and `packages/shared-state/src/store/rich-filters/config.ts`.
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
 * Sentinel `"--"` rendered when no operator is selected or no label is found in the resolved map.
 * Consumers: `getOperatorLabel`/`getDateOperatorLabel` fallback in `packages/utils/src/rich-filters/operators/core.ts` and the config store placeholder in `packages/shared-state/src/store/rich-filters/config.ts`.
 */
export const EMPTY_OPERATOR_LABEL = "--";

/**
 * Consolidated operator→label table covering every operator surfaced by the rich-filter UI; composed by spreading CORE → EXTENDED → NEGATED so later layers win on key collision.
 * Consumers: `getOperatorLabel` in `packages/utils/src/rich-filters/operators/core.ts` (falls back to `EMPTY_OPERATOR_LABEL`).
 */
export const OPERATOR_LABELS_MAP: Record<TAllAvailableOperatorsForDisplay, string> = {
  ...CORE_OPERATOR_LABELS_MAP,
  ...EXTENDED_OPERATOR_LABELS_MAP,
  ...NEGATED_OPERATOR_LABELS_MAP,
} as const;

/**
 * Consolidated date-operator→label table composed by spreading CORE → EXTENDED → NEGATED date maps so later layers win on key collision.
 * Consumers: `getDateOperatorLabel` lookup and `isDateFilterOperator` type-guard discrimination in `packages/utils/src/rich-filters/operators/core.ts`.
 */
export const DATE_OPERATOR_LABELS_MAP: Record<TAllAvailableDateFilterOperatorsForDisplay, string> = {
  ...CORE_DATE_OPERATOR_LABELS_MAP,
  ...EXTENDED_DATE_OPERATOR_LABELS_MAP,
  ...NEGATED_DATE_OPERATOR_LABELS_MAP,
} as const;

// -------- RE-EXPORTS --------

export * from "./core";
export * from "./extended";
