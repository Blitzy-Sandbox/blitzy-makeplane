/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail feature.
 *
 * Re-exports the root orchestrator (`IssueDetailRoot`) and the two contract types
 * (`TIssueOperations` and `TIssueDetailRoot`) from `./root` so downstream code imports the feature
 * from one stable path:
 *
 *     import { IssueDetailRoot, type TIssueOperations } from "@/components/issues/issue-detail";
 *
 * The `TIssueOperations` contract is the boundary between store-backed mutation actions (live in
 * `./root.tsx`) and store-agnostic UI components elsewhere in this directory (e.g., `title-input`,
 * `sidebar`, `cycle-select`, `module-select`, `parent-select`, `main-content`). Consumers receive
 * an opaque contract object and call its methods via optional chaining (`?.`) because several
 * methods (archive/restore/cycle/module ops) are optional and only present when the relevant
 * feature is enabled for the issue context.
 *
 * No runtime logic — pure barrel module.
 */

export * from "./root";
