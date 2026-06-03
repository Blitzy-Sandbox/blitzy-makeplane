/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cursor-direction tokens (INIT/NEXT/PREV/CURRENT) for the workspace draft-issues list pagination.
 * Consumers: `apps/web/core/store/issue/workspace-draft/**` (fetch logic) and `apps/web/core/components/issues/workspace-draft/**` (paging UI).
 */
export enum EDraftIssuePaginationType {
  INIT = "INIT",
  NEXT = "NEXT",
  PREV = "PREV",
  CURRENT = "CURRENT",
}
