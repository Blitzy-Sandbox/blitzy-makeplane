/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Source-of-truth display labels for the core operator vocabulary used by the
 * rich-filter UI. Keys are pulled from the shared operator token objects in
 * `@plane/types` (`CORE_EQUALITY_OPERATOR`, `CORE_COLLECTION_OPERATOR`,
 * `CORE_COMPARISON_OPERATOR`) so the labels stay in lock-step with the
 * canonical operator model.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (composed into the consolidated `OPERATOR_LABELS_MAP` and
 * `DATE_OPERATOR_LABELS_MAP` tables).
 */

import type { TCoreSupportedOperators, TCoreSupportedDateFilterOperators } from "@plane/types";
import { CORE_EQUALITY_OPERATOR, CORE_COLLECTION_OPERATOR, CORE_COMPARISON_OPERATOR } from "@plane/types";

/**
 * Display labels for the core operator vocabulary covering equality
 * (`EXACT`), collection (`IN`), and comparison (`RANGE`) tokens — the minimum
 * operator set every rich-filter field surface supports. Keyed by the
 * canonical operator strings from `@plane/types` and locked with `as const`.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (spread into `OPERATOR_LABELS_MAP`).
 */
export const CORE_OPERATOR_LABELS_MAP: Record<TCoreSupportedOperators, string> = {
  [CORE_EQUALITY_OPERATOR.EXACT]: "is",
  [CORE_COLLECTION_OPERATOR.IN]: "is any of",
  [CORE_COMPARISON_OPERATOR.RANGE]: "between",
} as const;

/**
 * Display labels for the date-aware subset of the core operator vocabulary.
 * Date filters intentionally omit the collection (`IN`) variant because Plane
 * does not surface multi-date set-membership filtering; only equality
 * (`EXACT`) and range (`RANGE`) are exposed.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (spread into `DATE_OPERATOR_LABELS_MAP`).
 */
export const CORE_DATE_OPERATOR_LABELS_MAP: Record<TCoreSupportedDateFilterOperators, string> = {
  [CORE_EQUALITY_OPERATOR.EXACT]: "is",
  [CORE_COMPARISON_OPERATOR.RANGE]: "between",
} as const;
