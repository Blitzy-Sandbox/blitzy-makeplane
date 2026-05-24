/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended operator-to-config-shape placeholders for the `@plane/types/rich-filters/operator-configs` subfolder.
 *
 * Reserved extension surface that mirrors the core file. All concrete config aliases
 * currently resolve to `never`, and `TExtendedOperatorSpecificConfigs` is `unknown` —
 * acting as a permissive placeholder that must be narrowed by consumers when extending.
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
