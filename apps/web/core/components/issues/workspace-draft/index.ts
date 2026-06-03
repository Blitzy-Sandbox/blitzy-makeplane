/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the workspace draft issues feature surface.
 *
 * Re-exports `WorkspaceDraftIssuesRoot` (and any other public exports) from
 * `./root` so that consumers import via the stable folder path
 * `@/components/issues/workspace-draft`. The primary consumer is the workspace
 * drafts page at `apps/web/app/(all)/[workspaceSlug]/(projects)/drafts/page.tsx`.
 */
export * from "./root";
