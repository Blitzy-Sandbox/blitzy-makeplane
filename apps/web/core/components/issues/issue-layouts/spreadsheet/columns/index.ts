/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the spreadsheet column components.
 *
 * This file star-re-exports every spreadsheet editor / display / navigation column module in this
 * folder so consumers can import any column component from
 * `@/components/issues/issue-layouts/spreadsheet/columns` without referencing deep file paths.
 * The exported set includes:
 *
 *   - Interactive editor cells: `SpreadsheetAssigneeColumn`, `SpreadsheetCycleColumn`,
 *     `SpreadsheetDueDateColumn`, `SpreadsheetEstimateColumn`, `SpreadsheetLabelColumn`,
 *     `SpreadsheetModuleColumn`, `SpreadsheetPriorityColumn`, `SpreadsheetStartDateColumn`,
 *     `SpreadsheetStateColumn`
 *   - Read-only display cells: `SpreadsheetAttachmentColumn`, `SpreadsheetCreatedOnColumn`,
 *     `SpreadsheetLinkColumn`, `SpreadsheetUpdatedOnColumn`
 *   - Navigation cells: `SpreadsheetSubIssueColumn`
 *
 * The primary consumer is the `SPREADSHEET_COLUMNS` registry in
 * `@/plane-web/components/issues/issue-layouts/utils` which dispatches by property key into the
 * appropriate column component at render time.
 *
 * Note: `header-column.tsx`'s `HeaderColumn` symbol is intentionally NOT re-exported here because
 * its sole consumer (`../spreadsheet-header-column.tsx`) imports it via a relative path. The
 * header column is implementation detail of the spreadsheet header, not part of the column
 * "public API" that other layouts could reuse.
 *
 * Per the AAP, individual exports are documented in their own source files; this barrel adds no
 * per-export JSDoc to avoid duplication.
 */

export * from "./assignee-column";
export * from "./attachment-column";
export * from "./created-on-column";
export * from "./due-date-column";
export * from "./estimate-column";
export * from "./label-column";
export * from "./link-column";
export * from "./priority-column";
export * from "./start-date-column";
export * from "./state-column";
export * from "./sub-issue-column";
export * from "./updated-on-column";
export * from "./module-column";
export * from "./cycle-column";
