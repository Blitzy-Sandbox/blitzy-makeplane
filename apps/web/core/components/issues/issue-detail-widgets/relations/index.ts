/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export aggregator for the relations issue-detail widget; exposes
 * `RelationsCollapsibleContent` (from `./content`), `RelationsCollapsibleTitle`
 * (from `./title`), `RelationsCollapsible` (from `./root`), and
 * `RelationActionButton` (from `./quick-action-button`) under a single import path.
 *
 * Consumers: re-exported by `../index.ts` (issue-detail-widgets barrel) and consumed
 * by `../root.tsx` (`IssueDetailWidgetCollapsibles`) and per-call-site imports from
 * `issue-detail/main-content.tsx` and the peek-overview body.
 */

export * from "./content";
export * from "./title";
export * from "./root";
export * from "./quick-action-button";
