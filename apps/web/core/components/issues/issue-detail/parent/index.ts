/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail parent feature.
 *
 * Re-exports the three sibling modules in this folder so consumers can import the parent-detail
 * UI from a single stable path:
 *
 *     import {
 *       IssueParentDetail,
 *       IssueParentSiblings,
 *       IssueParentSiblingItem,
 *     } from "@/components/issues/issue-detail/parent";
 *
 * Module surface (transitively re-exported):
 *   - From `./root`: `IssueParentDetail` (observer-wrapped component rendering the compact parent
 *     summary strip with overflow menu) and `TIssueParentDetail` (its prop shape).
 *   - From `./siblings`: `IssueParentSiblings` (observer-wrapped sibling list panel) and
 *     `TIssueParentSiblings` (its prop shape).
 *   - From `./sibling-item`: `IssueParentSiblingItem` (single sibling-row component).
 *
 * No runtime logic — pure barrel module.
 *
 * Consumers: imported by `../main-content.tsx`, which mounts `IssueParentDetail`
 * directly above the title editor on the issue-detail page.
 */

export * from "./root";

export * from "./siblings";
export * from "./sibling-item";
