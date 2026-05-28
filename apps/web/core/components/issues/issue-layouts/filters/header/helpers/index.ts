/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the shared filter-UI primitives reused by every header filter / display-filter panel.
 *
 * Re-exports:
 *   - `FiltersDropdown` (`./dropdown`) — Headless UI Popover wrapper with popper.js positioning;
 *     the outer dropdown shell used by both the filters Popover and the display-filters dropdown.
 *   - `FilterHeader` (`./filter-header`) — collapsible section header rendered above every filter
 *     / display-filter section body.
 *   - `FilterOption` (`./filter-option`) — single selectable row primitive (checkbox or radio +
 *     leading icon + label) used by every entity-specific filter and every display-filter section.
 *
 * These primitives are presentational only — they read no MobX stores, perform no router
 * navigation, and have no persistence side effects. All state and callbacks are caller-supplied.
 */

export * from "./dropdown";
export * from "./filter-header";
export * from "./filter-option";
