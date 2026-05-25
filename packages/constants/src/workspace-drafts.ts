/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pagination direction tokens for the workspace draft-issues list.
 *
 * Consumers: `apps/web/core/store/issue/workspace-draft/**` for fetching draft pages
 * relative to a cursor and `apps/web/core/components/issues/workspace-draft/**` for paging UI.
 *
 * Values:
 * - INIT: initial fetch from the start of the list
 * - NEXT: fetch the page after the current cursor
 * - PREV: fetch the page before the current cursor
 * - CURRENT: refresh the current page without advancing the cursor
 */
export enum EDraftIssuePaginationType {
  INIT = "INIT",
  NEXT = "NEXT",
  PREV = "PREV",
  CURRENT = "CURRENT",
}
