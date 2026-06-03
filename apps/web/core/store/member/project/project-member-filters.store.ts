/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project member filters store — per-project filter state and filtered-id memoization.
 *
 * State slice:
 *   - filtersMap: Record<string, IMemberFilters> (observable) — keyed by projectId; each entry is
 *     an IMemberFilters object (`{ order_by?, roles? }`) from `../utils`.
 *
 * Actions:
 *   - updateFilters(projectId, filters: Partial<IMemberFilters>): void (decorated `action`) —
 *     shallow-merges (`{ ...current, ...filters }`) onto `filtersMap[projectId]` so callers can
 *     update one field without losing existing selections. No service calls; purely in-memory.
 *   - getFilters(projectId): IMemberFilters | undefined — non-action selector returning
 *     `filtersMap[projectId]` (may be undefined).
 *
 * Computed actions (memoized via `computedFn` from `mobx-utils`):
 *   - getFilteredMemberIds(members, memberDetailsMap, getMemberKey, projectId): string[] —
 *     short-circuits to `[]` when `members` is empty; otherwise delegates to `sortProjectMembers`
 *     with the active filter and maps the result back to id strings via `getMemberKey`.
 *     Recomputes when `filtersMap[projectId]`, the `members` reference, or the
 *     `memberDetailsMap` reference changes.
 *
 * Consumers:
 *   - apps/web/core/store/member/project/base-project-member.store.ts
 *     (instantiates `new ProjectMemberFiltersStore()` in its constructor and reads via
 *     `filters.getFilteredMemberIds(...)` / `filters.updateFilters(...)`)
 *   - apps/web/core/components/project/applied-filters/members.tsx
 *   - apps/web/core/components/project/dropdowns/filters/members.tsx
 *   - apps/web/core/components/project/dropdowns/filters/lead.tsx
 *   - apps/web/core/components/project/settings/member-columns.tsx
 */

import { action, makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { IUserLite, TProjectMembership } from "@plane/types";
// local imports
import type { IMemberFilters } from "../utils";
import { sortProjectMembers } from "../utils";

export interface IProjectMemberFiltersStore {
  // observables
  filtersMap: Record<string, IMemberFilters>;
  // computed actions
  getFilteredMemberIds: (
    members: TProjectMembership[],
    memberDetailsMap: Record<string, IUserLite>,
    getMemberKey: (member: TProjectMembership) => string,
    projectId: string
  ) => string[];
  // actions
  updateFilters: (projectId: string, filters: Partial<IMemberFilters>) => void;
  getFilters: (projectId: string) => IMemberFilters | undefined;
}

export class ProjectMemberFiltersStore implements IProjectMemberFiltersStore {
  // observables
  filtersMap: Record<string, IMemberFilters> = {};

  constructor() {
    makeObservable(this, {
      // observables
      filtersMap: observable,
      // actions
      updateFilters: action,
    });
  }

  /**
   * @description get filtered and sorted member ids
   * @param members - array of project membership objects
   * @param memberDetailsMap - map of member details by user id
   * @param getMemberKey - function to get member key from membership object
   * @param projectId - project id to get filters for
   */
  getFilteredMemberIds = computedFn(
    (
      members: TProjectMembership[],
      memberDetailsMap: Record<string, IUserLite>,
      getMemberKey: (member: TProjectMembership) => string,
      projectId: string
    ): string[] => {
      if (!members || members.length === 0) return [];

      // Apply filters and sorting
      const sortedMembers = sortProjectMembers(members, memberDetailsMap, getMemberKey, this.filtersMap[projectId]);

      return sortedMembers.map(getMemberKey);
    }
  );

  getFilters = (projectId: string) => this.filtersMap[projectId];

  /**
   * @description update filters
   * @param projectId - project id
   * @param filters - partial filters to update
   */
  updateFilters = (projectId: string, filters: Partial<IMemberFilters>) => {
    const current = this.filtersMap[projectId] ?? {};
    this.filtersMap[projectId] = { ...current, ...filters };
  };
}
