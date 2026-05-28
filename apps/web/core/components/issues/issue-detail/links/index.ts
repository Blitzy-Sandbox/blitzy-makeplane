/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail links feature.
 *
 * Re-exports the public API of every sibling module so consumers may import the feature from a
 * single stable path (`@/components/issues/issue-detail/links`) without coupling to the internal
 * file layout. Specifically re-exports:
 *
 *   - `./root`        — `IssueLinkRoot` orchestrator, `TLinkOperations` contract (create/update/remove),
 *                       and `TIssueLinkRoot` prop shape
 *   - `./links`       — `IssueLinkList` (card-style list), its `TIssueLinkList` prop shape, and the
 *                       narrowed `TLinkOperationsModal` alias
 *   - `./link-detail` — `IssueLinkDetail` (per-link card renderer) and its `TIssueLinkDetail` prop shape
 *   - `./link-item`   — `IssueLinkItem` (per-link row renderer)
 *   - `./link-list`   — `LinkList` (row-style list)
 *
 * Contains no runtime logic — pure barrel module.
 */

export * from "./root";

export * from "./links";
export * from "./link-detail";
export * from "./link-item";
export * from "./link-list";
