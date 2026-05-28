/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public entry point of the issue-detail label feature.
 *
 * Re-exports the feature's public surface from one stable path so consumers (e.g.,
 * `apps/web/core/components/issues/issue-detail/sidebar.tsx`) can import the whole label module via:
 *
 *     import { IssueLabel, LabelList, LabelListItem, LabelCreate,
 *              IssueLabelSelectRoot, IssueLabelSelect,
 *              type TIssueLabel, type TLabelOperations } from "@/components/issues/issue-detail/label";
 *
 * The two exported types `TIssueLabel` (props shape of the `IssueLabel` orchestrator) and
 * `TLabelOperations` (the label-mutation contract passed down to list items and the selector)
 * originate in `./root` and are re-exported transitively via `export * from "./root"`.
 *
 * Star re-exports cover:
 *   - `./root`                  — orchestrator `IssueLabel` + `TIssueLabel`, `TLabelOperations`
 *   - `./label-list`            — `LabelList` container
 *   - `./label-list-item`       — `LabelListItem` chip
 *   - `./create-label`          — `LabelCreate` inline label-creation editor
 *   - `./select/root`           — `IssueLabelSelectRoot` adapter
 *   - `./select/label-select`   — `IssueLabelSelect` combobox picker
 *
 * No runtime logic — pure barrel module.
 *
 * Consumers: imported by `../sidebar.tsx` (`IssueDetailsSidebar` label section) and
 * by per-call-site label flows that need direct access to the inline label editor,
 * list, or selector primitives.
 */

export * from "./root";

export * from "./label-list";
export * from "./label-list-item";
export * from "./create-label";
export * from "./select/root";
export * from "./select/label-select";
