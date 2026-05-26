/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-exports for the `@plane/ui` progress visualization family:
 * `RadialProgressBar` (compact donut), `ProgressBar` (segmented donut ring),
 * `LinearProgressIndicator` (segmented horizontal bar), and
 * `CircularProgressIndicator` (configurable ring with optional inner content).
 *
 * Each variant suits a different layout density and value-domain:
 * use `LinearProgressIndicator` for multi-category breakdowns, `CircularProgressIndicator`
 * for percentage-with-label in lists/cards, `ProgressBar` for discrete N-of-M counters,
 * and `RadialProgressBar` for fixed compact 16×16 px footprints.
 */

export * from "./radial-progress";
export * from "./progress-bar";
export * from "./linear-progress-indicator";
export * from "./circular-progress-indicator";
