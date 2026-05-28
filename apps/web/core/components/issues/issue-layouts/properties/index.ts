/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-exports for the issue-layout properties subfolder.
 *
 * Re-exports:
 *   - `IssuePropertyLabels`, `IIssuePropertyLabels` from `./labels`
 *   - `IssueProperties`, `IIssueProperties` from `./all-properties`
 *   - `LabelDropdown`, `ILabelDropdownProps` from `./label-dropdown`
 *
 * Has no runtime logic — provides a stable import path for the issue-layout
 * variants (kanban, list, spreadsheet, calendar, gantt) and any consumer that
 * needs the inline issue-property UI primitives.
 */

export * from "./labels";
export * from "./all-properties";
export * from "./label-dropdown";
