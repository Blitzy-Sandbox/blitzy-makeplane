/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export for the cycle applied-filters component surface.
 *
 * Public exports (transitively re-exported from `./root`):
 *   - CycleAppliedFiltersList — MobX-observed root component that composes the
 *     per-key applied-filter chips (status + date) plus a clear-all affordance.
 *
 * Sibling implementation files (`./status`, `./date`) are NOT re-exported here;
 * they are consumed only by `./root` and remain folder-internal.
 *
 * Consumers: cycle list / archived-cycle list routes that render an applied-filters
 * strip above the cycles grid (apps/web/core/components/cycles/list/** and
 * apps/web/core/components/cycles/archived-cycles/**).
 */
export * from "./root";
