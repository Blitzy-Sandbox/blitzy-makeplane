/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-filters barrel re-exporting filter-option/visibility contracts from `./option` and operator→label maps from `./operator-labels` for the rich-filter chip UI and backing stores.
 * Consumers: `packages/shared-state/src/store/{rich-filters,work-item-filters}/**` and `apps/web/core/components/work-item-filters/filters-hoc/**`.
 */

export * from "./operator-labels";
export * from "./option";
