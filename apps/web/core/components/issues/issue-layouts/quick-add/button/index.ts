/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the quick-add trigger button variants.
 *
 * Re-exports every layout-specific trigger button component
 * (`ListQuickAddIssueButton`, `KanbanQuickAddIssueButton`,
 * `GanttQuickAddIssueButton`, `SpreadsheetAddIssueButton`) so consumers in
 * the parent `quick-add/` orchestrator can import them from a single
 * stable path.
 *
 * All four variants share the `TQuickAddIssueButton` prop contract from
 * `../root` and behave as thin presentation + event-forwarding adapters;
 * see each individual module's JSDoc for variant-specific semantics
 * (notably the i18n key divergence between spreadsheet and the others).
 *
 * Side effects: none — pure re-exports.
 */

export * from "./list";
export * from "./kanban";
export * from "./gantt";
export * from "./spreadsheet";
