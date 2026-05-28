/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the applied-filter chip components.
 *
 * Each re-exported file exposes a single `Applied<Domain>Filters` component that renders the
 * currently-selected values for one filter category (date, label, members, priority, project, module,
 * cycle, state, state-group). Components share a common `{ handleRemove, values, editable? }` Props
 * contract (the `editable` field is absent on `date.tsx` and `state-group.tsx`, where the close button
 * is always rendered). The parent aggregator (typically in `issue-layouts/<layout>/header` or the
 * layout root) is responsible for invoking the actual
 * `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, ...)` call when a
 * chip's close button is clicked.
 *
 * Re-exported symbols:
 *   - `AppliedDateFilters`           (from `./date`)
 *   - `AppliedLabelsFilters`         (from `./label`)
 *   - `AppliedMembersFilters`        (from `./members`)
 *   - `AppliedPriorityFilters`       (from `./priority`)
 *   - `AppliedProjectFilters`        (from `./project`)
 *   - `AppliedModuleFilters`         (from `./module`)
 *   - `AppliedCycleFilters`          (from `./cycle`)
 *   - `AppliedStateFilters`          (from `./state`)
 *   - `AppliedStateGroupFilters`     (from `./state-group`)
 *
 * No runtime logic lives here; this file is a pure ESM forwarder.
 */

export * from "./date";
export * from "./label";
export * from "./members";
export * from "./priority";
export * from "./project";
export * from "./module";
export * from "./cycle";
export * from "./state";
export * from "./state-group";
