/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the quick-add feature subtree.
 *
 * Re-exports the orchestrating `QuickAddIssueRoot` component (and its `TQuickAddIssueForm` /
 * `TQuickAddIssueButton` prop contracts) from `./root`, plus the layout-specific form variants
 * from `./form` and trigger button variants from `./button`. Allows consumers in
 * `apps/web/core/components/issues/issue-layouts/{list,kanban,gantt,calendar,spreadsheet}/` to import
 * the quick-add surface from one stable directory path.
 *
 * Side effects: none — pure re-exports.
 *
 * MobX stores read: none in this file; consult `./root` for the parent component's behavior.
 */
export * from "./root";
export * from "./form";
export * from "./button";
