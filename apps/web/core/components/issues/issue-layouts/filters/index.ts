/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the issue-layouts filter UI surface.
 *
 * Re-exports the header filter controls and the applied-filter chip components so that downstream
 * consumers can import filter primitives from a single stable path
 * (`@/components/issues/issue-layouts/filters`) rather than coupling to nested file locations.
 *
 * Two surfaces are re-exported:
 *   - `./header`: layout selection (desktop + mobile), the display-filters dropdown, the entity-specific
 *     filter dropdowns (assignee, label, priority, state, cycle, module, etc.), and shared filter-UI
 *     helpers (`FiltersDropdown`, `FilterHeader`, `FilterOption`).
 *   - `./applied-filters`: the chip / badge components that render each currently-selected filter value
 *     and expose a removal callback (priority, state, state-group, label, members, cycle, module,
 *     project, date).
 *
 * No runtime logic lives here; this file is a pure ESM forwarder used solely for module-boundary
 * stability. All imports of `@/components/issues/issue-layouts/filters` resolve through this entrypoint.
 */

export * from "./header";
export * from "./applied-filters";
