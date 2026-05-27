/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
/**
 * Barrel module for the workspace-draft issue store slice.
 *
 * Re-exports the workspace-draft issue cache/actions (`./issue.store`)
 * followed by the workspace-draft filter store (`./filter.store`), in that
 * exact order, so consumers can import the workspace-draft store API from a
 * single stable path. Adding, removing, or renaming named exports in either
 * sibling module flows through here automatically via wildcard re-exports.
 *
 * Consumers:
 *   - `apps/web/core/hooks/store/workspace-draft/*` — typed hooks that read
 *     `context.issue.workspaceDraftIssues` from `StoreContext` rely on the
 *     `IWorkspaceDraftIssues` type re-exported from `./issue.store`.
 *   - `apps/web/core/store/issue/root.store.ts` — composes
 *     `WorkspaceDraftIssuesFilter` and `WorkspaceDraftIssues` into the
 *     issue-domain root via this barrel.
 *   - `apps/web/core/components/issues/workspace-draft/**` — workspace draft
 *     list, item, properties, quick-action, delete, and empty-state views
 *     reach the store through the hooks above.
 */

export * from "./issue.store";
export * from "./filter.store";
