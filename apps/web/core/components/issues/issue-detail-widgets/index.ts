/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module that re-exports the `IssueDetailWidgets` composition entry point so
 * consumers can import the feature from a stable folder path without depending on
 * the internal file layout.
 *
 * Consumers: imported by issue-detail surfaces — e.g.,
 * `apps/web/core/components/issues/issue-detail/main-content.tsx` and the peek-overview body —
 * via `@/components/issues/issue-detail-widgets`.
 */

export * from "./root";
