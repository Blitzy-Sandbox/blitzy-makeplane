/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the module-domain types under `@plane/types`.
 *
 * Re-exports the module entity contracts from `./modules` and the
 * filter/display-preference contracts from `./module_filters`. Consumers
 * import from `@plane/types` (the package-level barrel re-exports this one),
 * so this file exists purely as an internal aggregation point that hides
 * the internal file split.
 */

export * from "./module_filters";
export * from "./modules";
