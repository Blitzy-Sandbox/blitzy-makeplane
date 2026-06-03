/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extension-tier operator-to-config-shape placeholders mirroring the core file;
 * concrete aliases resolve to `never` and `TExtendedOperatorSpecificConfigs` is
 * `unknown` (a permissive placeholder consumers must narrow when extending).
 */

// ----------------------------- EXACT Operator -----------------------------
/**
 * Reserved extension placeholder for `EXACT`-compatible config shapes; currently `never`.
 */
export type TExtendedExactOperatorConfigs = never;

// ----------------------------- IN Operator -----------------------------
/**
 * Reserved extension placeholder for `IN`-compatible config shapes; currently `never`.
 */
export type TExtendedInOperatorConfigs = never;

// ----------------------------- RANGE Operator -----------------------------
/**
 * Reserved extension placeholder for `RANGE`-compatible config shapes; currently `never`.
 */
export type TExtendedRangeOperatorConfigs = never;

// ----------------------------- Extended Operator Specific Configs -----------------------------
/**
 * Permissive extension placeholder for the extended operator-specific config map; currently `unknown` — narrowed by consumers when extending.
 */
export type TExtendedOperatorSpecificConfigs = unknown;
