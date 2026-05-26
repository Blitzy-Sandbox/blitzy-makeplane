/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entrypoint for the custom-image toolbar feature.
 *
 * Re-exports `ImageToolbarRoot` from `./root` so consumers (e.g., the parent
 * image-block renderer in `../block.tsx`) can import via the directory path
 * without referencing the underlying implementation file. Stabilizing the
 * public import surface keeps the toolbar module free to evolve internally.
 *
 * Pure module-boundary management — no logic, state, or runtime side effects.
 */

export * from "./root";
