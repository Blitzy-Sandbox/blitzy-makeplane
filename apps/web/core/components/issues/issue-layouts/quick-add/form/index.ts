/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the quick-add form variants.
 *
 * Re-exports every layout-specific form component (`ListQuickAddIssueForm`,
 * `KanbanQuickAddIssueForm`, `GanttQuickAddIssueForm`, `CalendarQuickAddIssueForm`,
 * `SpreadsheetQuickAddIssueForm`) so consumers in the parent `quick-add/` orchestrator can import them
 * from a single stable path.
 *
 * Side effects: none — pure re-exports.
 *
 * MobX stores read: none in this file; consult each variant's module-level JSDoc for the shared
 * `TQuickAddIssueForm` prop contract from `../root`.
 */

export * from "./list";
export * from "./kanban";
export * from "./gantt";
export * from "./calendar";
export * from "./spreadsheet";
