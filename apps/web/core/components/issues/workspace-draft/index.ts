/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export for the workspace-level draft work-item components.
 *
 * Public re-exports: `WorkspaceDraftIssuesRoot` from `./root` — re-exported via star.
 * Sibling modules (`delete-modal`, `draft-issue-block`, `draft-issue-properties`,
 * `empty-state`, `loader`, `quick-action`) are intentionally NOT re-exported from this
 * barrel because they are private to the `workspace-draft/` subtree; importers should
 * deep-import them by relative path when composing the workspace draft list internally.
 *
 * Consumers:
 *   - `apps/web/app/[workspaceSlug]/(projects)/drafts/` (workspace draft page route)
 *   - `apps/web/core/components/workspace/` surfaces that render the draft list
 */

export * from "./root";
