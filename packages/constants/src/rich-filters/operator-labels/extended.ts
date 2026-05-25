/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended and negated operator-label contracts — declares the typed
 * containers that future extended-operator labels (and negated-operator
 * labels, once added) will populate. The four maps here are intentionally
 * empty at this revision; their type signatures hold the public shape so the
 * barrel can spread them into the consolidated lookup tables without
 * conditional logic.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (spreads all four maps into `OPERATOR_LABELS_MAP` and
 * `DATE_OPERATOR_LABELS_MAP`).
 */

import type { TExtendedSupportedOperators } from "@plane/types";

/**
 * Extended-operator label containers — reserved typed contracts for label
 * additions beyond the core operator vocabulary. Empty at this revision; the
 * `Record<TExtendedSupportedOperators, string>` signature locks the future
 * key space to the shared extended-operators type from `@plane/types`.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (spread into `OPERATOR_LABELS_MAP` and `DATE_OPERATOR_LABELS_MAP`).
 */
export const EXTENDED_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

export const EXTENDED_DATE_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

/**
 * Negated-operator label containers — reserved typed contracts for negated
 * operator labels (e.g., `is not`, `is not any of`). Typed as
 * `Record<never, string>` to signal that no negated keys are populated yet;
 * the empty key space is intentional and the contract is in place for future
 * negation coverage without disturbing the spread composition in the barrel.
 *
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts`
 * (spread into `OPERATOR_LABELS_MAP` and `DATE_OPERATOR_LABELS_MAP`).
 */
export const NEGATED_OPERATOR_LABELS_MAP: Record<never, string> = {} as const;

export const NEGATED_DATE_OPERATOR_LABELS_MAP: Record<never, string> = {} as const;
