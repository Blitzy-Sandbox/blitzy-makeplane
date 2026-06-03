/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Source-of-truth display labels for the core rich-filter operator vocabulary, keyed off the canonical operator token objects in `@plane/types` so labels stay in lockstep.
 * Consumers: composed into `OPERATOR_LABELS_MAP` and `DATE_OPERATOR_LABELS_MAP` by `packages/constants/src/rich-filters/operator-labels/index.ts`.
 */

import type { TCoreSupportedOperators, TCoreSupportedDateFilterOperators } from "@plane/types";
import { CORE_EQUALITY_OPERATOR, CORE_COLLECTION_OPERATOR, CORE_COMPARISON_OPERATOR } from "@plane/types";

/**
 * Display labels for the minimum operator set every rich-filter field supports — equality (`EXACT`), collection (`IN`), and comparison (`RANGE`) — locked with `as const`.
 * Consumers: spread into `OPERATOR_LABELS_MAP` by `packages/constants/src/rich-filters/operator-labels/index.ts`.
 */
export const CORE_OPERATOR_LABELS_MAP: Record<TCoreSupportedOperators, string> = {
  [CORE_EQUALITY_OPERATOR.EXACT]: "is",
  [CORE_COLLECTION_OPERATOR.IN]: "is any of",
  [CORE_COMPARISON_OPERATOR.RANGE]: "between",
} as const;

/**
 * Date-aware subset of core operator labels — only `EXACT` and `RANGE` are exposed because Plane does not surface multi-date set-membership (`IN`) filtering.
 * Consumers: spread into `DATE_OPERATOR_LABELS_MAP` by `packages/constants/src/rich-filters/operator-labels/index.ts`.
 */
export const CORE_DATE_OPERATOR_LABELS_MAP: Record<TCoreSupportedDateFilterOperators, string> = {
  [CORE_EQUALITY_OPERATOR.EXACT]: "is",
  [CORE_COMPARISON_OPERATOR.RANGE]: "between",
} as const;
