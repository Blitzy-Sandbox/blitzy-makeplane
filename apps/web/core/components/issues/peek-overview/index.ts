/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the work item peek-overview feature.
 *
 * Re-exports the orchestration root (`IssuePeekOverview` from `./root`) so consumers can import
 * the peek panel without depending on the internal file layout (`root.tsx`, `view.tsx`,
 * `header.tsx`, `issue-detail.tsx`, `properties.tsx`, `loader.tsx`, `error.tsx`).
 */
export * from "./root";
