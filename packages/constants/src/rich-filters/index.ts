/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-filters constants barrel — re-exports filter-option / visibility
 * contracts (from `./option`) and operator → display-label maps (from
 * `./operator-labels`) so the rich-filter chip UI and its backing stores
 * have a single stable import path for both surfaces.
 *
 * Consumers: `packages/shared-state/src/store/rich-filters/` (filter,
 * config-manager, filter-helpers), `packages/shared-state/src/store/work-item-filters/filter.store.ts`,
 * and `apps/web/core/components/work-item-filters/filters-hoc/` resolve
 * rich-filter constants through this barrel via `@plane/constants`.
 */

export * from "./operator-labels";
export * from "./option";
