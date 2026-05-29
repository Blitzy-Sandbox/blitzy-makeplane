/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export module for the issue-modal `components/` subdirectory.
 *
 * Public API surface of the issue-modal form's reusable building blocks; consumed by `../form.tsx` and
 * sibling modules under `apps/web/core/components/issues/issue-modal/`. Provides a stable import path so
 * higher-level code references the component set from a single location.
 *
 * Re-exported components:
 *   - `IssueProjectSelect` (from `./project-select`) — React Hook Form `Controller`-wrapped project picker
 *     for `TIssue.project_id`; restricts options via `allowedProjectIds` from the issue-modal context.
 *   - `IssueParentTag` (from `./parent-tag`) — compact, dismissible chip displaying the currently-selected
 *     parent work item with a close action that clears `parent_id`.
 *   - `IssueTitleInput` (from `./title-input`) — required title input bound to `TIssue.name` with validation
 *     (required + non-whitespace + 255-char max) and externally-forwarded ref for focus management.
 *   - `IssueDescriptionEditor` (from `./description-editor`) — TipTap-backed rich-text editor for
 *     `TIssue.description_html` with asset upload/duplication, workspace mention search, and optional
 *     GPT-assisted description generation.
 *   - `IssueDefaultProperties` (from `./default-properties`) — composite control block for state, priority,
 *     assignees, labels, dates, cycle, module, estimate, and parent-issue selection.
 *
 * No runtime logic; pure re-export. Side effects: none.
 */

export * from "./project-select";
export * from "./parent-tag";
export * from "./title-input";
export * from "./description-editor";
export * from "./default-properties";
