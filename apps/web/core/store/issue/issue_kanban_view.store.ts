/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue kanban view-layout store: per-column collapse toggles, drag lifecycle flags,
 * and the drag-eligibility predicate that gates DnD for the issue kanban layout.
 *
 * State slice:
 *   - kanBanToggle: { groupByHeaderMinMax: string[]; subgroupByIssuesVisibility: string[] }
 *       (observable) — collections of column/group ids that are currently in their
 *       toggled state; the store owns the collapse model and exposes
 *       handleKanBanToggle to mutate it.
 *   - isDragging: boolean (observable.ref) — true while a drag operation is in
 *       progress; toggled by block-level drag handlers and read by the kanban
 *       root for drag-state UI.
 *
 * Actions:
 *   - handleKanBanToggle(toggle, value): toggles `value` in/out of
 *       kanBanToggle[toggle] (either "groupByHeaderMinMax" or
 *       "subgroupByIssuesVisibility"). Pure observable mutation; no network.
 *   - setIsDragging(isDragging): sets the drag flag during DnD interactions;
 *       declared `action.bound` so it can be safely passed as a callback.
 *
 * Computed (recompute only when their declared dependencies change):
 *   - canUserDragDropVertically: boolean — currently returns the constant `false`;
 *       intentional extension point for a future vertical-DnD policy. Do not
 *       infer additional semantics.
 *   - canUserDragDropHorizontally: boolean — currently returns the constant `false`;
 *       same extension-point shape as above.
 *
 * Computed actions (computedFn from mobx-utils — memoized per (group_by,
 * sub_group_by) tuple):
 *   - getCanUserDragDrop(group_by, sub_group_by): returns `true` only when
 *       `group_by` is a member of `DRAG_ALLOWED_GROUPS` (imported from
 *       `@plane/constants`) AND either `sub_group_by` is absent or also a
 *       member of the same allow-list. The allowed-grouping policy is
 *       data-driven and lives in `@plane/constants` — consumers wanting to
 *       change which groupings permit DnD should edit that constant rather
 *       than this store.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-layouts/kanban/default.tsx — calls
 *       getCanUserDragDrop(group_by, sub_group_by) to compute the layout's
 *       `isDragDisabled` flag
 *   - apps/web/core/components/issues/issue-layouts/kanban/base-kanban-root.tsx
 *       — reads `isDragging` to surface drag-state UI at the layout root
 *   - apps/web/core/components/issues/issue-layouts/kanban/block.tsx — calls
 *       setIsDragging(true|false) around the drag lifecycle of a card
 *   - Accessed via apps/web/core/hooks/store/use-kanban-view.ts —
 *       `useKanbanView()` returns `context.issue.issueKanBanView`
 *   - Composed by apps/web/core/store/issue/root.store.ts as `issueKanBanView`
 */

import { action, computed, makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
import { DRAG_ALLOWED_GROUPS } from "@plane/constants";
// types
import type { TIssueGroupByOptions } from "@plane/types";
// constants
// store
import type { IssueRootStore } from "./root.store";

export interface IIssueKanBanViewStore {
  kanBanToggle: {
    groupByHeaderMinMax: string[];
    subgroupByIssuesVisibility: string[];
  };
  isDragging: boolean;
  // computed
  getCanUserDragDrop: (
    group_by: TIssueGroupByOptions | undefined,
    sub_group_by: TIssueGroupByOptions | undefined
  ) => boolean;
  canUserDragDropVertically: boolean;
  canUserDragDropHorizontally: boolean;
  // actions
  handleKanBanToggle: (toggle: "groupByHeaderMinMax" | "subgroupByIssuesVisibility", value: string) => void;
  setIsDragging: (isDragging: boolean) => void;
}

export class IssueKanBanViewStore implements IIssueKanBanViewStore {
  kanBanToggle: {
    groupByHeaderMinMax: string[];
    subgroupByIssuesVisibility: string[];
  } = { groupByHeaderMinMax: [], subgroupByIssuesVisibility: [] };
  isDragging = false;
  // root store
  rootStore;

  constructor(_rootStore: IssueRootStore) {
    makeObservable(this, {
      kanBanToggle: observable,
      isDragging: observable.ref,
      // computed
      canUserDragDropVertically: computed,
      canUserDragDropHorizontally: computed,

      // actions
      handleKanBanToggle: action,
      setIsDragging: action.bound,
    });

    this.rootStore = _rootStore;
  }

  setIsDragging = (isDragging: boolean) => {
    this.isDragging = isDragging;
  };

  getCanUserDragDrop = computedFn(
    (group_by: TIssueGroupByOptions | undefined, sub_group_by: TIssueGroupByOptions | undefined) => {
      if (group_by && DRAG_ALLOWED_GROUPS.includes(group_by)) {
        if (!sub_group_by) return true;
        if (sub_group_by && DRAG_ALLOWED_GROUPS.includes(sub_group_by)) return true;
      }
      return false;
    }
  );

  get canUserDragDropVertically() {
    return false;
  }

  get canUserDragDropHorizontally() {
    return false;
  }

  handleKanBanToggle = (toggle: "groupByHeaderMinMax" | "subgroupByIssuesVisibility", value: string) => {
    this.kanBanToggle = {
      ...this.kanBanToggle,
      [toggle]: this.kanBanToggle[toggle].includes(value)
        ? this.kanBanToggle[toggle].filter((v) => v !== value)
        : [...this.kanBanToggle[toggle], value],
    };
  };
}
