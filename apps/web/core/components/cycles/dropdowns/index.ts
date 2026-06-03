/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the cycles dropdowns feature surface.
 *
 * Re-exports:
 *   - `CycleFiltersSelection` (composite filter root) plus its section
 *     components `FilterStartDate`, `FilterEndDate`, and `FilterStatus`
 *     from `./filters`.
 *   - `EstimateTypeDropdown` (cycle estimate-type selector) from
 *     `./estimate-type-dropdown`.
 *
 * Consumers of the re-exported symbols include
 * `apps/web/core/components/cycles/cycles-view-header.tsx` and
 * `apps/web/core/components/cycles/archived-cycles/header.tsx`
 * (importing `CycleFiltersSelection` through this barrel), and
 * `apps/web/core/components/cycles/active-cycle/productivity.tsx`
 * (consuming `EstimateTypeDropdown`).
 *
 * The barrel exists so consumers share a single stable import path for
 * the cycles dropdown set and are decoupled from the internal file
 * layout of this folder.
 */

export * from "./filters";
export * from "./estimate-type-dropdown";
