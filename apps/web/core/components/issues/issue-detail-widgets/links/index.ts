/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module that re-exports the public surface of the issue-detail "links" widget
 * (root collapsible, title row, body content, and quick-action button) so that external
 * consumers can import any of them from a single path without depending on the internal
 * file layout of this folder.
 *
 * Consumers: re-exported by `../index.ts` (issue-detail-widgets barrel) and consumed by
 * `../root.tsx` (`IssueDetailWidgetCollapsibles` / `IssueDetailWidgetModals`) for the
 * shared issue-detail widget shell rendered by `issue-detail/main-content.tsx` and the
 * peek-overview body.
 */

export * from "./content";
export * from "./title";
export * from "./root";
export * from "./quick-action-button";
