/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reserved typed containers for future extended/negated operator labels — empty at this revision so the barrel can spread them unconditionally into the consolidated lookup tables.
 * Consumers: `packages/constants/src/rich-filters/operator-labels/index.ts` (spread into `OPERATOR_LABELS_MAP` and `DATE_OPERATOR_LABELS_MAP`).
 */

import type { TExtendedSupportedOperators } from "@plane/types";

/**
 * Reserved typed container for extended-operator labels beyond the core vocabulary; the `Record<TExtendedSupportedOperators, string>` signature locks the future key space.
 * Consumers: spread into `OPERATOR_LABELS_MAP`/`DATE_OPERATOR_LABELS_MAP` by `packages/constants/src/rich-filters/operator-labels/index.ts`.
 */
export const EXTENDED_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

export const EXTENDED_DATE_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

/**
 * Reserved typed container for negated-operator labels (e.g., `is not`, `is not any of`); `Record<never, string>` signals no negated keys are populated yet.
 * Consumers: spread into `OPERATOR_LABELS_MAP`/`DATE_OPERATOR_LABELS_MAP` by `packages/constants/src/rich-filters/operator-labels/index.ts`.
 */
export const NEGATED_OPERATOR_LABELS_MAP: Record<never, string> = {} as const;

export const NEGATED_DATE_OPERATOR_LABELS_MAP: Record<never, string> = {} as const;
